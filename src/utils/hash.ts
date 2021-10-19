import { utils as ethersutils } from 'ethers';
// @ts-ignore
import { poseidon as poseidonHash } from 'circomlib';
import bytes from './bytes';
import type { BytesData } from './globaltypes';

/**
 * Calculates sha256 hash of bytes
 * @param preimage - bytesdata
 * @returns hash
 */
function sha256(preimage: BytesData): string {
  // TODO: Remove reliance on ethers utils
  // Convert to bytes array
  const preimageFormatted = bytes.arrayify(preimage);

  // Hash and return
  return ethersutils.sha256(preimageFormatted).slice(2);
}

/**
 * Calculates sha512 hash of bytes
 * @param preimage - bytesdata
 * @returns hash
 */
function sha512(preimage: BytesData): string {
  // TODO: Remove reliance on ethers utils
  // Convert to bytes array
  const preimageFormatted = bytes.arrayify(preimage);

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
  // TODO: Remove reliance on ethers utils
  // Convert to bytes array
  const keyFormatted = bytes.arrayify(key);
  const dataFormatted = bytes.arrayify(data);

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
  // TODO: Remove reliance on ethers utils
  // Convert to bytes array
  const preimageFormatted = bytes.arrayify(preimage);

  // Hash and return
  return ethersutils.keccak256(preimageFormatted).slice(2);
}

/**
 * Calculates the poseidon hash of an array of bytes32
 * @param preimage - bytes32 array
 * @returns hash
 */
function poseidon(preimage: BytesData[]): string {
  // TODO: Remove reliance on circomlib
  // Convert all bytes into number strings
  const preimageFormatted = preimage.map((bytedata) => bytes.numberify(bytedata).toString(10));

  // Hash and return bytes
  return poseidonHash(preimageFormatted).toString(16);
}

export default {
  sha256,
  sha512,
  sha512HMAC,
  keccak256,
  poseidon,
};
