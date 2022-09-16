import { utils as utilsEd25519, Point, getPublicKey, sign, verify, CURVE } from '@noble/ed25519';
import { eddsa, Signature } from 'circomlibjs';
import { ByteLength, hexlify, hexToBigInt, hexToBytes, nToHex } from './bytes';
import { poseidon, sha256 } from './hash';

const { bytesToHex, randomBytes } = utilsEd25519;

function getPublicSpendingKey(privateKey: Uint8Array): [bigint, bigint] {
  if (privateKey.length !== 32) throw Error('Invalid private key length');
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

function normalizeRandom(random: string): bigint {
  // Hash with sha256 to get a uniform random 32 bytes of data
  const randomArray = hexToBytes(sha256(random));

  // NOTE: The bits adjustment is no longer required to function as an X25519 integer is not used
  // These steps are still taken to preserve compatibility with older transactions

  const adjustedBytes = adjustBytes25519(randomArray);

  // Return mod n to fit to curve point
  return BigInt(`0x${bytesToHex(adjustedBytes)}`) % CURVE.n;
}

/**
 * Adjust bits to match the pattern xxxxx000...01xxxxxx
 * This ensures that the bytes are a little endian representation of an integer of the form
 * (2^254 + 8) * x where 0 < x <= 2^251 - 1, which can be decoded as an X25519 integer.
 */
function adjustBytes25519(bytes: Uint8Array): Uint8Array {
  const adjustedBytes = bytes;

  // AND operation to ensure the last 3 bits of the first byte are 0 leaving the rest unchanged
  adjustedBytes[0] &= 0b11111000;

  // AND operation to ensure the first bit of the last byte is 0 leaving the rest unchanged
  adjustedBytes[31] &= 0b01111111;

  // OR operation to ensure the second bit of the last byte is 0 leaving the rest unchanged
  adjustedBytes[31] |= 0b01000000;

  // Return mod n to fit to curve point
  return adjustedBytes;
}

async function getPrivateScalarFromPrivateKey(privateKey: Uint8Array) {
  // Private key should be 32 bytes
  if (privateKey.length !== 32) throw new Error('Expected 32 bytes');

  // SHA512 hash private key
  const hash = await utilsEd25519.sha512(privateKey);

  // Get key head, this is the first 32 bytes of the hash
  // We aren't interested in the rest of the hash as we only want the scalar
  const head = adjustBytes25519(hash.slice(0, 32));

  // Convert head to scalar
  const scalar = BigInt(`0x${utilsEd25519.bytesToHex(head.reverse())}`) % CURVE.l;

  return scalar > 0n ? scalar : CURVE.l;
}

function getCommitmentBlindingKey(random: string, senderBlindingKey: string): bigint {
  // XOR public and spender blinding key to get commitment blinding key
  // XOR is used because a 0 value on the sender blinding key will result in identical public and
  // commitment blinding keys, allowing the receiver to reverse the multiplier operation
  const commitmentBlindingKey = hexToBigInt(random) ^ hexToBigInt(senderBlindingKey);

  const commitmentBlindingKeyHex = nToHex(commitmentBlindingKey, ByteLength.UINT_256);

  // Adjust random value to use as blinding key to prevent external observers from being able to
  // reverse the multiplication. The random value here is a value only known to the sender and
  // receiver
  const commitmentBlindingKeyNormalized = normalizeRandom(commitmentBlindingKeyHex);

  // For each blinding operation both sender and receiver public viewing keys must be multiplied by
  // the same value to preserve symmetry in relation to the respective private key to allow shared
  // key generation
  return commitmentBlindingKeyNormalized;
}

async function getEphemeralKeys(
  senderViewingPublicKey: Uint8Array,
  receiverViewingPublicKey: Uint8Array,
  random: string,
  senderBlindingKey: string,
): Promise<[Uint8Array, Uint8Array]> {
  const commitmentBlindingKey = getCommitmentBlindingKey(random, senderBlindingKey);

  // Multiply both sender and receiver viewing public keys with the public blinding key
  // The pub blinding key is only known to the sender and receiver preventing external
  // observers from being able to invert and retrieve the original value
  const ephemeralKeyReceiver = Point.fromHex(bytesToHex(senderViewingPublicKey))
    .multiply(commitmentBlindingKey)
    .toRawBytes();
  const ephemeralKeySender = Point.fromHex(bytesToHex(receiverViewingPublicKey))
    .multiply(commitmentBlindingKey)
    .toRawBytes();

  // Return blinded keys
  return [ephemeralKeyReceiver, ephemeralKeySender];
}

function unblindEphemeralKey(
  ephemeralKey: Uint8Array,
  random: string,
  senderBlindingKey: string,
): Optional<Uint8Array> {
  try {
    const commitmentBlindingKey = getCommitmentBlindingKey(random, senderBlindingKey);

    // Create curve point instance from ephemeral key bytes
    const point = Point.fromHex(bytesToHex(ephemeralKey));

    // Invert the scalar to undo blinding multiplication operation
    const inverse = utilsEd25519.invert(commitmentBlindingKey, CURVE.n);

    // Unblind by multiplying by the inverted scalar
    const unblinded = point.multiply(inverse);

    return unblinded.toRawBytes();
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
    const scalar = await getPrivateScalarFromPrivateKey(privateKey);

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
  unblindEphemeralKey,
  getSharedSymmetricKey,
};
