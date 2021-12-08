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
 * Coerces BytesData into hex string format
 * @param data - bytes data to coerce
 * @param prefix - prefix with 0x
 * @returns hex string
 */
function hexlify(data: BytesData, prefix = false): string {
  let hexString = '';

  if (typeof data === 'string') {
    // If we're already a string return the string
    // Strip leading 0x if it exists before returning
    hexString = data.startsWith('0x') ? data.slice(2) : data;
  } else if (data instanceof BN) {
    // If we're a BN object convert to string
    // Return hex string 0 padded to even length, if length is 0 then set to 2
    hexString = data.toString('hex', data.byteLength() * 2 || 2);
  } else {
    // We're an ArrayLike
    // Coerce ArrayLike to Array
    const dataArray: number[] = Array.from(data);

    // Convert array of bytes to hex string
    hexString = dataArray.map((byte) => byte.toString(16).padStart(2, '0')).join('');
  }

  // Return 0x prefixed hex string if specified
  if (prefix) {
    return `0x${hexString}`;
  }

  // Else return plain hex string
  return hexString;
}

/**
 * Coerces BytesData into array of bytes
 * @param data - bytes data to coerce
 * @returns byte array
 */
function arrayify(data: BytesData): number[] {
  // If we're a BN object, convert to bytes array and return
  if (data instanceof BN) {
    // Else return bytes array
    return data.toArray();
  }

  // If we're already a byte array return array coerced data
  if (typeof data !== 'string') {
    return Array.from(data);
  }

  // Remove leading 0x if exists
  const dataFormatted = data.startsWith('0x') ? data.slice(2) : data;

  // Create empty array
  const bytesArray: number[] = [];

  // Loop through each byte and push to array
  for (let i = 0; i < dataFormatted.length; i += 2) {
    bytesArray.push(parseInt(dataFormatted.substr(i, 2), 16));
  }

  // Return bytes array
  return bytesArray;
}

/**
 * Coerces BytesData into BN.js object
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
    // Remove leading 0x if exists
    const dataFormatted = data.startsWith('0x') ? data.slice(2) : data;

    return new BN(dataFormatted, 'hex', endian);
  }

  // Coerce ArrayLike to Array
  const dataArray: number[] = Array.from(data);

  // Create BN object from array and return
  return new BN(dataArray, undefined, endian);
}

/**
 * Pads BytesData to specified length
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
    const dataFormattedString = dataFormatted.startsWith('0x') ? dataFormatted.slice(2) : dataFormatted;

    // Check if data length exceeds padding length
    if (dataFormattedString.length > length * 2) {
      throw new Error('Data exceeds length');
    }

    // If we're requested to pad to left, pad left and return
    if (side === 'left') {
      return dataFormatted.startsWith('0x')
        ? `0x${dataFormattedString.padStart(length * 2, '0')}`
        : dataFormattedString.padStart(length * 2, '0');
    }

    // Else pad right and return
    return dataFormatted.startsWith('0x')
      ? `0x${dataFormattedString.padEnd(length * 2, '0')}`
      : dataFormattedString.padEnd(length * 2, '0');
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
 * Reverses order of bytes
 * @param data - bytes to reverse
 * @returns reversed bytes
 */
function reverseBytes(data: ArrayLike<number> | string): typeof data {
  // TODO: Allow reversing number bytes
  // TODO: Conditional type return or overload so passed param and return are same type
  if (typeof data === 'string') {
    // Split to bytes array, reverse, join, and return
    return data.split(/(..)/g).reverse().join('');
  }

  // Coerce to array and reverse
  return Array.from(data).reverse();
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

/**
 * Split bytes into array of chunks
 * @param data - data to chunk
 * @param size - size of chunks
 * @returns chunked data
 */
function chunk(data: BytesData, size = 32): string[] {
  // Convert to hex string
  const dataFormatted = hexlify(data);

  // Split into byte chunks and return
  return dataFormatted.match(new RegExp(`.{1,${size * 2}}`, 'g')) || [];
}

/**
 * Combines array of BytesData into single BytesData
 * @param data - data to chunk
 * @param size - size of chunks
 * @returns chunked data
 */
function combine(data: BytesData[]): string {
  // Convert all chunks into hex strings
  const dataFormatted = data.map((element) => hexlify(element));

  // Combine and return
  return dataFormatted.join('');
}

/**
 * Trim to length of bytes
 * @param data - data to trim
 * @param length - length to trim to
 * @param side - side to trim from
 * @returns trimmed data
 */
function trim(data: BytesData, length: number, side: 'left' | 'right' = 'left'): BytesData {
  if (data instanceof BN) {
    if (side === 'left') {
      // If side is left, mask to byte length
      return data.maskn(length * 8);
    }

    // Can't trim from right as we don't know the byte length of BN objects
    throw new Error('Can\t trim BN from right');
  } else if (typeof data === 'string') {
    const dataFormatted = data.startsWith('0x') ? data.slice(2) : data;

    if (side === 'left') {
      // If side is left return the last length bytes
      return data.startsWith('0x')
        ? `0x${dataFormatted.slice(dataFormatted.length - length * 2)}`
        : dataFormatted.slice(dataFormatted.length - length * 2);
    }

    // Side is right, return the start of the string to length
    return data.startsWith('0x')
      ? `0x${dataFormatted.slice(0, length * 2)}`
      : dataFormatted.slice(0, length * 2);
  }

  // Coerce to array
  const dataFormatted = Array.from(data);

  if (side === 'left') {
    // If side is left return the last length bytes
    return dataFormatted.slice(data.length - length);
  }

  // Side is right, return the start of the array to length
  return dataFormatted.slice(0, length);
}

export {
  random,
  hexlify,
  arrayify,
  numberify,
  padToLength,
  reverseBytes,
  toUTF8String,
  fromUTF8String,
  chunk,
  combine,
  trim,
};
