import * as ed25519 from '@noble/ed25519';
import { bytes, hash } from '../utils';
import { mnemonicToSeed } from './bip39';
import { childKeyDerivationHardened, getPathSegments } from '../utils/bip32';
import { KeyNode } from '../models/types';

export type Hex = Uint8Array | string;
export type PrivKey = Hex | bigint | number;
export type PubKey = Hex | ed25519.Point;
export type SigType = Hex | ed25519.Signature;

const CURVE_SEED = bytes.fromUTF8String('ed25519 seed');
const HARDENED_OFFSET = 0x80000000;

/**
* Creates EdNode from seed
* @param {BytesData} seed - seed
* @returns {EdNode} - ed25519 BIP32Node
*/
export function getMasterKeyFromSeed(seed: bytes.BytesData): KeyNode {
  // HMAC with seed to get I
  const I = hash.sha512HMAC(CURVE_SEED, seed);

  // Slice 32 bytes for IL and IR values, IL = key, IR = chainCode
  const chainKey = I.slice(0, 64);
  const chainCode = I.slice(64);

  // Return node
  return { chainKey, chainCode };
};

export class EdNode {
  #chainKey: string;

  #chainCode: string;

  static CURVE_SEED: string = CURVE_SEED;

  static HARDENED_OFFSET = HARDENED_OFFSET;

  constructor(keyNode: KeyNode) {
    this.#chainKey = keyNode.chainKey;
    this.#chainCode = keyNode.chainCode;
  }

  /**
   * Creates EdNode from mnemonic phrase
   * @param {string} mnemonic - bip32 seed
   * @returns {EdNode} - ed25519 BIP32Node
   */
  static fromMnemonic(mnemonic: string): EdNode {
    const seed = mnemonicToSeed(mnemonic);
    return new EdNode(getMasterKeyFromSeed(seed));
  }

  /**
   * Derives new BIP32Node along path
   * @param {string} path - path to derive along
   * @returns {BIP32Node} - new BIP32 implementation Node
   */
  derive(path: string): EdNode {
    // Get path segments
    const segments = getPathSegments(path);

    // Calculate new key node
    const keyNode = segments.reduce(
      (parentKeys: KeyNode, segment: number) => childKeyDerivationHardened(
        parentKeys, segment, EdNode.HARDENED_OFFSET
      ),
      {
        chainKey: this.#chainKey,
        chainCode: this.#chainCode
      }
    );
    return new EdNode(keyNode);
  }

  /**
   * Get public portion of key
   * @returns {Promise<string>}
   */
  async getPublicKey(): Promise<string> {
    const publicKey = await ed25519.getPublicKey(bytes.hexlify(this.#chainKey));
    return bytes.hexlify(publicKey);
  }

  /**
   * Sign a message with private key
   * @param {Hex} message
   * @returns {Promise<Uint8Array>} - signature
   */
  async sign(message: Hex): Promise<Uint8Array> {
    return await ed25519.sign(message, this.#chainKey);
  }
}

export const { verify } = ed25519;
