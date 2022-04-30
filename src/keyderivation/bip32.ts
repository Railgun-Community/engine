import { Signature } from 'circomlib';
import { bytesToHex, hexToBytes } from 'ethereum-cryptography/utils';
import { hash, keysUtils } from '../utils';
import { fromUTF8String, hexToBigInt } from '../utils/bytes';
import { mnemonicToSeed } from './bip39';
import { KeyNode } from '../models/types';
import { childKeyDerivationHardened, getPathSegments } from '../utils/bip32';
import { BytesData } from '../models/transaction-types';

const CURVE_SEED = fromUTF8String('babyjubjub seed');
const HARDENED_OFFSET = 0x80000000;

export type SpendingKeyPair = { privateKey: Uint8Array; pubkey: [bigint, bigint] };
export type ViewingKeyPair = { privateKey: Uint8Array; pubkey: Uint8Array };

/**
 * Creates KeyNode from seed
 * @param seed - bip32 seed
 * @returns BjjNode - babyjubjub BIP32Node
 */
export function getMasterKeyFromSeed(seed: BytesData): KeyNode {
  // HMAC with seed to get I
  const I = hash.sha512HMAC(CURVE_SEED, seed);

  // Slice 32 bytes for IL and IR values, IL = key, IR = chainCode
  const chainKey = I.slice(0, 64);
  const chainCode = I.slice(64);

  // Return node
  return {
    chainKey,
    chainCode,
  };
}

export class Node {
  static CURVE_SEED = CURVE_SEED;

  static HARDENED_OFFSET = HARDENED_OFFSET;

  #chainKey: string;

  #chainCode: string;

  constructor(keyNode: KeyNode) {
    this.#chainKey = keyNode.chainKey;
    this.#chainCode = keyNode.chainCode;
  }

  /**
   * Create BIP32 node from mnemonic
   * @returns {Node}
   */
  static fromMnemonic(mnemonic: string): Node {
    const seed = mnemonicToSeed(mnemonic);
    return new Node(getMasterKeyFromSeed(seed));
  }

  /**
   * Derives new BIP32Node along path
   * @param {string} path - path to derive along
   * @returns {BIP32Node} - new BIP32 implementation Node
   */
  derive(path: string): Node {
    // Get path segments
    const segments = getPathSegments(path);

    // Calculate new key node
    const keyNode = segments.reduce(
      (parentKeys: KeyNode, segment: number) =>
        childKeyDerivationHardened(parentKeys, segment, Node.HARDENED_OFFSET),
      {
        chainKey: this.#chainKey,
        chainCode: this.#chainCode,
      },
    );
    return new Node(keyNode);
  }

  /**
   * Get spending key-pair
   * @returns keypair
   */
  getSpendingKeyPair(): SpendingKeyPair {
    const privateKey = hexToBytes(this.#chainKey);
    const pubkey = keysUtils.getPublicSpendingKey(privateKey);
    return {
      privateKey,
      pubkey,
    };
  }

  static getMasterPublicKey(spendingPublicKey: [bigint, bigint], nullifyingKey: bigint): bigint {
    return hash.poseidon([...spendingPublicKey, nullifyingKey]);
  }

  async getViewingKeyPair(): Promise<ViewingKeyPair> {
    // TODO: THIS should be a separate node chainkey
    const privateKey = hexToBytes(this.#chainKey);
    const pubkey = await keysUtils.getPublicViewingKey(privateKey);
    return { privateKey, pubkey };
  }

  async getNullifyingKey(): Promise<bigint> {
    const { privateKey } = await this.getViewingKeyPair();
    return hash.poseidon([hexToBigInt(bytesToHex(privateKey))]);
  }

  signBySpendingKey(message: bigint): Signature {
    return keysUtils.signEDDSA(this.getSpendingKeyPair().privateKey, message);
  }
}
