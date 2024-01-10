import { expose, Transfer } from 'threads/worker';
import { utils as utilsEd25519, CURVE } from '@noble/ed25519';
import { fastHexToBytes } from './bytes';
import { sha256 } from './hash';
import { scalarMultiplyJavascript } from './scalar-multiply';

/**
 * Adjust bits to match the pattern xxxxx000...01xxxxxx for little endian and 01xxxxxx...xxxxx000 for big endian
 * This ensures that the bytes are a little endian representation of an integer of the form (2^254 + 8) * x where
 * 0 \< x \<= 2^251 - 1, which can be decoded as an X25519 integer.
 *
 * @param bytes - bytes to adjust
 * @param endian - what endian to use
 * @returns adjusted bytes
 */
function adjustBytes25519(bytes: Uint8Array, endian: 'be' | 'le'): Uint8Array {
  // Create new array to prevent side effects
  const adjustedBytes = new Uint8Array(bytes);

  if (endian === 'be') {
    // BIG ENDIAN
    // AND operation to ensure the last 3 bits of the last byte are 0 leaving the rest unchanged
    adjustedBytes[31] &= 0b11111000;

    // AND operation to ensure the first bit of the first byte is 0 leaving the rest unchanged
    adjustedBytes[0] &= 0b01111111;

    // OR operation to ensure the second bit of the first byte is 0 leaving the rest unchanged
    adjustedBytes[0] |= 0b01000000;
  } else {
    // LITTLE ENDIAN
    // AND operation to ensure the last 3 bits of the first byte are 0 leaving the rest unchanged
    adjustedBytes[0] &= 0b11111000;

    // AND operation to ensure the first bit of the last byte is 0 leaving the rest unchanged
    adjustedBytes[31] &= 0b01111111;

    // OR operation to ensure the second bit of the last byte is 0 leaving the rest unchanged
    adjustedBytes[31] |= 0b01000000;
  }

  // Return adjusted bytes
  return adjustedBytes;
}

async function getPrivateScalarFromPrivateKey(privateKey: Uint8Array): Promise<bigint> {
  // Private key should be 32 bytes
  if (privateKey.length !== 32) throw new Error('Expected 32 bytes');

  // SHA512 hash private key
  const hash = await utilsEd25519.sha512(privateKey);

  // Get key head, this is the first 32 bytes of the hash
  // We aren't interested in the rest of the hash as we only want the scalar
  const head = adjustBytes25519(hash.slice(0, 32), 'le');

  // Convert head to scalar
  const scalar = BigInt(`0x${utilsEd25519.bytesToHex(head.reverse())}`) % CURVE.l;

  return scalar > 0n ? scalar : CURVE.l;
}

async function getSharedSymmetricKey(
  privateKeyPairABuf: ArrayBufferLike,
  blindedPublicKeyPairBBuf: ArrayBufferLike,
): Promise<Optional<ArrayBufferLike>> {
  const A = performance.now();
  const privateKeyPairA: Uint8Array = new Uint8Array(privateKeyPairABuf);
  const blindedPublicKeyPairB: Uint8Array = new Uint8Array(blindedPublicKeyPairBBuf);
  const B = performance.now();
  // Retrieve private scalar from private key
  const scalar: bigint = await getPrivateScalarFromPrivateKey(privateKeyPairA);
  const C = performance.now();

  // Multiply ephemeral key by private scalar to get shared key
  const keyPreimage: Uint8Array = scalarMultiplyJavascript(blindedPublicKeyPairB, scalar);
  const D = performance.now();

  // SHA256 hash to get the final key
  const hashed: Uint8Array = fastHexToBytes(sha256(keyPreimage));
  const E = performance.now();
  // console.log(`              convert Transfer: ${B - A}ms`);
  // console.log(`getPrivateScalarFromPrivateKey: ${C - B}ms`);
  // console.log(`      scalarMultiplyJavascript: ${D - C}ms`);
  // console.log(`            sha256 and convert: ${E - D}ms`);
  return Transfer(hashed.buffer) as any;
}

expose(getSharedSymmetricKey);
