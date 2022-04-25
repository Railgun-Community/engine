import * as curve25519 from '@noble/ed25519';
import { eddsa, poseidon } from 'circomlibjs';
import { randomBytes } from '@noble/hashes/utils';
import { ByteLength, hexlify, hexToBigInt, nToHex } from './bytes';

function getPrivateSpendingKey(seed: string): bigint {
  return poseidon([hexToBigInt(seed)]);
}

function getPublicSpendingKey(privateKey: bigint): [bigint, bigint] {
  return eddsa.prv2pub(privateKey.toString(16));
}

function getPrivateViewingKey(privateSpendingKey: bigint): bigint {
  return curve25519.utils.hashToPrivateScalar(privateSpendingKey.toString(16));
}

async function getPublicViewingKey(privateViewingKey: bigint): Promise<Uint8Array> {
  return curve25519.getPublicKey(privateViewingKey);
}

function getRandomScalar(): bigint {
  return poseidon([BigInt(hexlify(randomBytes(32), true))]);
}

function signEDDSA(privateKey: bigint, message: bigint): [bigint, bigint, bigint] {
  const signature = eddsa.signPoseidon(nToHex(privateKey, ByteLength.UINT_256), message);
  return [signature.R8[0], signature.R8[1], signature.S];
}

function verifyEDDSA(msg: bigint, signature: [bigint, bigint, bigint], pubkey: [bigint, bigint]) {
  const sig = {
    R8: [signature[0], signature[1]],
    S: signature[2],
  };
  return eddsa.verifyPoseidon(msg, sig, pubkey);
}

/**
 * Generate [sender, receiver] ephemeral keys from common random private key
 * @param {Uint8Array} senderVPK - sender viewing public key
 * @param {Uint8Array} recipientVPK - recipient viewing public key (from their address)
 * @returns {[Uint8Array, Uint8Array]} [senderEK, recipientEK]
 */
function getEphemeralKeys(senderVPK: Uint8Array, recipientVPK: Uint8Array): Promise<Uint8Array[]> {
  const r = nToHex(getRandomScalar(), ByteLength.UINT_256);

  return Promise.all(
    [senderVPK, recipientVPK].map(
      async (publicKey) => curve25519.curve25519.scalarMult(r, publicKey),
      // return ek;
      // const ek = await curve25519.getSharedSecret(r, publicKey);
      // const ek = curve25519.curve25519.scalarMult(r, publicKey);
      // return ek;
      // return await curve25519.getPublicKey(ek);
    ),
  );
}

export {
  getPrivateSpendingKey,
  getPublicSpendingKey,
  getPrivateViewingKey,
  getPublicViewingKey,
  getRandomScalar,
  signEDDSA,
  verifyEDDSA,
  getEphemeralKeys,
  poseidon,
};
