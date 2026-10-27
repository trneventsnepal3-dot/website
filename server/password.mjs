import { randomBytes, scrypt as derive, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
const scrypt = promisify(derive);
export const digest = value => createHash('sha256').update(value).digest('hex');
export async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  return `scrypt:${salt}:${(await scrypt(password, salt, 64)).toString('hex')}`;
}
export async function verifyPassword(password, encoded) {
  const [algorithm, salt, hex] = (encoded || '').split(':');
  if (algorithm !== 'scrypt' || !/^[a-f0-9]{32}$/.test(salt || '') || !/^[a-f0-9]{128}$/.test(hex || '')) return false;
  return timingSafeEqual(await scrypt(password, salt, 64), Buffer.from(hex, 'hex'));
}
