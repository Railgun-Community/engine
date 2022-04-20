import * as ed from '@noble/ed25519';
import { hexlify } from './bytes';
import { getSharedKey } from './encryption';

export function randomPrivateKey(): Uint8Array {
  return ed.utils.randomPrivateKey();
}

export async function randomPublicKey() {
  return hexlify(await ed.getPublicKey(randomPrivateKey()));
}

export function randomBytes(length: number = 32, prefix: boolean = false) {
  return hexlify(ed.utils.randomBytes(length), prefix);
}

export function generateEphemeralKeys(senderVPK: string, recipientVPK: string): Promise<string[]> {
  const privateKey = randomPrivateKey();
  return Promise.all(
    [senderVPK, recipientVPK].map(async (publicKey) => {
      const shared = await getSharedKey(privateKey, publicKey);
      const pub = await ed.getPublicKey(shared);
      return ed.utils.bytesToHex(pub);
    }),
  );
}
