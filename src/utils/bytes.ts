import BN from 'bn.js';
import { bytesToHex, hexToBytes } from 'ethereum-cryptography/utils';
import { getRandomBytesSync } from 'ethereum-cryptography/random';
import crypto from 'crypto';
import { BytesData } from '../models/formatted-types';
import { isReactNative, isNodejs } from './runtime';

// TextEncoder/TextDecoder (used in this file) needs to shimmed in React Native
if (isReactNative) {
  // eslint-disable-next-line global-require
  require('fast-text-encoding');
}

export enum ByteLength {
  UINT_8 = 1,
  UINT_56 = 7,
  UINT_120 = 15,
  UINT_128 = 16,
  Address = 20,
  UINT_192 = 24,
  UINT_248 = 31,
  UINT_256 = 32,
}

// returns true if string is prefixed with '0x'
const isPrefixed = (str: string): boolean => str.startsWith('0x');

// add 0x if it str isn't already prefixed
const prefix0x = (str: string): string => (isPrefixed(str) ? str : `0x${str}`);

// remove 0x prefix if it exists
export const strip0x = (str: string): string => (isPrefixed(str) ? str.slice(2) : str);

/**
 * convert hex string to BigInt, prefixing with 0x if necessary
 * @param {string} str
 * @returns {bigint}
 */
export function hexToBigInt(str: string): bigint {
  return BigInt(prefix0x(str));
}

export function u8ToBigInt(u8: Uint8Array): bigint {
  // eslint-disable-next-line no-use-before-define
  return hexToBigInt(hexlify(u8));
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
    hexString = strip0x(data);
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
    return `0x${hexString}`.toLowerCase();
  }

  // Else return plain hex string
  return hexString.toLowerCase();
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
  const dataFormatted = strip0x(data);

  // Create empty array
  const bytesArray: number[] = [];

  // Loop through each byte and push to array
  for (let i = 0; i < dataFormatted.length; i += 2) {
    const number = parseInt(dataFormatted.substr(i, 2), 16);
    if (Number.isNaN(number)) {
      throw new Error('Invalid BytesData');
    } else {
      bytesArray.push(number);
    }
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
    const dataFormatted = strip0x(data);
    const invalid = [' ', '-', ''];
    if (invalid.includes(dataFormatted)) {
      throw new Error(`Invalid BytesData: ${dataFormatted}`);
    }
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
): string | number[] {
  // Can't pad a number, if we get a number convert to hex string
  const dataFormatted = data instanceof BN ? hexlify(data) : data;

  if (typeof dataFormatted === 'string') {
    const dataFormattedString = strip0x(dataFormatted);

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
function reverseBytes(data: ArrayLike<number> | string): ArrayLike<number> | string {
  // Use Conditional type return or overload so passed param and return are same type.
  if (typeof data === 'string') {
    // Split to bytes array, reverse, join, and return
    return data.split(/(..)/g).reverse().join('');
  }

  // Coerce to array and reverse
  return Array.from(data).reverse();
}

/**
 * check each character for commonly unsupported codepoints above 0xD800
 * @param string - string to check
 * @throws if invalid character found
 */
function assertBytesWithinRange(string: string) {
  string.split('').forEach((char) => {
    if (char.charCodeAt(0) > 0xd800) {
      throw new Error('Invalid Unicode codepoint > 0xD800');
    }
  });
}

/**
 * Converts bytes to string
 * @param data - bytes data to convert
 * @param encoding - string encoding to use
 */
function toUTF8String(data: BytesData): string {
  // TODO: Remove reliance on Buffer
  const string = new TextDecoder().decode(Buffer.from(arrayify(data)));
  assertBytesWithinRange(string);
  return string;
}

/**
 * Converts string to bytes
 * @param string - string to convert to bytes
 * @param encoding - string encoding to use
 */
function fromUTF8String(string: string): string {
  assertBytesWithinRange(string);
  // Return hexlified string
  return hexlify(new TextEncoder().encode(string));
}

/**
 * Split bytes into array of chunks
 * @param data - data to chunk
 * @param size - size of chunks
 * @returns chunked data
 */
function chunk(data: BytesData, size = ByteLength.UINT_256): string[] {
  // Convert to hex string
  const dataFormatted = hexlify(data);

  // Split into byte chunks and return
  return dataFormatted.match(new RegExp(`.{1,${size * 2}}`, 'g')) || [];
}

/**
 * Combines array of BytesData into single BytesData
 * @param data - data to combine
 * @returns combined data
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

/**
 * Format through hexlify, trim and padToLength given a number of bytes.
 * @param data - data to format
 * @param length - length to format to
 * @returns formatted data
 */
function formatToByteLength(data: BytesData, length: ByteLength, prefix = false): string {
  return trim(padToLength(hexlify(data, prefix), length), length) as string;
}

/**
 * Convert bigint to hex string, 0-padded to even length
 * @param {bigint} n - a bigint
 * @param {boolean} prefix - prefix hex with 0x
 * @return {string} even-length hex
 */
export function nToHex(n: bigint, byteLength: ByteLength, prefix: boolean = false): string {
  if (n < 0) throw new Error('bigint must be positive');
  const hex = formatToByteLength(n.toString(16), byteLength, prefix);
  return prefix ? prefix0x(hex) : hex;
}

/**
 * Convert bigint to Uint8Array
 * @param {bigint} value
 * @returns {Uint8Array}
 */
export function nToBytes(n: bigint, byteLength: ByteLength): Uint8Array {
  return hexToBytes(nToHex(n, byteLength));
}

/**
 * Convert Uint8Array to bigint
 * @param {Uint8Array} bytes
 * @returns {bigint}
 */
export function bytesToN(bytes: Uint8Array): bigint {
  const prefix = true;
  return BigInt(hexlify(bytes, prefix));
}

/**
 * Convert hex string to Uint8Array. Handles prefixed or non-prefixed.
 * @param {bigint} value
 * @returns {Uint8Array}
 */
export function hexStringToBytes(hex: string): Uint8Array {
  return hexToBytes(strip0x(hex));
}

/**
 * Generates random bytes
 * @param length - number of bytes to generate
 * @returns random bytes hex string
 */
function randomHex(length: number = 32): string {
  return isNodejs
    ? crypto.randomBytes(length).toString('hex')
    : bytesToHex(getRandomBytesSync(length));
}

export const HashZero = formatToByteLength('00', 32, true);

export {
  randomHex,
  hexlify,
  arrayify,
  numberify,
  padToLength,
  reverseBytes,
  assertBytesWithinRange,
  toUTF8String,
  fromUTF8String,
  chunk,
  combine,
  trim,
  formatToByteLength,
  hexToBytes,
};
