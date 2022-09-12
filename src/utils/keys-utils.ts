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
  // Hash with sha256 to get a uniform random 32 bytes of data
  const randomArray = hexToBytes(sha256(random));

  // NOTE: The bits adjustment is no longer required to function as an X25519 integer is not used
  // These steps are still taken to preserve compatibility with older transactions

  // Adjust bits to match the pattern xxxxx000...01xxxxxx
  // This ensures that the bytes are a little endian representation of an integer of the form
  // (2^254 + 8) * x where 0 < x <= 2^251 - 1, which can be decoded as an X25519 integer

  // AND operation to ensure the last 3 bits of the first byte are 0 leaving the rest unchanged
  randomArray[0] &= 0b11111000;

  // AND operation to ensure the first bit of the last byte is 0 leaving the rest unchanged
  randomArray[31] &= 0b01111111;

  // OR operation to ensure the second bit of the last byte is 0 leaving the rest unchanged
  randomArray[31] |= 0b01000000;

  // Return mod n to fit to curve point
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
  // Adjust random value to use as blinding key to prevent external observers from being able to
  // reverse the multiplication. The random value here is a value only known to the sender and
  // receiver
  const publicBlindingKey = adjustRandom(random);

  // For each blinding operation both sender and receiver public viewing keys must be multiplied by
  // the same value to preserve symmetry in relation to the respective private key to allow shared
  // key generation

  // Multiply both sender and receiver viewing public keys with the sender blinding key
  // The sender blinding key is only known to the sender preventing the receiver from being able to
  // invert and retrieve the original value
  const maybeBlindedSenderViewingPublicKeyPoint = maybeBlindViewingPublicKey(
    senderViewingPublicKey,
    senderBlindingKey,
  );
  const maybeBlindedReceiverViewingPublicKeyPoint = maybeBlindViewingPublicKey(
    receiverViewingPublicKey,
    senderBlindingKey,
  );

  // Multiply both sender and receiver viewing public keys with the public blinding key
  // The pub blinding key is only known to the sender and receiver preventing external
  // observers from being able to invert and retrieve the original value
  const ephemeralKeyReceiverMaybeBlinded = maybeBlindedSenderViewingPublicKeyPoint
    .multiply(publicBlindingKey)
    .toRawBytes();
  const ephemeralKeySender = maybeBlindedReceiverViewingPublicKeyPoint
    .multiply(publicBlindingKey)
    .toRawBytes();

  // Return blinded keys
  return [ephemeralKeyReceiverMaybeBlinded, ephemeralKeySender];
}

function unblindedEphemeralKey(ephemeralKey: Uint8Array, random: string): Optional<Uint8Array> {
  try {
    // Adjust random value to recover public blinding key
    const randomAdjusted = adjustRandom(random);

    // Create curve point instance from ephemeral key bytes
    const point = Point.fromHex(bytesToHex(ephemeralKey));

    // Invert the scalar to undo blinding multiplication operation
    const randomInverse = utilsEd25519.invert(randomAdjusted, CURVE.n);

    // Unblind by multiplying by the inverted scalar
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
    // Create curve point instance from ephemeral key class
    const pk = Point.fromHex(bytesToHex(ephemeralKey));

    // Retrieve private scalar from private key
    const { scalar } = await utilsEd25519.getExtendedPublicKey(privateKey);

    // Multiply ephemeral key by private scalar to get shared key
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
