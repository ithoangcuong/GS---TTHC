import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import { GoogleOidc, GoogleLoginError } from '../server/google-oidc.mjs';

const clientId = 'test-client.apps.googleusercontent.com';
const clientSecret = 'private-test-client-secret';
const redirectUri = 'http://localhost:3000/api/auth/google/callback';
const firstPair = generateKeyPairSync('rsa', { modulusLength: 2048 });
const secondPair = generateKeyPairSync('rsa', { modulusLength: 2048 });
const firstJwk = { ...firstPair.publicKey.export({ format: 'jwk' }), kid: 'first-key', alg: 'RS256', use: 'sig' };
const secondJwk = { ...secondPair.publicKey.export({ format: 'jwk' }), kid: 'second-key', alg: 'RS256', use: 'sig' };
const jsonResponse = (value, headers = {}, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json', ...headers } });
const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
function token(claims, header = { alg: 'RS256', kid: firstJwk.kid, typ: 'JWT' }, privateKey = firstPair.privateKey) {
  const payload = encode(header) + '.' + encode(claims);
  return payload + '.' + sign('RSA-SHA256', Buffer.from(payload), privateKey).toString('base64url');
}

function fixture(options = {}) {
  let now = 1791205200000;
  let currentNonce;
  const calls = [];
  const config = { claims: {}, header: undefined, privateKey: undefined, tokenOverride: undefined,
    keys: [firstJwk], cache: 'public, max-age=3600', tokenResponse: null, keysResponse: null, ...options };
  const fetch = async (url, request) => {
    calls.push({ url, request });
    if (url === 'https://oauth2.googleapis.com/token') {
      if (config.tokenResponse) return config.tokenResponse(request);
      const claims = { iss: 'https://accounts.google.com', sub: '123456789012345678901', aud: clientId,
        iat: Math.floor(now / 1000), exp: Math.floor(now / 1000) + 3600, nonce: currentNonce,
        email: 'USER@example.com', email_verified: true, name: 'Người dùng', ...config.claims };
      return jsonResponse({ id_token: config.tokenOverride ?? token(claims, config.header, config.privateKey), access_token: 'must-not-be-retained' });
    }
    if (url === 'https://www.googleapis.com/oauth2/v3/certs') {
      if (config.keysResponse) return config.keysResponse(request);
      return jsonResponse({ keys: config.keys }, { 'cache-control': config.cache });
    }
    assert.fail('Unexpected endpoint: ' + url);
  };
  const oidc = new GoogleOidc({ clientId, clientSecret, redirectUri, fetch, clock: () => now, ...options.constructor });
  const start = () => {
    const flow = oidc.start();
    currentNonce = new URL(flow.authorizationUrl).searchParams.get('nonce');
    return flow;
  };
  const finish = flow => oidc.finish({ state: flow.state, browserToken: flow.browserToken, code: 'authorization-code' });
  return { oidc, start, finish, calls, config, advance: milliseconds => { now += milliseconds; }, now: () => now };
}

async function invalid(promise, status = 401) {
  await assert.rejects(promise, error => error instanceof GoogleLoginError && error.status === status
    && !error.message.includes(clientSecret) && !error.message.includes('authorization-code'));
}

test('Google login requests only identity scopes, random state/nonce, and S256 PKCE', () => {
  const f = fixture();
  const flow = f.start();
  const url = new URL(flow.authorizationUrl);
  assert.equal(url.origin + url.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
  assert.equal(url.searchParams.get('scope'), 'openid email profile');
  assert.equal(url.searchParams.get('response_type'), 'code');
  assert.equal(url.searchParams.get('redirect_uri'), redirectUri);
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.match(url.searchParams.get('code_challenge'), /^[\w-]{43}$/);
  assert.match(flow.state, /^[\w-]{43}$/);
  assert.match(flow.browserToken, /^[\w-]{43}$/);
  assert.notEqual(flow.state, flow.browserToken);
  assert.equal(url.searchParams.has('client_secret'), false);
  assert.equal(url.searchParams.has('access_type'), false);
  assert.equal(url.searchParams.has('code_verifier'), false);
  assert.notEqual(f.start().state, flow.state);
});

test('Verified Google identity is returned and keys are reused without retaining access tokens', async () => {
  const f = fixture();
  const flow = f.start();
  assert.deepEqual(await f.finish(flow), { sub: '123456789012345678901', email: 'user@example.com', displayName: 'Người dùng' });
  const exchange = f.calls.find(call => call.url.includes('/token'));
  const body = new URLSearchParams(exchange.request.body);
  assert.equal(exchange.request.method, 'POST');
  assert.equal(body.get('client_secret'), clientSecret);
  assert.equal(body.get('grant_type'), 'authorization_code');
  assert.equal(body.get('redirect_uri'), redirectUri);
  assert.equal(createHash('sha256').update(body.get('code_verifier')).digest('base64url'), new URL(flow.authorizationUrl).searchParams.get('code_challenge'));
  for (const call of f.calls) { assert.equal(call.request.redirect, 'error'); assert.ok(call.request.signal instanceof AbortSignal); }
  assert.deepEqual(await f.finish(f.start()), { sub: '123456789012345678901', email: 'user@example.com', displayName: 'Người dùng' });
  assert.equal(f.calls.filter(call => call.url.includes('/certs')).length, 1);
});

test('State is browser-bound, expires, and is consumed even when a callback fails', async () => {
  const f = fixture();
  const flow = f.start();
  await invalid(f.oidc.finish({ ...flow, code: 'authorization-code', browserToken: randomBytes(32).toString('base64url') }));
  assert.equal(f.calls.length, 0);
  await invalid(f.finish(flow));
  const expired = f.start();
  f.advance(300000);
  await invalid(f.finish(expired));
  assert.equal(f.calls.length, 0);
  await invalid(f.oidc.finish({ state: '<script>', code: 'code', browserToken: flow.browserToken }));
});

test('Concurrent callback replay exchanges an authorization code once', async () => {
  const f = fixture();
  const flow = f.start();
  const results = await Promise.allSettled([f.finish(flow), f.finish(flow)]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(f.calls.filter(call => call.url.includes('/token')).length, 1);
  await invalid(f.finish(flow));
});

test('Pending login requests are bounded and expired entries free capacity', () => {
  const f = fixture({ constructor: { maxPending: 2, stateTtlMs: 30000 } });
  f.start(); f.start();
  assert.throws(() => f.start(), error => error instanceof GoogleLoginError && error.status === 503);
  f.advance(30000);
  assert.ok(f.start().state);
});

test('Redirect configuration accepts HTTPS and local development, rejects unsafe configurations', () => {
  const base = { clientId, clientSecret, redirectUri, production: false };
  for (const uri of ['https://app.example.com/api/auth/google/callback', 'http://localhost:3000/callback', 'http://127.0.0.1/callback', 'http://[::1]/callback'])
    assert.doesNotThrow(() => new GoogleOidc({ ...base, redirectUri: uri }));
  for (const uri of ['http://app.example.com/callback', 'https://user:password@app.example.com/callback', 'javascript:alert(1)', 'https://app.example.com/callback#fragment', 'https://app.example.com/callback?next=evil'])
    assert.throws(() => new GoogleOidc({ ...base, redirectUri: uri }));
  assert.throws(() => new GoogleOidc({ ...base, production: true }));
  assert.throws(() => new GoogleOidc({ ...base, clientSecret: '' }));
  assert.throws(() => new GoogleOidc({ ...base, maxPending: 1001 }));
});

test('Claims fail closed for issuer, audience, time, nonce, subject and email verification', async t => {
  const now = Math.floor(1791205200000 / 1000);
  const badClaims = [
    { iss: 'https://attacker.example' }, { aud: 'another-client' }, { aud: [] },
    { aud: [clientId, 'another-client'] }, { azp: 'another-client' }, { aud: [clientId, clientId], azp: clientId },
    { exp: now - 31 }, { exp: String(now + 3600) }, { iat: now + 31 }, { iat: undefined },
    { iat: now + 7200, exp: now + 3600 }, { nbf: now + 31 }, { nonce: 'wrong-nonce' },
    { sub: '' }, { sub: 'unsafe\nsubject' }, { email_verified: false }, { email_verified: 'true' },
    { email: 'bad-email' }, { email: 'person@example.com\n' }
  ];
  for (const [index, claims] of badClaims.entries()) await t.test('invalid claims ' + index, async () => {
    const f = fixture({ claims });
    await invalid(f.finish(f.start()));
  });
});

test('Google issuer variants and explicit authorized party for multiple audiences are supported', async () => {
  for (const claims of [{ iss: 'accounts.google.com' }, { aud: [clientId] }, { aud: [clientId, 'other-client'], azp: clientId }]) {
    const f = fixture({ claims });
    assert.equal((await f.finish(f.start())).email, 'user@example.com');
  }
});

test('Malformed tokens, unsupported algorithms and forged signatures are rejected', async t => {
  const cases = [
    { tokenOverride: 'not-a-jwt' }, { tokenOverride: 'e30.e30.====' },
    { header: { alg: 'none', kid: firstJwk.kid } }, { header: { alg: 'HS256', kid: firstJwk.kid } },
    { header: { alg: 'RS256', kid: firstJwk.kid, crit: ['unknown'] } }, { privateKey: secondPair.privateKey }
  ];
  for (const [index, config] of cases.entries()) await t.test('invalid token ' + index, async () => {
    const f = fixture(config);
    await invalid(f.finish(f.start()));
  });
});

test('Unknown key IDs refresh the trusted fixed JWKS endpoint once and key rotation works', async () => {
  const f = fixture();
  await f.finish(f.start());
  f.config.keys = [secondJwk];
  f.config.header = { alg: 'RS256', kid: secondJwk.kid };
  f.config.privateKey = secondPair.privateKey;
  assert.equal((await f.finish(f.start())).email, 'user@example.com');
  assert.equal(f.calls.filter(call => call.url.includes('/certs')).length, 2);
  f.config.header = { alg: 'RS256', kid: 'missing-key', jku: 'https://attacker.example/jwks' };
  await invalid(f.finish(f.start()));
  assert.equal(f.calls.filter(call => call.url.includes('/certs')).length, 3);
  assert.equal(f.calls.some(call => call.url.includes('attacker')), false);
});

test('JWKS caching honors server expiry but never exceeds one hour', async () => {
  const f = fixture({ cache: 'public, max-age=86400' });
  await f.finish(f.start());
  f.advance(3599000);
  await f.finish(f.start());
  assert.equal(f.calls.filter(call => call.url.includes('/certs')).length, 1);
  f.advance(1000);
  await f.finish(f.start());
  assert.equal(f.calls.filter(call => call.url.includes('/certs')).length, 2);
  const uncached = fixture({ cache: 'no-store' });
  await uncached.finish(uncached.start()); await uncached.finish(uncached.start());
  assert.equal(uncached.calls.filter(call => call.url.includes('/certs')).length, 2);
});

test('Untrusted or weak JWKS cannot establish an identity', async t => {
  const weakPair = generateKeyPairSync('rsa', { modulusLength: 1024 });
  const cases = [[], [{ ...firstJwk, kty: 'oct' }], [{ ...firstJwk, d: 'private-field' }],
    [firstJwk, firstJwk], [{ ...weakPair.publicKey.export({ format: 'jwk' }), kid: firstJwk.kid }]];
  for (const [index, keys] of cases.entries()) await t.test('invalid JWKS ' + index, async () => {
    const f = fixture({ keys });
    await invalid(f.finish(f.start()), 503);
  });
});

test('Token errors and malformed/oversized provider responses expose only a generic error', async () => {
  const denied = fixture({ tokenResponse: () => jsonResponse({ error_description: clientSecret + ' authorization-code' }, {}, 400) });
  const deniedFlow = denied.start();
  await invalid(denied.finish(deniedFlow));
  await invalid(denied.finish(deniedFlow));
  const huge = fixture({ tokenResponse: () => jsonResponse({ padding: 'x'.repeat(65536) }) });
  await invalid(huge.finish(huge.start()), 503);
  const malformed = fixture({ tokenResponse: () => new Response('<html>' + clientSecret, { headers: { 'content-type': 'text/html' } }) });
  await invalid(malformed.finish(malformed.start()), 503);
  const oversizedLength = fixture({ tokenResponse: () => jsonResponse({}, { 'content-length': '10000000' }) });
  await invalid(oversizedLength.finish(oversizedLength.start()), 503);
});

test('Network requests are aborted at the configured timeout without leaking provider details', async () => {
  const f = fixture({ constructor: { timeoutMs: 100 }, tokenResponse: request => new Promise((resolve, reject) => {
    request.signal.addEventListener('abort', () => reject(new Error(clientSecret)), { once: true });
  }) });
  await invalid(f.finish(f.start()), 503);
});

test('Profile names are bounded and control characters removed; missing names use verified email', async () => {
  const f = fixture({ claims: { name: '  User\n' + 'x'.repeat(250) } });
  const result = await f.finish(f.start());
  assert.equal(result.displayName.length, 200);
  assert.equal(result.displayName.includes('\n'), false);
  const fallback = fixture({ claims: { name: null } });
  assert.equal((await fallback.finish(fallback.start())).displayName, 'user@example.com');
});
