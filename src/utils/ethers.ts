import { Result } from 'ethers';

export const recursivelyDecodeResult = (result: Result): any => {
  if (typeof result !== 'object') {
    // End (primitive) value
    return result;
  }
  try {
    const obj = result.toObject();
    if ('_' in obj) {
      throw new Error('Decode as array, not object');
    }
    Object.keys(obj).forEach((key) => {
      obj[key] = recursivelyDecodeResult(obj[key]);
    });
    return obj;
  } catch (err) {
    // Result is array.
    return result.toArray().map((item) => recursivelyDecodeResult(item as Result));
  }
};
