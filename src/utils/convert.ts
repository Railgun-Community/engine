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

  // Coerce ArrayLike to Array
  const dataArray: number[] = Object.values(data);

  // Convert array of bytes to hex string and return
  return dataArray.map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Coerces bytesdata into Uint8Array of bytes
 * @param data - bytes data to coerce
 * @returns byte array
 */
function arrayify(data: BytesData): ArrayLike<number> {
  // If we're already a byte array return
  if (typeof data !== 'string') {
    return data;
  }

  // Create empty Uint8Array
  const bytesArray: number[] = [];

  // Loop through each nibble and push to array
  for (let i = 0; i < data.length; i += 2) {
    bytesArray.push(parseInt(data.substr(i, 2), 16));
  }

  // Return bytes array
  return bytesArray;
}

export default {
  hexlify,
  arrayify,
};
