import crypto from 'crypto';

/**
 * Pads byte data to specified length
 *
 * @param data - bytes data
 * @param length - length in bytes to pad to
 * @param side - whether to pad left or right
 * @returns padded bytes data
 */
function padToLength(
  data: ArrayLike<number> | string,
  length: number,
  side: 'left' | 'right' = 'left',
): ArrayLike<number> | string {
  if (typeof data === 'string') {
    // Check if data length exceeds padding length
    if (data.length > length * 2) {
      throw new Error('Data exceeds length');
    }

    // If we're requested to pad to left, pad left and return
    if (side === 'left') {
      return data.padStart(length * 2, '0');
    }

    // Else pad right and return
    return data.padEnd(length * 2, '0');
  }

  // Check if data length exceeds padding length
  if (data.length > length) {
    throw new Error('Data exceeds length');
  }

  // Coerce data into array
  const dataArray = Array.from(data);

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
 * Generates random bytes
 *
 * @param length - number of bytes to generate
 * @returns random bytes hex string
 */
function random(length: number = 32): string {
  return crypto.randomBytes(length).toString('hex');
}

export default {
  padToLength,
  random,
};
