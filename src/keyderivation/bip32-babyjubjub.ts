import BN from 'bn.js';
import { bytes, hash } from '../utils';

export type KeyNode = {
  chainKey: string,
  chainCode: string,
};

const CURVE_SEED = bytes.fromUTF8String('babyjubjub seed');
const HARDENED_OFFSET = 0x80000000;

/**
 * Creates KeyNode from seed
 * @param seed - bip32 seed
 * @returns key node
 */
function getMasterKeyFromSeed(seed: bytes.BytesData): KeyNode {
  // HMAC with seed to get I
  const I = hash.sha512HMAC(CURVE_SEED, seed);

  // Slice 32 bytes for IL and IR values, IL = key, IR = chainCode
  const chainKey = I.slice(0, 64);
  const chainCode = I.slice(64);

  // Return node
  return {
    chainKey,
    chainCode,
  };
}

/**
 * Derive child KeyNode from KeyNode via hardened derivation
 * @param node - KeyNode to derive from
 * @param index - index of child
 */
function childKeyDerivationHardened(node: KeyNode, index: number): KeyNode {
  // Convert index to bytes as 32bit big endian
  const indexFormatted = bytes.padToLength(new BN(index + HARDENED_OFFSET), 4);

  // Calculate HMAC preimage
  const preimage = `00${node.chainKey}${indexFormatted}`;

  // Calculate I
  const I = hash.sha512HMAC(node.chainCode, preimage);

  // Slice 32 bytes for IL and IR values, IL = key, IR = chainCode
  const chainKey = I.slice(0, 64);
  const chainCode = I.slice(64);

  // Return node
  return {
    chainKey,
    chainCode,
  };
}

/**
 * Tests derivation path to see if it's valid
 * @param path - bath to test
 * @returns valid
 */
function isValidPath(path: string): boolean {
  return /^m(\/[0-9]+')+$/g.test(path);
}

/**
 * Converts path string into segments
 * @param path - path string to parse
 * @returns array of indexes
 */
function getPathSegments(path: string): number[] {
  // Throw if path is invalid
  if (!isValidPath(path)) throw new Error('Invalid derivation path');

  // Split along '/' to get each component
  // Remove the first segment as it is the 'm'
  // Remove the ' from each segment
  // Parse each segment into an integer
  return path
    .split('/')
    .slice(1)
    .map((val) => val.replace("'", ''))
    .map((el) => parseInt(el, 10));
}

export {
  getMasterKeyFromSeed,
  childKeyDerivationHardened,
  isValidPath,
  getPathSegments,
};
