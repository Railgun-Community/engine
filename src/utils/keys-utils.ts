import { utils as utilsEd25519, Point, getPublicKey, sign, verify, CURVE } from '@noble/ed25519';
import { eddsa, Signature } from 'circomlibjs';
import { MEMO_SENDER_BLINDING_KEY_NULL } from '../transaction/constants';
import { hexlify, hexToBytes } from './bytes';
import { poseidon, sha256 } from './hash';

const { bytesToHex, randomBytes } = utilsEd25519;

function getPublicSpendingKey(privateKey: Uint8Array): [bigint, bigint] {
  return eddsa.prv2pub(Buffer.from(privateKey));
}

async function getPublicViewingKey(privateViewingKey: Uint8Array): Promise<Uint8Array> {
  return await getPublicKey(privateViewingKey);
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
  return sign(message, privateKey);
}

function verifyED25519(
  message: Uint8Array,
  signature: Uint8Array,
  pubkey: Uint8Array,
): Promise<boolean> {
  return verify(signature, message, pubkey);
}

function adjustRandom(random: string): bigint {
  const randomArray = hexToBytes(sha256(random));
  randomArray[0] &= 248;
  randomArray[31] &= 127;
  randomArray[31] |= 64;
  return BigInt(`0x${bytesToHex(randomArray)}`) % CURVE.n;
}

function maybeBlindViewingPublicKey(
  senderViewingPublicKey: Uint8Array,
  senderBlindingKey: Optional<string>,
): Point {
  const senderViewingPublicKeyPoint = Point.fromHex(bytesToHex(senderViewingPublicKey));
  if (!senderBlindingKey || senderBlindingKey === MEMO_SENDER_BLINDING_KEY_NULL) {
    return senderViewingPublicKeyPoint;
  }
  const senderBlindingKeyAdjusted = adjustRandom(senderBlindingKey);
  return senderViewingPublicKeyPoint.multiply(senderBlindingKeyAdjusted);
}

async function getEphemeralKeys(
  senderViewingPublicKey: Uint8Array,
  receiverViewingPublicKey: Uint8Array,
  random: string,
  senderBlindingKey: Optional<string>,
): Promise<[Uint8Array, Uint8Array]> {
  const sharedSymmetricKey = adjustRandom(random);
  const maybeBlindedSenderViewingPublicKeyPoint = maybeBlindViewingPublicKey(
    senderViewingPublicKey,
    senderBlindingKey,
  );
  const maybeBlindedReceiverViewingPublicKeyPoint = maybeBlindViewingPublicKey(
    receiverViewingPublicKey,
    senderBlindingKey,
  );
  const ephemeralKeyReceiverMaybeBlinded = maybeBlindedSenderViewingPublicKeyPoint
    .multiply(sharedSymmetricKey)
    .toRawBytes();
  const ephemeralKeySender = maybeBlindedReceiverViewingPublicKeyPoint
    .multiply(sharedSymmetricKey)
    .toRawBytes();
  return [ephemeralKeyReceiverMaybeBlinded, ephemeralKeySender];
}

function unblindedEphemeralKey(ephemeralKey: Uint8Array, random: string): Optional<Uint8Array> {
  try {
    const randomAdjusted = adjustRandom(random);
    const point = Point.fromHex(bytesToHex(ephemeralKey));
    const randomInverse = utilsEd25519.invert(randomAdjusted, CURVE.n);
    const unblinded = point.multiply(randomInverse);
    return unblinded.toRawBytes();
  } catch {
    return undefined;
  }
}

function invertKeySenderBlinding(
  symmetricKey: Optional<Uint8Array>,
  senderBlindingKey: Optional<string>,
): Optional<Uint8Array> {
  if (!symmetricKey || !senderBlindingKey || senderBlindingKey === MEMO_SENDER_BLINDING_KEY_NULL) {
    return undefined;
  }
  try {
    const pk = Point.fromHex(bytesToHex(symmetricKey));
    const senderBlindingKeyAdjusted = adjustRandom(senderBlindingKey);
    const senderBlindingKeyInverse = utilsEd25519.invert(senderBlindingKeyAdjusted, CURVE.n);
    return pk.multiply(senderBlindingKeyInverse).toRawBytes();
  } catch {
    return undefined;
  }
}

async function getSharedSymmetricKey(
  privateKey: Uint8Array,
  ephemeralKey: Uint8Array,
): Promise<Optional<Uint8Array>> {
  try {
    const pk = Point.fromHex(bytesToHex(ephemeralKey));
    const { scalar } = await utilsEd25519.getExtendedPublicKey(privateKey);
    const symmetricKey = pk.multiply(scalar);
    return symmetricKey.toRawBytes();
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
  invertKeySenderBlinding,
};
