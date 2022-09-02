import * as curve25519 from '@noble/ed25519';
import { eddsa, Signature } from 'circomlibjs';
import { hexlify, hexToBytes } from './bytes';
import { poseidon, sha256 } from './hash';

const { bytesToHex, randomBytes } = curve25519.utils;

function getPublicSpendingKey(privateKey: Uint8Array): [bigint, bigint] {
  return eddsa.prv2pub(Buffer.from(privateKey));
}

async function getPublicViewingKey(privateViewingKey: Uint8Array): Promise<Uint8Array> {
  return await curve25519.getPublicKey(privateViewingKey);
}

function getRandomScalar(): bigint {
  return poseidon([BigInt(hexlify(randomBytes(32), true))]);
}

function signEDDSA(privateKey: Uint8Array, message: bigint): Signature {
  return eddsa.signPoseidon(Buffer.from(privateKey), message);
}

function verifyEDDSA(message: bigint, signature: Signature, pubkey: [bigint, bigint]) {
  return eddsa.verifyPoseidon(message, signature, pubkey);
}

async function signED25519(message: Uint8Array, privateKey: Uint8Array): Promise<Uint8Array> {
  return curve25519.sign(message, privateKey);
}

function verifyED25519(
  message: Uint8Array,
  signature: Uint8Array,
  pubkey: Uint8Array,
): Promise<boolean> {
  return curve25519.verify(signature, message, pubkey);
}

function adjustRandom(random: string): bigint {
  const randomArray = hexToBytes(sha256(random));
  randomArray[0] &= 248;
  randomArray[31] &= 127;
  randomArray[31] |= 64;
  return BigInt(`0x${bytesToHex(randomArray)}`) % curve25519.CURVE.n;
}

async function getEphemeralKeys(
  senderVPK: Uint8Array,
  recipientVPK: Uint8Array,
  random: string,
): Promise<[Uint8Array, Uint8Array]> {
  const r = adjustRandom(random);
  const S = curve25519.Point.fromHex(bytesToHex(senderVPK));
  const R = curve25519.Point.fromHex(bytesToHex(recipientVPK));
  const rS = S.multiply(r).toRawBytes();
  const rR = R.multiply(r).toRawBytes();
  return [rS, rR];
}

function unblindedEphemeralKey(VPK: Uint8Array, random: string): Uint8Array {
  const r = adjustRandom(random);
  const rInverse = curve25519.utils.invert(r, curve25519.CURVE.n);
  const point = curve25519.Point.fromHex(bytesToHex(VPK));
  return point.multiply(rInverse).toRawBytes();
}

async function getSharedSymmetricKey(
  privateKey: Uint8Array,
  publicKey: Uint8Array,
): Promise<Uint8Array | undefined> {
  try {
    const pk = curve25519.Point.fromHex(bytesToHex(publicKey));
    const { scalar } = await curve25519.utils.getExtendedPublicKey(privateKey);
    return pk.multiply(scalar).toRawBytes();
  } catch (err) {
    return undefined;
  }
}

export {
  getPublicSpendingKey,
  getPublicViewingKey,
  getRandomScalar,
  signEDDSA,
  verifyEDDSA,
  signED25519,
  verifyED25519,
  getEphemeralKeys,
  unblindedEphemeralKey,
  getSharedSymmetricKey,
};
