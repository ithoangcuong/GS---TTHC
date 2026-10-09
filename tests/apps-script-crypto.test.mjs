import test from 'node:test';
import assert from 'node:assert/strict';
import { runInContext } from 'node:vm';
import { gasRuntime } from './helpers/apps-script.mjs';

const cryptoRuntime = properties => gasRuntime(['Utils', 'Crypto'], properties);
const mutate = (serialized, update) => JSON.stringify(update(JSON.parse(serialized)));

// Expected bytes come from RFC 5297 Appendix A, not from the bundled library:
// https://www.rfc-editor.org/rfc/rfc5297.html#appendix-A
const vectors = [
  {
    name: 'A.1 deterministic authenticated encryption',
    key: 'fffefdfcfbfaf9f8f7f6f5f4f3f2f1f0f0f1f2f3f4f5f6f7f8f9fafbfcfdfeff',
    ad: ['101112131415161718191a1b1c1d1e1f2021222324252627'],
    plaintext: '112233445566778899aabbccddee',
    ciphertext: '85632d07c6e8f37f950acd320a2ecc9340c02b9690c4dc04daef7f6afe5c'
  },
  {
    name: 'A.2 multiple associated data and nonce',
    key: '7f7e7d7c7b7a79787776757473727170404142434445464748494a4b4c4d4e4f',
    ad: [
      '00112233445566778899aabbccddeeffdeaddadadeaddadaffeeddccbbaa99887766554433221100',
      '102030405060708090a0',
      '09f911029d74e35bd84156c5635688c0'
    ],
    plaintext: '7468697320697320736f6d6520706c61696e7465787420746f20656e6372797074207573696e67205349562d414553',
    ciphertext: '7bdb6e3b432667eb06f4d14bff2fbd0fcb900f2fddbe404326601965c889bf17dba77ceb094fa663b7a3f748ba8af829ea64ad544a272e9c485b62a3fd5c0d'
  }
];

for (const vector of vectors) test(`GAS bundled AES-SIV matches RFC 5297 ${vector.name}`, () => {
  const gas = cryptoRuntime();
  const result = runInContext(`(() => {
    const vector = ${JSON.stringify(vector)};
    const bytes = hex => new Uint8Array(hex.match(/../g).map(byte => parseInt(byte, 16)));
    const hex = value => Array.from(value, byte => byte.toString(16).padStart(2, '0')).join('');
    const cipher = () => TthcCipher.aessiv(bytes(vector.key), ...vector.ad.map(bytes));
    return { encrypted: hex(cipher().encrypt(bytes(vector.plaintext))), decrypted: hex(cipher().decrypt(bytes(vector.ciphertext))) };
  })()`, gas.context);
  assert.equal(result.encrypted, vector.ciphertext);
  assert.equal(result.decrypted, vector.plaintext);
  assert.equal(gas.calls.filter(call => call.op === 'urlfetch').length, 0);
});

test('GAS AES-SIV preserves JSON types and long Unicode content without remote calls', () => {
  const gas = cryptoRuntime();
  const values = [null, false, 0, 1.25, '', 'Hồ sơ 📄 Đặng Ánh', [], {}, { text: 'Tài liệu tiếng Việt 😀\n'.repeat(900), nested: [true, null, { quoted: '"\\' }] }];
  const encrypted = gas.app.Crypto.encryptMany(values);
  assert.deepEqual(gas.plain(gas.app.Crypto.decryptMany(encrypted)), values);
  for (const value of encrypted) {
    const envelope = JSON.parse(value);
    assert.equal(envelope.version, 'aes-siv-v1');
    assert.equal(envelope.keyId, 'test-key-v1');
    assert.match(envelope.nonce, /^[0-9a-f-]{36}$/i);
    assert.ok(!value.includes(gas.properties.get('DATA_ENCRYPTION_KEY')));
  }
  assert.equal(gas.calls.filter(call => call.op === 'urlfetch').length, 0);
});

