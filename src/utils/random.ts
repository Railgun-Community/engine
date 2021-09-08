import crypto from 'crypto';

/**
 * Generates random bytes
 *
 * @param length - number of bytes to generate
 * @returns random bytes hex string
 */
function generateRandom(length: number = 32): string {
  return crypto.randomBytes(length).toString('hex');
}

export default generateRandom;
