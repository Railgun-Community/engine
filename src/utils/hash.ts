import * as ethers from 'ethers';

/**
 * Calculates sha256 hash of bytes
 * @param preimage - hex string or Uint8Array
 * @returns hash
 */
function sha256(preimage: string | Uint8Array): string {
  if (typeof preimage === 'string') {
    // If type is a string, pass to ethers sha256 with leading 0x
    return ethers.utils.sha256(`0x${preimage}`).slice(2);
  }

  // Else pass array to ethers sha256 directly
  return ethers.utils.sha256(preimage).slice(2);
}

/**
 * Calculates sha512 hash of bytes
 * @param preimage - hex string or Uint8Array
 * @returns hash
 */
function sha512(preimage: string | Uint8Array): string {
  if (typeof preimage === 'string') {
    // If type is a string, pass to ethers sha512 with leading 0x
    return ethers.utils.sha512(`0x${preimage}`).slice(2);
  }

  // Else pass array to ethers sha512 directly
  return ethers.utils.sha512(preimage).slice(2);
}

/**
 * Calculates keccak256 hash of bytes
 * @param preimage - hex string or Uint8Array
 * @returns hash
 */
function keccak256(preimage: string | Uint8Array): string {
  if (typeof preimage === 'string') {
    // If type is a string, pass to ethers keccak256 with leading 0x
    return ethers.utils.keccak256(`0x${preimage}`).slice(2);
  }

  // Else pass array to ethers keccak256 directly
  return ethers.utils.keccak256(preimage).slice(2);
}

export default {
  sha256,
  sha512,
  keccak256,
};
