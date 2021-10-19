import { utils as ethersutils } from 'ethers';
import convert from './convert';
import type { BytesData } from './globaltypes';

/**
 * Calculates sha256 hash of bytes
 * @param preimage - bytesdata
 * @returns hash
 */
function sha256(preimage: BytesData): string {
  // Convert to bytes array
  const preimageFormatted = convert.arrayify(preimage);

  // Hash and return
  return ethersutils.sha256(preimageFormatted).slice(2);
}

/**
 * Calculates sha512 hash of bytes
 * @param preimage - bytesdata
 * @returns hash
 */
function sha512(preimage: BytesData): string {
  // Convert to bytes array
  const preimageFormatted = convert.arrayify(preimage);

  // Hash and return
  return ethersutils.sha512(preimageFormatted).slice(2);
}

/**
 * Calculates sha512 hmac
 * @param key - bytesdata
 * @param data - bytesdata
 * @returns hmac
 */
function sha512HMAC(key: BytesData, data: BytesData): string {
  // Convert to bytes array
  const keyFormatted = convert.arrayify(key);
  const dataFormatted = convert.arrayify(data);

  // Hash HMAC and return
  return ethersutils.computeHmac(
    ethersutils.SupportedAlgorithm.sha512,
    keyFormatted,
    dataFormatted,
  ).slice(2);
}

/**
 * Calculates keccak256 hash of bytes
 * @param preimage - bytesdata
 * @returns hash
 */
function keccak256(preimage: BytesData): string {
  // Convert to bytes array
  const preimageFormatted = convert.arrayify(preimage);

  // Hash and return
  return ethersutils.keccak256(preimageFormatted).slice(2);
}

export default {
  sha256,
  sha512,
  sha512HMAC,
  keccak256,
};
