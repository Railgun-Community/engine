import * as curve25519 from '@noble/ed25519';
import { Hex, hexlify } from './bytes';
import { getSharedKey } from './encryption';
import { poseidon } from './hash';

export async function getKeyPair(chainKey: string) {
  const privateKey = poseidon([chainKey]);
  const pubkey = hexlify(await curve25519.getPublicKey(privateKey));

  return { privateKey, pubkey };
}

export async function sign(message: Hex, privateKey: Hex) {
  return curve25519.sign(message, privateKey);
}

export function randomPrivateKey(): Uint8Array {
  return curve25519.utils.randomPrivateKey();
}

export async function randomPublicKey() {
  return hexlify(await curve25519.getPublicKey(randomPrivateKey()));
}

export function randomBytes(length: number = 32, prefix: boolean = false) {
  return hexlify(curve25519.utils.randomBytes(length), prefix);
}

export function generateEphemeralKeys(senderVPK: string, recipientVPK: string): Promise<string[]> {
  const privateKey = randomPrivateKey();

  return Promise.all(
    [senderVPK, recipientVPK].map(async (publicKey) => {
      const shared = await getSharedKey(privateKey, publicKey);
      const pub = await curve25519.getPublicKey(shared);
      return hexlify(pub);
    }),
  );
}
