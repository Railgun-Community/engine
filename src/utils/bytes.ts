/* eslint-disable no-bitwise */
import BN from 'bn.js';
import crypto from 'crypto';

export type BytesData = ArrayLike<number> | string | BN;

/**
 * Generates random bytes
 * @param length - number of bytes to generate
 * @returns random bytes hex string
 */
function random(length: number = 32): string {
  return crypto.randomBytes(length).toString('hex');
}

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
function arrayify(data: BytesData): number[] {
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
 * @param endian - bytes endianess
 * @returns BN.js object
 */
function numberify(data: BytesData, endian: 'be' | 'le' = 'be'): BN {
  // If we're a BN already, return
  if (data instanceof BN) {
    return data;
  }

  // If we're a hex string create a BN object from it and return
  if (typeof data === 'string') {
    return new BN(data, 'hex', endian);
  }

  // Coerce ArrayLike to Array
  const dataArray: number[] = Array.from(data);

  // Create BN object from array and return
  return new BN(dataArray, undefined, endian);
}

/**
 * Pads byte data to specified length
 * @param data - bytes data
 * @param length - length in bytes to pad to
 * @param side - whether to pad left or right
 * @returns padded bytes data
 */
function padToLength(
  data: BytesData,
  length: number,
  side: 'left' | 'right' = 'left',
): BytesData {
  // Can't pad a number, if we get a number convert to hex string
  const dataFormatted = data instanceof BN ? hexlify(data) : data;

  if (typeof dataFormatted === 'string') {
    // Check if data length exceeds padding length
    if (dataFormatted.length > length * 2) {
      throw new Error('Data exceeds length');
    }

    // If we're requested to pad to left, pad left and return
    if (side === 'left') {
      return dataFormatted.padStart(length * 2, '0');
    }

    // Else pad right and return
    return dataFormatted.padEnd(length * 2, '0');
  }

  // Check if data length exceeds padding length
  if (dataFormatted.length > length) {
    throw new Error('Data exceeds length');
  }

  // Coerce data into array
  const dataArray = Array.from(dataFormatted);

  if (side === 'left') {
    // If side is left, unshift till length
    while (dataArray.length < length) {
      dataArray.unshift(0);
    }
  } else {
    // If side is right, push till length
    while (dataArray.length < length) {
      dataArray.push(0);
    }
  }

  // Return dataArray
  return dataArray;
}

/**
 * Converts bytes to string
 * @param data - bytes data to convert
 * @param encoding - string encoding to use
 */
function toUTF8String(data: BytesData): string {
  // TODO: Remove reliance on Buffer
  return Buffer.from(arrayify(data)).toString('utf8');
}

/**
 * Converts string to bytes
 * @param string - string to convert to bytes
 * @param encoding - string encoding to use
 */
function fromUTF8String(string: string): string {
  // Initialize byte array
  const data: number[] = [];

  // Loop through each char
  for (let i = 0; i < string.length; i += 1) {
    // Get code point
    const codePoint = string.charCodeAt(i);

    if (codePoint < 0x80) {
      // Single byte codepoint
      data.push(codePoint);
    } else if (codePoint < 0x0800) {
      // 2 byte codepoint
      data.push((codePoint >> 6) | 0xc0);
      data.push((codePoint & 0x3f) | 0x80);
    } else if ((codePoint & 0xfc00) === 0xd800) {
      // Surrogate pair

      // Increment and get next codepoint
      i += 1;
      const codePoint2 = string.charCodeAt(i);

      // Get pair
      const pair = 0x10000 + ((codePoint & 0x03ff) << 10) + (codePoint2 & 0x03ff);

      // Push each 2 byte
      data.push((pair >> 18) | 0xf0);
      data.push(((pair >> 12) & 0x3f) | 0x80);
      data.push(((pair >> 6) & 0x3f) | 0x80);
      data.push((pair & 0x3f) | 0x80);
    } else {
      // 3 byte codepoint
      data.push((codePoint >> 12) | 0xe0);
      data.push(((codePoint >> 6) & 0x3f) | 0x80);
      data.push((codePoint & 0x3f) | 0x80);
    }
  }

  // Return hexlified string
  return hexlify(data);
}

export default {
  random,
  hexlify,
  arrayify,
  numberify,
  padToLength,
  toUTF8String,
  fromUTF8String,
};
