import * as ethers from 'ethers';
import type { BytesData } from './globaltypes';

/**
 * Calculates sha256 hash of bytes
 * @param preimage - hex string or byte array
 * @returns hash
 */
function sha256(preimage: BytesData): string {
  // If type is a string, prepend with 0x
  const preimageFormatted = typeof preimage === 'string'
    ? `0x${preimage}`
    : preimage;

  return ethers.utils.sha256(preimageFormatted).slice(2);
}

/**
 * Calculates sha512 hash of bytes
 * @param preimage - hex string or byte array
 * @returns hash
 */
function sha512(preimage: BytesData): string {
  // If type is a string, prepend with 0x
  const preimageFormatted = typeof preimage === 'string'
    ? `0x${preimage}`
    : preimage;

  return ethers.utils.sha512(preimageFormatted).slice(2);
}

/**
 * Calculates sha512 hmac
 * @param key - hex string or byte array
 * @param data - hex string or byte array
 * @returns hmac
 */
function sha512HMAC(key: BytesData, data: BytesData): string {
  // If type is a string, prepend with 0x
  const keyFormatted = typeof key === 'string'
    ? `0x${key}`
    : key;

  const dataFormatted = typeof data === 'string'
    ? `0x${data}`
    : data;

  return ethers.utils.computeHmac(
    ethers.utils.SupportedAlgorithm.sha512,
    keyFormatted, dataFormatted,
  ).slice(2);
}

/**
 * Calculates keccak256 hash of bytes
 * @param preimage - hex string or byte array
 * @returns hash
 */
function keccak256(preimage: BytesData): string {
  // If type is a string, prepend with 0x
  const preimageFormatted = typeof preimage === 'string'
    ? `0x${preimage}`
    : preimage;

  return ethers.utils.keccak256(preimageFormatted).slice(2);
}

export default {
  sha256,
  sha512,
  sha512HMAC,
  keccak256,
};
