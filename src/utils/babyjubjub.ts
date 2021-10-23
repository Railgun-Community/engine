/* eslint-disable no-bitwise */
// @ts-ignore
import { babyjub } from 'circomlibjs';
import bytes from './bytes';
import hash from './hash';

import type { BytesData } from './bytes';

/**
 * Converts 32 byte seed to babyjubjub point
 * @param seed - 32 byte seed to convert to babyjubjub point
 * @returns private key
 */
function seedToPrivateKey(seed: BytesData): string {
  // TODO: clarify this explanation
  // https://tools.ietf.org/html/rfc8032
  // Because of the 'buff[0] & 0xF8' part which makes sure you have a point
  // with order that 8 divides (^ pruneBuffer)
  // Every point in babyjubjub is of the form: aP + bH, where H has order 8
  // and P has a big large prime order
  // guaranteeing that any low order points in babyjubjub get deleted

  // Get poseidon hash of seed
  const seedHash = bytes.arrayify(hash.poseidon([seed]));

  // Prune seed hash
  seedHash[0] &= 0xF8;
  seedHash[31] &= 0x7F;
  seedHash[31] |= 0x40;

  // Convert from little endian bytes to number and shift right
  const key = bytes.numberify(seedHash, 'le').shrn(3);

  // Return hex bytes key
  return bytes.hexlify(key);
}

/**
 * Packs babyjubjub point
 * @param unpacked - unpacked point to pack
 * @returns packed point
 */
function packPoint(unpacked: BytesData[]): string {
  // TODO: remove dependance on circomlibjs
  // Format point elements
  const unpackedFormatted = unpacked.map(
    (element) => BigInt(bytes.numberify(element).toString(10)),
  );

  // Pack point
  return bytes.hexlify(babyjub.packPoint(unpackedFormatted));
}

/**
 * Unpacks babyjubjub point
 * @param packed - packed point to unpack
 * @returns unpacked point
 */
function unpackPoint(packed: BytesData): string[] {
  // TODO: remove dependance on circomlibjs
  // Unpack point
  const unpacked: BigInt[] = babyjub.unpackPoint(bytes.arrayify(packed));

  return unpacked.map((element) => {
    // Convert to byte string
    const elementBytes = element.toString(16);

    // Pad to even length if needed
    return elementBytes.length % 2 === 0 ? elementBytes : elementBytes.padStart(elementBytes.length + 1, '0');
  });
}

/**
 * Performs an ECDH key derivation
 * @param privateKey - private key to derive shared key from
 * @param publicKey - public key to derive shared key from
 * @returns shared key
 */
function ecdh(privateKey: BytesData, publicKey: BytesData): string {
  // TODO: remove dependance on circomlibjs
  // Unpack public key and map to BigInt
  const publicKeyUnpacked = unpackPoint(publicKey).map((element) => BigInt(`0x${element}`));

  // Convert private key to BigInt
  const privateKeyBI = BigInt(`0x${privateKey}`);

  // Perform scalar mul
  const sharedKey = babyjub.mulPointEscalar(publicKeyUnpacked, privateKeyBI)[0].toString(16);

  // Pad to even length if needed
  return sharedKey.length % 2 === 0 ? sharedKey : sharedKey.padStart(sharedKey.length + 1, '0');
}

/**
 * Convert babyjubjub private key to public key
 * @param privateKey - private key
 * @returns public key
 */
function privateKeyToPublicKey(privateKey: BytesData): string {
  // TODO: remove dependance on circomlibjs
  // Format as number string
  const privateKeyFormatted = bytes.numberify(privateKey).toString(10);

  // Calculate publicKey
  const publicKey = babyjub.mulPointEscalar(babyjub.Base8, privateKeyFormatted)
    .map((element: BigInt) => {
      const elementString = element.toString(16);
      return elementString.length % 2 === 0
        ? elementString
        : elementString.padStart(elementString.length + 1, '0');
    });

  // Pack and return
  return packPoint(publicKey);
}

export default {
  seedToPrivateKey,
  packPoint,
  unpackPoint,
  ecdh,
  privateKeyToPublicKey,
};
