/* eslint-disable no-bitwise */
// @ts-ignore
import { babyjub, eddsa } from 'circomlibjs';
import {
  arrayify,
  numberify,
  hexlify,
  random as randomBytes,
  formatToByteLength,
  ByteLength,
} from './bytes';
import { poseidon, sha256 } from './hash';

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
  const seedHash = arrayify(poseidon([seed]));

  // Prune seed hash
  seedHash[0] &= 0xf8;
  seedHash[31] &= 0x7f;
  seedHash[31] |= 0x40;

  // Convert from little endian bytes to number and shift right
  const key = numberify(seedHash, 'le').shrn(3);

  // Return hex bytes key
  return hexlify(key);
}

/**
 * Packs babyjubjub point
 * @param unpacked - unpacked point to pack
 * @returns packed point
 */
function packPoint(unpacked: BytesData[]): string {
  // TODO: remove dependance on circomlibjs
  if (unpacked.length !== 2) throw new Error('Invalid unpacked length (length != 2)');
  // Format point elements
  const unpackedFormatted = unpacked.map((element) => BigInt(numberify(element).toString(10)));
  // Pack point
  try {
    return hexlify(babyjub.packPoint(unpackedFormatted));
  } catch (e: any) {
    throw new Error(`babyjubjub: Invalid point: ${e?.message}`);
  }
}

/**
 * Unpacks babyjubjub point
 * @param packed - packed point to unpack
 * @returns unpacked point
 */
function unpackPoint(packed: BytesData): string[] {
  // TODO: remove dependance on circomlibjs
  // Unpack point
  const unpacked: BigInt[] = babyjub.unpackPoint(arrayify(packed));

  if (unpacked === null) {
    throw Error('Invalid point: null');
  }
  return unpacked.map((element) => {
    // Convert to byte string
    const elementBytes = element.toString(16);

    // Pad to even length if needed
    return elementBytes.length % 2 === 0
      ? elementBytes
      : elementBytes.padStart(elementBytes.length + 1, '0');
  });
}

/**
 * Performs an ECDH key derivation
 * @param privateKey - private key to derive shared key from
 * @param pubkey - public key to derive shared key from
 * @returns shared key
 */
function ecdh(privateKey: BytesData, pubkey: BytesData): string {
  // TODO: remove dependance on circomlibjs
  // TODO: OPTIMISE HEAVILY, THIS IS THE PRIMARY REASON WALLET SCAN IS SO SLOW
  // Unpack public key and map to BigInt
  const pubkeyUnpacked = unpackPoint(pubkey).map((element) => BigInt(`0x${element}`));

  // Convert private key to BigInt
  const privateKeyBI = BigInt(`0x${privateKey}`);

  // Perform scalar mul, pack, and hash to return 32 byte shared key
  return sha256(babyjub.packPoint(babyjub.mulPointEscalar(pubkeyUnpacked, privateKeyBI)));
}

/**
 * Convert babyjubjub private key to public key
 * @param privateKey - private key
 * @returns public key
 */
function privateKeyToPubKey(privateKey: BytesData): string {
  // TODO: remove dependance on circomlibjs
  // Format as number string
  const privateKeyFormatted = numberify(privateKey).toString(10);

  // Calculate pubkey
  const pubKey = babyjub
    .mulPointEscalar(babyjub.Base8, privateKeyFormatted)
    .map((element: BigInt) => {
      const elementString = element.toString(16);
      return elementString.length % 2 === 0
        ? elementString
        : elementString.padStart(elementString.length + 1, '0');
    });

  // Pack and return
  return packPoint(pubKey);
}

/**
 * Unpack pubKey string into 2 element array.
 * @param pubKey - public key
 * @returns unpacked public key
 */
function unpackPubKey(pubKey: BytesData): BytesData[] {
  return unpackPoint(pubKey).map((element) => formatToByteLength(element, ByteLength.UINT_256));
}

function random() {
  return poseidon([randomBytes(32)]);
}

/**
 * EdDSA signs a message with babyjubjub private key
 * @param privateKey - private key to sign with
 * @param data - array byte chunks to sign
 * @returns signed data
 */
function sign(privateKey: bigint, data: BytesData[]): object {
  const msghash = poseidon(data);

  return eddsa.signPoseidon(privateKey, msghash);
}

function randomPubkey(): string {
  return privateKeyToPubKey(seedToPrivateKey(randomBytes(32)))[1];
}

export {
  seedToPrivateKey,
  packPoint,
  unpackPoint,
  ecdh,
  privateKeyToPubKey,
  unpackPubKey,
  random,
  sign,
  randomPubkey,
};
