// Custodial wallet secrets at rest: AES-256-GCM with WALLET_ENCRYPTION_KEY.
// Layout: [version=1][iv 12][tag 16][ciphertext]. The public key is the AAD, so a secret copied
// onto another wallet row fails to decrypt instead of signing for the wrong account.
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { Keypair } from '@stellar/stellar-sdk';

const VERSION = 1;
const IV_BYTES = 12;
const TAG_BYTES = 16;

function assertKey(key: Buffer) {
  if (key.length !== 32) throw new Error('wallet encryption key must be 32 bytes');
}

export function encryptWalletSecret(key: Buffer, secret: string, publicKey: string): Buffer {
  assertKey(key);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(publicKey, 'utf8'));
  const ciphertext = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  return Buffer.concat([Buffer.from([VERSION]), iv, cipher.getAuthTag(), ciphertext]);
}

/** Throws if the key is wrong, the data was tampered with, or it belongs to another public key. */
export function decryptWalletSecret(key: Buffer, blob: Uint8Array, publicKey: string): string {
  assertKey(key);
  const data = Buffer.from(blob);
  if (data.length < 1 + IV_BYTES + TAG_BYTES + 1 || data[0] !== VERSION) {
    throw new Error('unsupported wallet secret format');
  }
  const iv = data.subarray(1, 1 + IV_BYTES);
  const tag = data.subarray(1 + IV_BYTES, 1 + IV_BYTES + TAG_BYTES);
  const ciphertext = data.subarray(1 + IV_BYTES + TAG_BYTES);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAAD(Buffer.from(publicKey, 'utf8'));
  decipher.setAuthTag(tag);
  const secret = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  if (Keypair.fromSecret(secret).publicKey() !== publicKey) {
    throw new Error('wallet secret does not match its public key');
  }
  return secret;
}

/** A fresh keypair, ready to store: { stellarPublicKey, encryptedSecret }. */
export function newCustodialWallet(key: Buffer) {
  const kp = Keypair.random();
  return {
    stellarPublicKey: kp.publicKey(),
    // Plain Uint8Array copy: the type Prisma's Bytes column expects.
    encryptedSecret: new Uint8Array(encryptWalletSecret(key, kp.secret(), kp.publicKey())),
  };
}
