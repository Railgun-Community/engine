import { ed25519 } from '@noble/curves/ed25519';
import { bytesToHex } from 'ethereum-cryptography/utils';
import EngineDebug from '../debugger/debugger';
import { ByteLength, nToBytes } from './bytes';

const {
  default: initCurve25519wasm,
  scalarMultiply: scalarMultiplyWasm,
  // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
} = require('@railgun-community/curve25519-scalarmult-wasm') as {
  default: () => Promise<void>;
  scalarMultiply: (point: Uint8Array, scalar: Uint8Array) => Uint8Array;
};

const initCurve25519Wasm = (): Promise<void> => {
  try {
    // Try WASM implementation.
    return typeof initCurve25519wasm === 'function' ? initCurve25519wasm() : Promise.resolve();
  } catch (err) {
    if (!(err instanceof Error)) {
      throw err;
    }
    // Fallback to Javascript. No init needed.
    EngineDebug.log('curve25519-scalarmult-wasm init failed: Fallback to JavaScript');
    EngineDebug.error(err);
    return Promise.resolve();
  }
};
export const initCurve25519Promise = initCurve25519Wasm();

export const scalarMultiplyWasmFallbackToJavascript = (
  point: Uint8Array,
  scalar: bigint,
): Uint8Array => {
  try {
    // Try WASM implementation.
    const scalarUint8Array = nToBytes(scalar, ByteLength.UINT_256);
    return scalarMultiplyWasm(point, scalarUint8Array);
  } catch (err) {
    if (!(err instanceof Error)) {
      throw err;
    }
    // Fallback to Javascript.
    EngineDebug.log('curve25519-scalarmult-wasm scalarMultiply failed: Fallback to JavaScript');
    EngineDebug.error(err);
    return scalarMultiplyJavascript(point, scalar);
  }
};

export const scalarMultiplyJavascript = (point: Uint8Array, scalar: bigint) => {
  const pk = ed25519.ExtendedPoint.fromHex(bytesToHex(point));
  return pk.multiply(scalar).toRawBytes();
};
