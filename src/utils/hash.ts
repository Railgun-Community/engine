import crypto from 'crypto';
import { utils as ethersutils } from 'ethers';
// @ts-ignore
import { poseidon as poseidonHash } from 'circomlib';
import { arrayify, ByteLength, formatToByteLength, hexlify, numberify } from './bytes';
import { BytesData } from '../models/transaction-types';

const hashes = [
  'RSA-MD4',
  'RSA-MD5',
  'RSA-MDC2',
  'RSA-RIPEMD160',
  'RSA-SHA1',
  'RSA-SHA1-2',
  'RSA-SHA224',
  'RSA-SHA256',
  'RSA-SHA3-224',
  'RSA-SHA3-256',
  'RSA-SHA3-384',
  'RSA-SHA3-512',
  'RSA-SHA384',
  'RSA-SHA512',
  'RSA-SHA512/224',
  'RSA-SHA512/256',
  'RSA-SM3',
  'blake2b512',
  'blake2s256',
  'id-rsassa-pkcs1-v1_5-with-sha3-224',
  'id-rsassa-pkcs1-v1_5-with-sha3-256',
  'id-rsassa-pkcs1-v1_5-with-sha3-384',
  'id-rsassa-pkcs1-v1_5-with-sha3-512',
  'md4',
  'md4WithRSAEncryption',
  'md5',
  'md5-sha1',
  'md5WithRSAEncryption',
  'mdc2',
  'mdc2WithRSA',
  'ripemd',
  'ripemd160',
  'ripemd160WithRSA',
  'rmd160',
  'sha1',
  'sha1WithRSAEncryption',
  'sha224',
  'sha224WithRSAEncryption',
  'sha256',
  'sha256WithRSAEncryption',
  'sha3-224',
  'sha3-256',
  'sha3-384',
  'sha3-512',
  'sha384',
  'sha384WithRSAEncryption',
  'sha512',
  'sha512-224',
  'sha512-224WithRSAEncryption',
  'sha512-256',
  'sha512-256WithRSAEncryption',
  'sha512WithRSAEncryption',
  'shake128',
  'shake256',
  'sm3',
  'sm3WithRSAEncryption',
  'ssl3-md5',
  'ssl3-sha1',
  'whirlpool',
] as const;

export type PBKDF2Digest = typeof hashes[number];

/**
 * Calculates sha256 hash of bytes
 * @param preImage - bytesdata
 * @returns hash
 */
function sha256(preImage: BytesData): string {
  // TODO: Remove reliance on ethers utils
  // Convert to bytes array
  const preImageFormatted = arrayify(preImage);

  // Hash and return
  return ethersutils.sha256(preImageFormatted).slice(2);
}

/**
 * Calculates sha512 hash of bytes
 * @param preImage - bytesdata
 * @returns hash
 */
function sha512(preImage: BytesData): string {
  // TODO: Remove reliance on ethers utils
  // Convert to bytes array
  const preImageFormatted = arrayify(preImage);

  // Hash and return
  return ethersutils.sha512(preImageFormatted).slice(2);
}

/**
 * Calculates sha512 hmac
 * @param key - bytesdata
 * @param data - bytesdata
 * @returns hmac
 */
function sha512HMAC(key: BytesData, data: BytesData): string {
  // TODO: Remove reliance on ethers utils
  // Convert to bytes array
  const keyFormatted = arrayify(key);
  const dataFormatted = arrayify(data);

  // Hash HMAC and return
  return ethersutils
    .computeHmac(ethersutils.SupportedAlgorithm.sha512, keyFormatted, dataFormatted)
    .slice(2);
}

/**
 * Calculates keccak256 hash of bytes
 * @param preImage - bytesdata
 * @returns hash
 */
function keccak256(preImage: BytesData): string {
  // TODO: Remove reliance on ethers utils
  // Convert to bytes array
  const preImageFormatted = arrayify(preImage);

  // Hash and return
  return ethersutils.keccak256(preImageFormatted).slice(2);
}

/**
 * Calculates the poseidon hash of an array of bytes32
 * @param preImage - bytes32 array
 * @returns hash
 */
function poseidon(preImage: BytesData[]): string {
  // TODO: Remove reliance on circomlib
  // Convert all bytes into bigints (typing issue)
  const preImageFormatted = preImage.map((bytedata) => BigInt(numberify(bytedata).toString(10)));

  // Hash
  const hash = poseidonHash(preImageFormatted).toString(16);

  // Pad to even length if needed
  return formatToByteLength(hash, ByteLength.UINT_256, false);
}

/**
 * Calculates PBKDF2 hash
 * @param secret - input
 * @param salt - salt
 * @param iterations - rounds
 * @param keyLength - length of output
 * @param digest - hash function to use
 */
async function pbkdf2(
  secret: BytesData,
  salt: BytesData,
  iterations: number,
  keyLength: number,
  digest: PBKDF2Digest,
): Promise<string> {
  const secretFormatted = new Uint8Array(arrayify(secret));
  const saltFormatted = new Uint8Array(arrayify(salt));

  const key: Buffer = await new Promise((resolve) =>
    crypto.pbkdf2(
      secretFormatted,
      saltFormatted,
      iterations,
      keyLength,
      digest,
      (_err: Error | null, derivedKey: Buffer) => resolve(derivedKey),
    ),
  );
  return hexlify(key);
}

export { sha256, sha512, sha512HMAC, keccak256, poseidon, pbkdf2 };
