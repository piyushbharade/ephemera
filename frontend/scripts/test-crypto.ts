/**
 * Crypto tests. Run with:  npm run test:crypto
 * They use the same Web Crypto API that browsers provide (built into Node 18+).
 */
import assert from 'node:assert/strict';
import {
  PBKDF2_ITERATIONS,
  byteLength,
  decrypt,
  deriveKey,
  encrypt,
  exportKey,
  fromB64Url,
  generateKey,
  importKey,
  newSalt,
  toB64Url,
} from '../lib/crypto-engine';

let passed = 0;
async function test(name: string, fn: () => Promise<void> | void) {
  try {
    await fn();
    passed++;
    console.log(`PASS  ${name}`);
  } catch (err) {
    console.error(`FAIL  ${name}\n${(err as Error).stack}`);
    process.exit(1);
  }
}

const throwsAsync = async (fn: () => Promise<unknown>) => {
  try {
    await fn();
  } catch {
    return true;
  }
  return false;
};

(async () => {
  await test('base64url round trip for lengths 0..80, URL-safe characters only', () => {
    for (let n = 0; n <= 80; n++) {
      const bytes = crypto.getRandomValues(new Uint8Array(n));
      const text = toB64Url(bytes);
      assert.match(text, /^[A-Za-z0-9_-]*$/);
      assert.deepEqual(fromB64Url(text), bytes);
    }
  });

  await test('random-key mode round trip (ascii, unicode, emoji, multiline)', async () => {
    const samples = [
      'AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
      'पासवर्ड: ताला123 — हिन्दी',
      'emoji 🔐🔥 and ünïcödé',
      'line one\nline two\r\n\ttabbed line',
      'x',
    ];
    for (const text of samples) {
      const key = await generateKey();
      const { ciphertext, iv } = await encrypt(text, key);
      const linkKey = await exportKey(key);
      assert.equal(await decrypt(ciphertext, iv, await importKey(linkKey)), text);
    }
  });

  await test('exported key is 32 bytes (AES-256) = 43 link characters', async () => {
    const linkKey = await exportKey(await generateKey());
    assert.equal(linkKey.length, 43);
    assert.equal(fromB64Url(linkKey).length, 32);
  });

  await test('IV is 12 bytes = 16 characters, matching the backend rule', async () => {
    const { iv } = await encrypt('hello', await generateKey());
    assert.equal(iv.length, 16);
    assert.equal(fromB64Url(iv).length, 12);
  });

  await test('salt is 16 bytes = 22 characters, matching the backend rule', () => {
    const salt = toB64Url(newSalt());
    assert.equal(salt.length, 22);
  });

  await test('wrong key fails to decrypt', async () => {
    const { ciphertext, iv } = await encrypt('top secret', await generateKey());
    assert.ok(await throwsAsync(async () => decrypt(ciphertext, iv, await importKey(await exportKey(await generateKey())))));
  });

  await test('tampered ciphertext is detected', async () => {
    const key = await generateKey();
    const { ciphertext, iv } = await encrypt('top secret', key);
    const flipped = (ciphertext[0] === 'A' ? 'B' : 'A') + ciphertext.slice(1);
    assert.ok(await throwsAsync(() => decrypt(flipped, iv, key)));
  });

  await test('wrong IV fails to decrypt', async () => {
    const key = await generateKey();
    const { ciphertext } = await encrypt('top secret', key);
    const otherIv = (await encrypt('x', key)).iv;
    assert.ok(await throwsAsync(() => decrypt(ciphertext, otherIv, key)));
  });

  await test('IVs are unique across 2000 encryptions and the same text encrypts differently', async () => {
    const key = await generateKey();
    const ivs = new Set<string>();
    const cts = new Set<string>();
    for (let i = 0; i < 2000; i++) {
      const { iv, ciphertext } = await encrypt('same text', key);
      ivs.add(iv);
      cts.add(ciphertext);
    }
    assert.equal(ivs.size, 2000);
    assert.equal(cts.size, 2000);
  });

  await test('ciphertext contains no readable part of the plaintext', async () => {
    const plain = 'AKIAIOSFODNN7EXAMPLE';
    const { ciphertext } = await encrypt(plain, await generateKey());
    assert.ok(!ciphertext.includes(plain));
    assert.ok(!Buffer.from(fromB64Url(ciphertext)).toString('latin1').includes('AKIA'));
  });

  await test('password mode round trip, and the link needs no key', async () => {
    const salt = newSalt();
    const key = await deriveKey('correct horse battery staple', salt);
    const { ciphertext, iv } = await encrypt('db password: hunter2', key);
    const again = await deriveKey('correct horse battery staple', fromB64Url(toB64Url(salt)));
    assert.equal(await decrypt(ciphertext, iv, again), 'db password: hunter2');
  });

  await test('wrong password fails', async () => {
    const salt = newSalt();
    const { ciphertext, iv } = await encrypt('secret', await deriveKey('right-password', salt));
    assert.ok(await throwsAsync(async () => decrypt(ciphertext, iv, await deriveKey('wrong-password', salt))));
  });

  await test('right password with the wrong salt fails', async () => {
    const { ciphertext, iv } = await encrypt('secret', await deriveKey('pw', newSalt()));
    assert.ok(await throwsAsync(async () => decrypt(ciphertext, iv, await deriveKey('pw', newSalt()))));
  });

  await test(`PBKDF2 uses ${PBKDF2_ITERATIONS.toLocaleString()} rounds and takes a noticeable moment`, async () => {
    const t0 = performance.now();
    await deriveKey('timing', newSalt());
    const ms = performance.now() - t0;
    console.log(`      (derivation took ${ms.toFixed(0)} ms here)`);
    assert.equal(PBKDF2_ITERATIONS, 600_000);
    assert.ok(ms > 20, 'derivation should not be instant');
  });

  await test('a 12,000-byte secret stays under the backend 20,000-character limit', async () => {
    const big = 'a'.repeat(12_000);
    assert.equal(byteLength(big), 12_000);
    const { ciphertext } = await encrypt(big, await generateKey());
    assert.ok(ciphertext.length < 20_000, `ciphertext was ${ciphertext.length} characters`);
    console.log(`      (12,000 bytes became ${ciphertext.length} characters)`);
  });

  await test('multi-byte text counts bytes, not characters', () => {
    assert.equal(byteLength('é'), 2);
    assert.equal(byteLength('🔐'), 4);
    assert.equal(byteLength('ताला'), 12);
  });

  console.log(`\nAll ${passed} crypto tests passed.`);
})();
