import { BytesLike, ethers } from 'ethers';
import hemoji from 'hemoji';
import { arrayify } from './bytes';

/**
 * The function `emojiHash` takes a string and optional parameters for length and spacer, and returns a
 * hashed version of the string using emojis.
 * @param {string} str - The `str` parameter is a string that represents the text or message for which
 * you want to generate an emoji hash.
 * @param {number} [length] - The `length` parameter is an optional parameter that specifies the
 * maximum length of the generated emoji hash. If not provided, the default length will be used (6).
 * @param {string} [spacer] - The `spacer` parameter is an optional string that is used to separate
 * each character in the resulting emoji hash. If no spacer is provided, the default value is a space
 * string.
 * @returns a string that represents the emoji hash of the input string.
 */
export const emojiHash = (str: string, length?: number, spacer?: string) => {
  return hemoji(str, { length, spacer });
};

export const emojiHashForPOIStatusInfo = (str: string) => {
  return emojiHash(str, 2, '');
};

const bytesLikeify = (data: BytesLike): Uint8Array => {
  return new Uint8Array(arrayify(data));
};

/**
 * Calculates sha256 hash of bytes
 * @returns hash
 */
function sha256(preImage: BytesLike): string {
  // Hash and return
  return ethers.sha256(bytesLikeify(preImage)).slice(2);
}

/**
 * Calculates sha512 hash of bytes
 * @param preImage - bytesdata
 * @returns hash
 */
function sha512(preImage: BytesLike): string {
  return ethers.sha512(bytesLikeify(preImage)).slice(2);
}

/**
 * Calculates sha512 hmac
 * @returns hmac
 */
function sha512HMAC(key: BytesLike, data: BytesLike): string {
  return ethers.computeHmac('sha512', bytesLikeify(key), bytesLikeify(data)).slice(2);
}

/**
 * Calculates keccak256 hash of bytes
 * @returns hash
 */
function keccak256(preImage: BytesLike): string {
  return ethers.keccak256(bytesLikeify(preImage)).slice(2);
}

export { sha256, sha512, sha512HMAC, keccak256 };
