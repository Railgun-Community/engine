import * as curve25519 from '@noble/ed25519';
import { babyjubjub, bytes, ed25519, hash } from '../utils';
import { BytesData, Hex, hexToBigInt } from '../utils/bytes';
import { mnemonicToSeed } from './bip39';
import { KeyNode } from '../models/types';
import { childKeyDerivationHardened, getPathSegments } from '../utils/bip32';

const CURVE_SEED = bytes.fromUTF8String('babyjubjub seed');
const HARDENED_OFFSET = 0x80000000;

export type KeyPair = { privateKey: string; pubkey: string };

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
   * Gets babyjubjub key pair of this BIP32 Node
   * @returns {KeyPair} keypair
   */
  get babyJubJubKeyPair(): KeyPair {
    return babyjubjub.getKeyPair(this.#chainKey);
  }

  /**
   * Shortcut to return public portion (PK) BabyJubJub key
   * @returns {string} pubkey
   */
  get babyJubJubPublicKey(): string {
    return this.babyJubJubKeyPair.pubkey;
  }

  /**
   * @todo keep viewing private key private
   */
  async getViewingKeyPair(): Promise<KeyPair> {
    // the private key is also used as the nullifying key
    return ed25519.getKeyPair(this.#chainKey);
  }

  /**
   * Get viewing public key (VK) from ed25519 viewing keypair
   * @returns {Promise<string>}
   */
  async getViewingPublicKey(): Promise<string> {
    const { pubkey } = await this.getViewingKeyPair();
    return pubkey;
  }

  /**
   * Get private Nullifying (aka Viewing) Key (n) from ed25519 viewing keypair
   * @returns {Promise<string>}
   */
  async getNullifyingKey(): Promise<string> {
    const { privateKey } = await this.getViewingKeyPair();
    return privateKey;
  }

  /**
   * Sign a message with BabyJubJub key
   *
   * @param data - data to sign
   * @returns signed data
   */
  signBabyJubJub(data: Hex[]): object {
    const keyPair = this.babyJubJubKeyPair;

    return babyjubjub.sign(hexToBigInt(keyPair.privateKey), data);
  }

  /**
   * Sign a message with ed25519 private key
   * @param {Hex} message
   * @returns {Promise<Uint8Array>} - signature
   */
  async signEd25519(message: Hex): Promise<Uint8Array> {
    const { privateKey } = await this.getViewingKeyPair();
    return await curve25519.sign(message, privateKey);
  }
}
