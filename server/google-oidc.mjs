import { createHash, createPublicKey, randomBytes, timingSafeEqual, verify } from 'node:crypto';

const AUTHORIZATION_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const JWKS_ENDPOINT = 'https://www.googleapis.com/oauth2/v3/certs';
const INVALID_LOGIN = 'Không thể xác nhận đăng nhập Google. Vui lòng đăng nhập lại.';
const UNAVAILABLE = 'Dịch vụ đăng nhập Google chưa sẵn sàng. Vui lòng thử lại.';
const hash = value => createHash('sha256').update(value).digest();
const random = () => randomBytes(32).toString('base64url');
const validBrowserToken = value => typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value);

export class GoogleLoginError extends Error {
  constructor(status = 401) { super(status === 503 ? UNAVAILABLE : INVALID_LOGIN); this.name = 'GoogleLoginError'; this.status = status; }
}

function decodePart(value) {
  if (!value || !/^[A-Za-z0-9_-]+$/.test(value)) throw new GoogleLoginError();
  const decoded = Buffer.from(value, 'base64url');
  if (decoded.toString('base64url') !== value) throw new GoogleLoginError();
  return decoded;
}

function objectPart(value) {
  try {
    const parsed = JSON.parse(decodePart(value).toString('utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new GoogleLoginError();
    return parsed;
  } catch { throw new GoogleLoginError(); }
}

async function readJson(response, maximumBytes, controller) {
  if (!response.ok || response.status < 200 || response.status >= 300) throw new GoogleLoginError(response.status >= 500 ? 503 : 401);
  const declared = response.headers.get('content-length');
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > maximumBytes)) throw new GoogleLoginError(503);
  const type = response.headers.get('content-type') || '';
  if (!/^application\/json(?:\s*;|$)/i.test(type) || !response.body) throw new GoogleLoginError(503);
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maximumBytes) { controller.abort(); throw new GoogleLoginError(503); }
      chunks.push(value);
    }
    const result = JSON.parse(Buffer.concat(chunks, size).toString('utf8'));
    if (!result || typeof result !== 'object' || Array.isArray(result)) throw new GoogleLoginError(503);
    return result;
  } catch (error) {
    if (error instanceof GoogleLoginError) throw error;
    throw new GoogleLoginError(503);
  } finally { reader.releaseLock(); }
}

/** Server-side Google authorization-code flow. Tokens are verified in memory and never retained. */
export class GoogleOidc {
  #clientSecret;
  #pending = new Map();
  #keys = new Map();
  #keysExpireAt = 0;
  #keysRequest = null;

  constructor({ clientId, clientSecret, redirectUri, fetch: fetcher = globalThis.fetch, clock = Date.now,
    production = process.env.NODE_ENV === 'production', stateTtlMs = 300000, maxPending = 1000, timeoutMs = 10000,
    clockSkewSeconds = 30 } = {}) {
    if (typeof clientId !== 'string' || !/^[A-Za-z0-9._-]{3,300}$/.test(clientId)
      || typeof clientSecret !== 'string' || clientSecret.length < 8 || clientSecret.length > 1000 || /[\s\x00-\x1f]/.test(clientSecret)
      || typeof fetcher !== 'function' || typeof clock !== 'function') throw new Error('Cấu hình đăng nhập Google không hợp lệ.');
    let redirect;
    try { redirect = new URL(redirectUri); } catch { throw new Error('Google redirect URI không hợp lệ.'); }
    const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(redirect.hostname);
    if (redirect.username || redirect.password || redirect.hash || redirect.search
      || !(redirect.protocol === 'https:' || (!production && loopback && redirect.protocol === 'http:')))
      throw new Error('Google redirect URI phải dùng HTTPS; HTTP chỉ được phép ở localhost khi phát triển.');
    if (!Number.isInteger(stateTtlMs) || stateTtlMs < 30000 || stateTtlMs > 600000
      || !Number.isInteger(maxPending) || maxPending < 1 || maxPending > 1000
      || !Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 10000
      || !Number.isInteger(clockSkewSeconds) || clockSkewSeconds < 0 || clockSkewSeconds > 60)
      throw new Error('Giới hạn đăng nhập Google không hợp lệ.');
    this.clientId = clientId;
    this.#clientSecret = clientSecret;
    this.redirectUri = redirect.href;
    this.fetch = fetcher;
    this.clock = clock;
    this.stateTtlMs = stateTtlMs;
    this.maxPending = maxPending;
    this.timeoutMs = timeoutMs;
    this.clockSkewSeconds = clockSkewSeconds;
  }

