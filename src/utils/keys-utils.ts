import * as curve25519 from '@noble/ed25519';
import { eddsa, poseidon, Signature } from 'circomlib';
import { randomBytes } from '@noble/hashes/utils';
import { hexlify } from './bytes';

function getPublicSpendingKey(privateKey: Uint8Array): [bigint, bigint] {
  return eddsa.prv2pub(Buffer.from(privateKey));
}

async function getPublicViewingKey(privateViewingKey: Uint8Array): Promise<Uint8Array> {
  const extendedPoint = await curve25519.utils.getExtendedPublicKey(privateViewingKey);
  return extendedPoint.point.toX25519();
}

function getRandomScalar(): bigint {
  return poseidon([BigInt(hexlify(randomBytes(32), true))]);
}

function signEDDSA(privateKey: Uint8Array, message: bigint): Signature {
  return eddsa.signPoseidon(Buffer.from(privateKey), message);
}

function verifyEDDSA(msg: bigint, signature: Signature, pubkey: [bigint, bigint]) {
  return eddsa.verifyPoseidon(msg, signature, pubkey);
}

async function getEphemeralKeys(
  senderVPK: Uint8Array,
  recipientVPK: Uint8Array,
): Promise<Uint8Array[]> {
  const random = randomBytes(32);
  const { head } = await curve25519.utils.getExtendedPublicKey(random);
  const rS = curve25519.curve25519.scalarMult(head, senderVPK);
  const rR = curve25519.curve25519.scalarMult(head, recipientVPK);
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
  getEphemeralKeys,
  getSharedSymmetricKey,
  poseidon,
};
