import circom from 'circomlibjs';
import EngineDebug from '../debugger/debugger';
import { ByteLength, hexToBigInt, nToHex, padToLength } from './bytes';
import { isReactNative } from './runtime';

interface PoseidonModule {
  default?: () => Promise<void>;
  poseidon?: (args: Array<bigint>) => bigint;
  poseidonHex?: (args: Array<string>) => string;
}

const { default: initPoseidonWasm, poseidon: poseidonWasm, poseidonHex: poseidonHexWasm } =
  // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
  (isReactNative ? {} : require('@railgun-community/poseidon-hash-wasm')) as PoseidonModule;

const initPoseidon = (): Promise<void> => {
  try {
    // Try WASM implementation.
    return typeof initPoseidonWasm === 'function' ? initPoseidonWasm() : Promise.resolve();
  } catch (cause) {
    if (!(cause instanceof Error)) {
      throw new Error('Non-error thrown from initPoseidon', { cause });
    }
    // Fallback to Javascript. No init needed.
    EngineDebug.log('poseidon-hash-wasm init failed: Fallback to JavaScript');
    EngineDebug.error(cause);
    return Promise.resolve();
  }
};
export const initPoseidonPromise = initPoseidon();

export const poseidon = (args: Array<bigint>): bigint => {
  if (isReactNative || !poseidonWasm) {
    // Fallback to JavaScript if this module is running directly in React Native
    return circom.poseidon(args);
  }
  try {
    // Try WASM implementation.
    return poseidonWasm(args);
  } catch (cause) {
    if (!(cause instanceof Error)) {
      throw new Error('Non-error thrown from poseidon', { cause });
    }
    // Fallback to Javascript.
    EngineDebug.log('poseidon in WASM failed: Fallback to JavaScript');
    EngineDebug.error(cause);
    return circom.poseidon(args);
  }
};

export const poseidonHex = (args: Array<string>): string => {
  if (isReactNative || !poseidonHexWasm) {
    return nToHex(circom.poseidon(args.map(hexToBigInt)), ByteLength.UINT_256);
  }
  try {
    return padToLength(poseidonHexWasm(args), ByteLength.UINT_256) as string;
  } catch (cause) {
    if (!(cause instanceof Error)) {
      throw new Error('Non-error thrown from poseidonHex', { cause });
    }
    // Fallback to Javascript.
    EngineDebug.log('poseidonHex in WASM failed: Fallback to JavaScript');
    EngineDebug.error(cause);
    return nToHex(circom.poseidon(args.map(hexToBigInt)), ByteLength.UINT_256);
  }
};