test('GAS AES-SIV authenticates nonce, key ID and ciphertext, and rejects old KMS envelopes', () => {
  const gas = cryptoRuntime();
  const encrypted = gas.app.Crypto.encrypt({ email: 'private@example.test' });
  gas.properties.set('DATA_ENCRYPTION_PREVIOUS_KEYS', JSON.stringify({ 'alias-key': gas.properties.get('DATA_ENCRYPTION_KEY') }));
  const changes = [
    envelope => ({ ...envelope, nonce: '00000000-0000-4000-8000-000000000000' }),
    envelope => ({ ...envelope, keyId: 'alias-key' }),
    envelope => { const bytes = Buffer.from(envelope.ciphertext, 'base64'); bytes[0] ^= 1; return { ...envelope, ciphertext: bytes.toString('base64') }; },
    envelope => { const bytes = Buffer.from(envelope.ciphertext, 'base64'); bytes[bytes.length - 1] ^= 1; return { ...envelope, ciphertext: bytes.toString('base64') }; }
  ];
  for (const change of changes) assert.throws(() => gas.app.Crypto.decrypt(mutate(encrypted, change)), { code: 'CRYPTO_INVALID' });
  for (const change of [
    envelope => ({ ...envelope, version: 'other-version' }),
    envelope => ({ ...envelope, nonce: '' }),
    envelope => ({ ...envelope, ciphertext: 'not-base64!' }),
    envelope => ({ ...envelope, ciphertext: '' }),
    envelope => ({ ...envelope, keyId: '' })
  ]) assert.throws(() => gas.app.Crypto.decrypt(mutate(encrypted, change)));
  assert.throws(() => gas.app.Crypto.decrypt(JSON.stringify({ version: 'kms-v1', key: 'projects/old/key', ciphertext: 'old' })));
  assert.equal(gas.calls.filter(call => call.op === 'urlfetch').length, 0);
});

test('GAS AES-SIV refuses missing, malformed or incorrect keys without plaintext fallback', () => {
  const gas = cryptoRuntime();
  const encrypted = gas.app.Crypto.encrypt('sensitive');
  gas.properties.set('DATA_ENCRYPTION_KEY', 'ab'.repeat(64));
  assert.throws(() => gas.app.Crypto.decrypt(encrypted), { code: 'CRYPTO_INVALID' });
  for (const bad of ['', 'a'.repeat(64), 'g'.repeat(128), ' ' + 'a'.repeat(128)]) {
    gas.properties.set('DATA_ENCRYPTION_KEY', bad);
    assert.throws(() => gas.app.Crypto.encrypt('sensitive'), { code: 'CRYPTO_NOT_CONFIGURED' });
  }
  gas.properties.delete('DATA_ENCRYPTION_KEY');
  assert.throws(() => gas.app.Crypto.decrypt(encrypted), { code: 'CRYPTO_NOT_CONFIGURED' });
  gas.properties.set('DATA_ENCRYPTION_KEY', 'ab'.repeat(64));
  for (const keyId of ['', 'space invalid', 'x'.repeat(65), '../unsafe']) {
    gas.properties.set('DATA_ENCRYPTION_KEY_ID', keyId);
    assert.throws(() => gas.app.Crypto.encrypt('sensitive'), { code: 'CRYPTO_NOT_CONFIGURED' });
  }
  assert.equal(gas.calls.filter(call => call.op === 'urlfetch').length, 0);
});

