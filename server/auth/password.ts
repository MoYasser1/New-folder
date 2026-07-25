import { promisify } from 'node:util';
import { randomBytes, scrypt as nodeScrypt, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

const scrypt = promisify(nodeScrypt);
const KEY_LENGTH = 64;
export const strongPasswordSchema = z.string().min(12).max(128)
  .regex(/[a-z]/, 'A lowercase letter is required')
  .regex(/[A-Z]/, 'An uppercase letter is required')
  .regex(/[0-9]/, 'A number is required')
  .regex(/[^A-Za-z0-9]/, 'A symbol is required');

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derivedKey = await scrypt(password, salt, KEY_LENGTH) as Buffer;
  return `scrypt$${salt.toString('hex')}$${derivedKey.toString('hex')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algorithm, saltHex, hashHex] = stored.split('$');
  if (algorithm !== 'scrypt' || !saltHex || !hashHex) return false;
  const storedHash = Buffer.from(hashHex, 'hex');
  const candidate = await scrypt(password, Buffer.from(saltHex, 'hex'), storedHash.length) as Buffer;
  return storedHash.length === candidate.length && timingSafeEqual(storedHash, candidate);
}
