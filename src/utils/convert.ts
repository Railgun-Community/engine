import * as ethers from 'ethers';

/**
 * Converts byte array to hex string
 * @param arr - array to convert
 * @returns hex string
 */
function hexlify(arr: ArrayLike<number>): string {
  // Pass to ethers hexlify and remove leaving 0x
  return ethers.utils.hexlify(arr).slice(2);
}

/**
 * Converts hex string to byte array
 * @param hexString - hex string to convert
 * @returns byte array
 */
function arrayify(hexString: string): Uint8Array {
  // Pass to ethers arrayify with leading 0x
  return ethers.utils.arrayify(`0x${hexString}`);
}

export default {
  hexlify,
  arrayify,
};
