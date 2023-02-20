// TODO: Remove reliance on ethers utils
import { utils as ethersUtils } from 'ethers';
import { BytesData } from '../models/formatted-types';
import { arrayify } from './bytes';

/**
 * Calculates sha256 hash of bytes
 * @param preImage - bytesdata
 * @returns hash
 */
function sha256(preImage: BytesData): string {
  // Convert to bytes array
  const preImageFormatted = arrayify(preImage);

  // Hash and return
  return ethersUtils.sha256(preImageFormatted).slice(2);
}

/**
 * Calculates sha512 hash of bytes
 * @param preImage - bytesdata
 * @returns hash
 */
function sha512(preImage: BytesData): string {
  // Convert to bytes array
  const preImageFormatted = arrayify(preImage);

  // Hash and return
  return ethersUtils.sha512(preImageFormatted).slice(2);
}

/**
 * Calculates sha512 hmac
 * @param key - bytesdata
 * @param data - bytesdata
 * @returns hmac
 */
function sha512HMAC(key: BytesData, data: BytesData): string {
  // Convert to bytes array
  const keyFormatted = arrayify(key);
  const dataFormatted = arrayify(data);

  // Hash HMAC and return
  return ethersUtils
    .computeHmac(ethersUtils.SupportedAlgorithm.sha512, keyFormatted, dataFormatted)
    .slice(2);
}

/**
 * Calculates keccak256 hash of bytes
 * @param preImage - bytesdata
 * @returns hash
 */
function keccak256(preImage: BytesData): string {
  // Convert to bytes array
  const preImageFormatted = arrayify(preImage);

  // Hash and return
  return ethersUtils.keccak256(preImageFormatted).slice(2);
}

export { sha256, sha512, sha512HMAC, keccak256 };
