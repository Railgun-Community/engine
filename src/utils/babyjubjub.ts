/* eslint-disable no-bitwise */
// @ts-ignore
import { babyjub } from 'circomlibjs';
import { createPrimeField } from '@guildofweavers/galois';
import bytes from './bytes';
import hash from './hash';
import constants from './constants';

import type { BytesData } from './bytes';

const ffModulus = BigInt(constants.SNARK_PRIME.toString());
const FiniteField = createPrimeField(ffModulus, true);

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
  const unpacked: bigint[] = babyjub.unpackPoint(bytes.arrayify(packed));

  return unpacked.map((element) => {
    // Convert to byte string
    const elementBytes = element.toString(16);

    // Pad to even length if needed
    return elementBytes.length % 2 === 0 ? elementBytes : elementBytes.padStart(elementBytes.length + 1, '0');
  });
}

/**
 * Get element from the finite field
 * @param el - Base 10 integer to coerce into the ff
 * @returns ff element
 */
function getFFElement(el: string): bigint {
  const parsedNumber = BigInt(el);

  if (parsedNumber < 0) {
    throw new Error('Element not in the finite field');
  }

  const ffElement = parsedNumber % ffModulus;
  if (!FiniteField.isElement(ffElement)) {
    throw new Error('Element not in the finite field');
  }

  return ffElement;
}

/**
 * Add two points together
 * @param a - point a
 * @param b - point b
 * @returns new point
 */
function addPoint(a: bigint[], b: bigint[]): bigint[] {
  // @ts-ignore
  const res: bigint[] = new Array<bigint>(2);
  const F = FiniteField;

  const A = getFFElement('168700');
  const D = getFFElement('168696');

  const beta = F.mul(a[0], b[1]);
  const gamma = F.mul(a[1], b[0]);
  const delta = F.mul(
    F.sub(a[1], F.mul(A, a[0])),
    F.add(b[0], b[1]),
  );
  const tau = F.mul(beta, gamma);
  const dtau = F.mul(D, tau);

  res[0] = F.div(
    F.add(beta, gamma),
    F.add(F.one, dtau),
  );

  res[1] = F.div(
    F.add(delta, F.sub(F.mul(A, beta), gamma)),
    F.sub(F.one, dtau),
  );

  return res;
}

/**
 * Multiply point by an escalar
 * @param base point
 * @param escalar one escalar
 * @returns new point
 */
function mulPointEscalar(base: bigint[], escalar: bigint): bigint[] {
  let res = [getFFElement('0'), getFFElement('1')];
  let rem = escalar;
  let exp = base;

  while (rem !== BigInt(0)) {
    const isOdd = (a: bigint): boolean => (BigInt(a) & BigInt(1)) === BigInt(1);

    if (isOdd(rem)) {
      res = addPoint(res, exp);
    }
    exp = addPoint(exp, exp);
    rem >>= BigInt(1);
  }

  return res;
}

/**
 * Performs an ECDH key derivation
 * @param privateKey - private key to derive shared key from
 * @param publicKey - public key to derive shared key from
 * @returns shared key
 */
function ecdh(privateKey: BytesData, publicKey: BytesData): string {
  // TODO: remove dependance on circomlibjs
  // TODO: OPTIMISE HEAVILY, THIS IS THE PRIMARY REASON WALLET SCAN IS SO SLOW
  // Unpack public key and map to BigInt
  const publicKeyUnpacked = unpackPoint(publicKey).map((element) => BigInt(`0x${element}`));

  // Convert private key to BigInt
  const privateKeyBI = BigInt(`0x${privateKey}`);

  // Perform scalar mul
  const sharedKey = mulPointEscalar(publicKeyUnpacked, privateKeyBI)[0].toString(16);

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
    .map((element: bigint) => {
      const elementString = element.toString(16);
      return elementString.length % 2 === 0
        ? elementString
        : elementString.padStart(elementString.length + 1, '0');
    });

  // Pack and return
  return packPoint(publicKey);
}

export default {
  getFFElement,
  addPoint,
  mulPointEscalar,
  seedToPrivateKey,
  packPoint,
  unpackPoint,
  ecdh,
  privateKeyToPublicKey,
};
