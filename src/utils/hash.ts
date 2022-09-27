import { utils as ethersutils } from 'ethers';
import { BytesData } from '../models/formatted-types';
import { arrayify } from './bytes';

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

export { sha256, sha512HMAC, keccak256 };