  start() {
    this.#prune();
    if (this.#pending.size >= this.maxPending) throw new GoogleLoginError(503);
    const state = random();
    const browserToken = random();
    const nonce = random();
    const verifier = random();
    this.#pending.set(hash(state).toString('hex'), { browserHash: hash(browserToken), nonce, verifier, expiresAt: this.clock() + this.stateTtlMs });
    const authorizationUrl = new URL(AUTHORIZATION_ENDPOINT);
    authorizationUrl.search = new URLSearchParams({ client_id: this.clientId, redirect_uri: this.redirectUri,
      response_type: 'code', scope: 'openid email profile', state, nonce,
      code_challenge: hash(verifier).toString('base64url'), code_challenge_method: 'S256', prompt: 'select_account' }).toString();
    return { authorizationUrl: authorizationUrl.href, state, browserToken };
  }

  async finish({ state, code, browserToken } = {}) {
    this.#prune();
    if (!validBrowserToken(state)) throw new GoogleLoginError();
    const stateHash = hash(state).toString('hex');
    const pending = this.#pending.get(stateHash);
    this.#pending.delete(stateHash);
    if (!pending || !validBrowserToken(browserToken) || !timingSafeEqual(hash(browserToken), pending.browserHash)
      || typeof code !== 'string' || code.length < 1 || code.length > 4096 || /[\x00-\x20\x7f]/.test(code)) throw new GoogleLoginError();
    const response = await this.#request(TOKEN_ENDPOINT, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ code, client_id: this.clientId, client_secret: this.#clientSecret,
        redirect_uri: this.redirectUri, grant_type: 'authorization_code', code_verifier: pending.verifier }).toString() }, 65536);
    if (typeof response.data.id_token !== 'string' || response.data.id_token.length > 16384) throw new GoogleLoginError();
    return this.#verify(response.data.id_token, pending.nonce);
  }

  #prune() {
    const now = this.clock();
    for (const [key, value] of this.#pending) if (value.expiresAt <= now) this.#pending.delete(key);
  }

  async #request(url, options, maximumBytes) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetch(url, { ...options, redirect: 'error', signal: controller.signal });
      const data = await readJson(response, maximumBytes, controller);
      return { data, headers: response.headers };
    } catch (error) {
      controller.abort();
      if (error instanceof GoogleLoginError) throw error;
      throw new GoogleLoginError(503);
    } finally { clearTimeout(timeout); }
  }

  async #loadKeys(force = false) {
    if (!force && this.#keysExpireAt > this.clock()) return;
    if (this.#keysRequest) return this.#keysRequest;
    this.#keysRequest = (async () => {
      const response = await this.#request(JWKS_ENDPOINT, { headers: { accept: 'application/json' } }, 131072);
      if (!Array.isArray(response.data.keys) || !response.data.keys.length || response.data.keys.length > 50) throw new GoogleLoginError(503);
      const keys = new Map();
      try {
        for (const jwk of response.data.keys) {
          if (!jwk || jwk.kty !== 'RSA' || typeof jwk.kid !== 'string' || !jwk.kid || jwk.kid.length > 200
            || keys.has(jwk.kid) || (jwk.alg && jwk.alg !== 'RS256') || (jwk.use && jwk.use !== 'sig')
            || ['d', 'p', 'q', 'dp', 'dq', 'qi', 'oth'].some(field => Object.hasOwn(jwk, field))
            || typeof jwk.n !== 'string' || jwk.n.length > 1400 || typeof jwk.e !== 'string' || jwk.e.length > 16) throw new GoogleLoginError(503);
          decodePart(jwk.n); decodePart(jwk.e);
          const key = createPublicKey({ key: jwk, format: 'jwk' });
          if (key.asymmetricKeyType !== 'rsa' || key.asymmetricKeyDetails.modulusLength < 2048) throw new GoogleLoginError(503);
          keys.set(jwk.kid, key);
        }
      } catch { throw new GoogleLoginError(503); }
      const cache = response.headers.get('cache-control') || '';
      const seconds = /(?:^|,)\s*max-age=(\d+)(?:\s*,|\s*$)/i.exec(cache)?.[1];
      const ageHeader = response.headers.get('age') || '0';
      const age = /^\d+$/.test(ageHeader) ? Number(ageHeader) * 1000 : 0;
      const ttl = /(?:^|,)\s*(?:no-store|no-cache)(?:\s*,|\s*$)/i.test(cache) ? 0
        : Math.max(0, Math.min(3600000, (seconds === undefined ? 300000 : Number(seconds) * 1000) - age));
      this.#keys = keys;
      this.#keysExpireAt = this.clock() + ttl;
    })();
    try { await this.#keysRequest; } finally { this.#keysRequest = null; }
  }

  async #verify(token, nonce) {
    const parts = token.split('.');
    if (parts.length !== 3) throw new GoogleLoginError();
    const header = objectPart(parts[0]);
    const claims = objectPart(parts[1]);
    if (header.alg !== 'RS256' || typeof header.kid !== 'string' || !header.kid || header.kid.length > 200
      || (header.typ && header.typ !== 'JWT') || header.crit !== undefined) throw new GoogleLoginError();
    const signature = decodePart(parts[2]);
    await this.#loadKeys();
    if (!this.#keys.has(header.kid)) await this.#loadKeys(true);
    const key = this.#keys.get(header.kid);
    if (!key || !verify('RSA-SHA256', Buffer.from(parts[0] + '.' + parts[1]), key, signature)) throw new GoogleLoginError();
    const now = Math.floor(this.clock() / 1000);
    const skew = this.clockSkewSeconds;
    const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (!['accounts.google.com', 'https://accounts.google.com'].includes(claims.iss)
      || !audiences.length || audiences.length > 10 || audiences.some(audience => typeof audience !== 'string')
      || new Set(audiences).size !== audiences.length || !audiences.includes(this.clientId)
      || (audiences.length > 1 && claims.azp !== this.clientId) || (claims.azp !== undefined && claims.azp !== this.clientId)
      || !Number.isInteger(claims.exp) || claims.exp <= now - skew
      || !Number.isInteger(claims.iat) || claims.iat <= 0 || claims.iat > now + skew || claims.iat >= claims.exp
      || (claims.nbf !== undefined && (!Number.isInteger(claims.nbf) || claims.nbf > now + skew))
      || typeof claims.nonce !== 'string' || !timingSafeEqual(hash(claims.nonce), hash(nonce))
      || typeof claims.sub !== 'string' || !claims.sub || claims.sub.length > 255 || /[\s\x00-\x1f\x7f]/.test(claims.sub)
      || claims.email_verified !== true || typeof claims.email !== 'string' || claims.email.length > 254
      || !/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?\.[A-Za-z]{2,63}$/.test(claims.email)) throw new GoogleLoginError();
    const email = claims.email.toLowerCase();
    const displayName = typeof claims.name === 'string' ? claims.name.replace(/[\x00-\x1f\x7f]/g, '').trim().slice(0, 200) : '';
    return { sub: claims.sub, email, displayName: displayName || email };
  }
}
