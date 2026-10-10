/**
 * Ephemera crypto engine. Everything here runs in the browser; nothing in this
 * file ever talks to the network.
 *
 * Two ways to get an encryption key:
 *   1. Random key  -> a fresh AES-256 key is generated and travels in the link,
 *                     after the "#", which browsers never send to a server.
 *   2. Password    -> the key is derived from the password with PBKDF2 and a
 *                     random salt. The link then carries no key at all.
 *
 * Encryption is AES-256-GCM: it hides the data AND detects tampering. A wrong
 * key, a wrong password or edited data all make decryption throw an error.
 */

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** PBKDF2 rounds. 600,000 is the current OWASP guidance for PBKDF2-HMAC-SHA256. */
export const PBKDF2_ITERATIONS = 600_000;

// ------------------------------------------------ bytes <-> base64url text
export function toB64Url(input: ArrayBuffer | Uint8Array): string {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromB64Url(text: string): Uint8Array<ArrayBuffer> {
  let b64 = text.replace(/-/g, '+').replace(/_/g, '/');
  while (b64.length % 4) b64 += '=';
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Size of a string once encoded as UTF-8 (this is what gets encrypted). */
export const byteLength = (text: string): number => encoder.encode(text).length;

// ------------------------------------------------ mode 1: random key in the link
export function generateKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
}

export async function exportKey(key: CryptoKey): Promise<string> {
  return toB64Url(await crypto.subtle.exportKey('raw', key));
}

export function importKey(b64: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', fromB64Url(b64), { name: 'AES-GCM' }, false, ['decrypt']);
}

// ------------------------------------------------ mode 2: key from a password
export function newSalt(): Uint8Array<ArrayBuffer> {
  return crypto.getRandomValues(new Uint8Array(16));
}

export async function deriveKey(password: string, salt: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

// ------------------------------------------------ encrypt / decrypt
export async function encrypt(plaintext: string, key: CryptoKey): Promise<{ ciphertext: string; iv: string }> {
  // A new random 96-bit IV for every message. Never reuse an IV with the same key.
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoder.encode(plaintext));
  return { ciphertext: toB64Url(data), iv: toB64Url(iv) };
}

export async function decrypt(ciphertext: string, iv: string, key: CryptoKey): Promise<string> {
  const data = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64Url(iv) }, key, fromB64Url(ciphertext));
  return decoder.decode(data);
}