test('GAS AES-SIV rotation reads explicit previous keys and encrypts only with the current key', () => {
  const gas = cryptoRuntime();
  const prior = gas.app.Crypto.encrypt({ record: 'old' }), priorKey = gas.properties.get('DATA_ENCRYPTION_KEY');
  gas.properties.set('DATA_ENCRYPTION_KEY_ID', 'test-key-v2');
  gas.properties.set('DATA_ENCRYPTION_KEY', 'cd'.repeat(64));
  assert.throws(() => gas.app.Crypto.decrypt(prior), { code: 'CRYPTO_KEY_UNAVAILABLE' });
  gas.properties.set('DATA_ENCRYPTION_PREVIOUS_KEYS', JSON.stringify({ 'test-key-v1': priorKey }));
  const current = gas.app.Crypto.encrypt({ record: 'current' });
  assert.equal(JSON.parse(current).keyId, 'test-key-v2');
  assert.deepEqual(gas.plain(gas.app.Crypto.decryptMany([prior, current])), [{ record: 'old' }, { record: 'current' }]);
  gas.properties.delete('DATA_ENCRYPTION_PREVIOUS_KEYS');
  assert.throws(() => gas.app.Crypto.decrypt(prior), { code: 'CRYPTO_KEY_UNAVAILABLE' });
  assert.deepEqual(gas.plain(gas.app.Crypto.decrypt(current)), { record: 'current' });
});

test('GAS AES-SIV rejects malformed previous-key configuration and an absent cipher bundle', () => {
  const gas = cryptoRuntime();
  const key = gas.properties.get('DATA_ENCRYPTION_KEY');
  for (const value of ['not-json', 'null', '[]', JSON.stringify({ 'test-key-v1': key }), JSON.stringify({ 'old-key': 'short' }), JSON.stringify({ 'invalid key': key })]) {
    gas.properties.set('DATA_ENCRYPTION_PREVIOUS_KEYS', value);
    assert.throws(() => gas.app.Crypto.encrypt('sensitive'), { code: 'CRYPTO_NOT_CONFIGURED' });
  }
  gas.properties.delete('DATA_ENCRYPTION_PREVIOUS_KEYS');
  gas.context.TthcCipher = undefined;
  assert.throws(() => gas.app.Crypto.encrypt('sensitive'), { code: 'CRYPTO_UNAVAILABLE' });
  assert.equal(gas.calls.filter(call => call.op === 'crypto' || call.op === 'urlfetch').length, 0);
});

test('GAS AES-SIV enforces the byte limit before cipher work and rejects unsupported JSON', () => {
  const gas = cryptoRuntime();
  const boundary = 'x'.repeat(29998); // JSON quotes make exactly 30000 UTF-8 bytes.
  assert.equal(gas.app.Crypto.decrypt(gas.app.Crypto.encrypt(boundary)), boundary);
  gas.calls.length = 0;
  for (const value of ['x'.repeat(29999), 'á'.repeat(15000)]) assert.throws(() => gas.app.Crypto.encrypt(value), { code: 'CRYPTO_SIZE' });
  const circular = {}; circular.self = circular;
  for (const value of [undefined, () => {}, circular, 1n]) assert.throws(() => gas.app.Crypto.encrypt(value), { code: 'CRYPTO_INVALID' });
  assert.equal(gas.calls.filter(call => call.op === 'crypto' || call.op === 'urlfetch').length, 0);
});

test('GAS AES-SIV retains authentication when a UUID is reused across a batch', () => {
  const gas = cryptoRuntime();
  gas.context.Utilities.getUuid = () => '00000000-0000-4000-8000-000000000000';
  const values = [{ record: 'A' }, { record: 'B' }, { record: 'A' }];
  const encrypted = gas.app.Crypto.encryptMany(values);
  // Repeated nonce + plaintext reveals equality, as RFC 5297 specifies; this
  // test verifies authentication and roundtrip, not randomness of UUIDs.
  assert.equal(encrypted[0], encrypted[2]);
  assert.notEqual(encrypted[0], encrypted[1]);
  assert.deepEqual(gas.plain(gas.app.Crypto.decryptMany(encrypted)), values);
  const forged = mutate(encrypted[0], envelope => {
    const bytes = Buffer.from(envelope.ciphertext, 'base64'); bytes[16] ^= 1;
    return { ...envelope, ciphertext: bytes.toString('base64') };
  });
  assert.throws(() => gas.app.Crypto.decrypt(forged), { code: 'CRYPTO_INVALID' });
  assert.equal(gas.calls.filter(call => call.op === 'urlfetch').length, 0);
});
