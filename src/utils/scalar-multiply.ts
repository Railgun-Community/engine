import { Point } from '@noble/ed25519';
import { bytesToHex } from 'ethereum-cryptography/utils';
import { ByteLength, nToBytes } from './bytes';

const initCurve25519Wasm = (): Promise<void> => {
  try {
    // Try wasm implementation.
    const initCurve25519wasm =
      // eslint-disable-next-line global-require, @typescript-eslint/no-var-requires
      require('@railgun-community/curve25519-scalarmult-wasm') as () => Promise<void>;
    return typeof initCurve25519wasm === 'function' ? initCurve25519wasm() : Promise.resolve();
  } catch (err) {
    // Fallback to Javascript. No init needed.
    return Promise.resolve();
  }
};
export const initCurve25519Promise = initCurve25519Wasm();

export const scalarMultiplyWasmFallbackToJavascript = (
  point: Uint8Array,
  scalar: bigint,
): Uint8Array => {
  try {
    // Try wasm implementation.
    // eslint-disable-next-line global-require, @typescript-eslint/no-var-requires
    const { scalarMultiply } = require('@railgun-community/curve25519-scalarmult-wasm') as {
      scalarMultiply: (point: Uint8Array, scalar: Uint8Array) => Uint8Array;
    };
    const scalarUint8Array = nToBytes(scalar, ByteLength.UINT_256);
    return scalarMultiply(point, scalarUint8Array);
  } catch (err) {
    // Fallback to Javascript.
    const pk = Point.fromHex(bytesToHex(point));
    return pk.multiply(scalar).toRawBytes();
  }
};
