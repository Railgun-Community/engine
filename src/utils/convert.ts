import BN from 'bn.js';
import type { BytesData } from './globaltypes';

/**
 * Coerces bytesdata into hex string format
 * @param data - bytes data to coerce
 * @returns hex string
 */
function hexlify(data: BytesData): string {
  // If we're already a string return the string
  if (typeof data === 'string') {
    // Strip leading 0x if it exists before returning
    return data.startsWith('0x') ? data.slice(2) : data;
  }

  // If we're a BN object convert to string and return
  if (data instanceof BN) {
    // If value is 0, return empty string
    if (data.isZero()) {
      return '';
    }

    // Else return hex string 0 padded to even length
    return data.toString('hex', data.byteLength() * 2);
  }

  // Coerce ArrayLike to Array
  const dataArray: number[] = Array.from(data);

  // Convert array of bytes to hex string and return
  return dataArray.map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Coerces bytesdata into array of bytes
 * @param data - bytes data to coerce
 * @returns byte array
 */
function arrayify(data: BytesData): Array<number> {
  // If we're a BN object, convert to bytes array and return
  if (data instanceof BN) {
    // If value is 0, return empty array
    if (data.isZero()) {
      return [];
    }

    // Else return bytes array
    return data.toArray();
  }

  // If we're already a byte array return array coerced data
  if (typeof data !== 'string') {
    return Array.from(data);
  }

  // Create empty array
  const bytesArray: number[] = [];

  // Loop through each byte and push to array
  for (let i = 0; i < data.length; i += 2) {
    bytesArray.push(parseInt(data.substr(i, 2), 16));
  }

  // Return bytes array
  return bytesArray;
}

/**
 * Coerces bytesdata into BN.js object
 * @param data - bytes data to coerce
 * @returns BN.js object
 */
function numberify(data: BytesData): BN {
  // If we're a BN already, return
  if (data instanceof BN) {
    return data;
  }

  // If we're a hex string create a BN object from it and return
  if (typeof data === 'string') {
    return new BN(data, 'hex');
  }

  // Coerce ArrayLike to Array
  const dataArray: number[] = Array.from(data);

  // Create BN object from array and return
  return new BN(dataArray);
}

export default {
  hexlify,
  arrayify,
  numberify,
};
