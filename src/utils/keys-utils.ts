import * as curve25519 from '@noble/ed25519';
import { bytesToHex, randomBytes } from '@noble/hashes/utils';
import { eddsa, Signature } from 'circomlibjs';
import { hexlify } from './bytes';
import { poseidon } from './hash';

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

async function getEphemeralKeys(
  senderVPK: Uint8Array,
  recipientVPK: Uint8Array,
): Promise<Uint8Array[]> {
  const random = randomBytes(32);
  const S = curve25519.Point.fromHex(bytesToHex(senderVPK)).toX25519();
  const R = curve25519.Point.fromHex(bytesToHex(recipientVPK)).toX25519();
  const { head } = await curve25519.utils.getExtendedPublicKey(random);
  const rS = curve25519.curve25519.scalarMult(head, S);
  const rR = curve25519.curve25519.scalarMult(head, R);
  return [rS, rR];
}

async function getSharedSymmetricKey(
  privateKey: Uint8Array,
  publicKey: Uint8Array,
): Promise<Uint8Array> {
  const { head } = await curve25519.utils.getExtendedPublicKey(privateKey);
  return curve25519.curve25519.scalarMult(head, publicKey);
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
    getSharedSymmetricKey,
};

