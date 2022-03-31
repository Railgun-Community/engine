import * as ed25519 from '@noble/ed25519';
import { babyjubjub, bytes, hash } from '../utils';
import { mnemonicToSeed } from './bip39';
import { KeyNode } from '../models/types';
import { childKeyDerivationHardened, getPathSegments } from '../utils/bip32';

const CURVE_SEED = bytes.fromUTF8String('babyjubjub seed');
const HARDENED_OFFSET = 0x80000000;

export type KeyPair = { privateKey: string, pubkey: string; };
export type Hex = Uint8Array | string;

/**
 * Creates KeyNode from seed
 * @param seed - bip32 seed
 * @returns BjjNode - babyjubjub BIP32Node
 */
export function getMasterKeyFromSeed(seed: bytes.BytesData): KeyNode {
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

export class BjjNode {

  static CURVE_SEED = CURVE_SEED;

  static HARDENED_OFFSET = HARDENED_OFFSET;

  #chainKey: string;

  #chainCode: string;

  constructor(keyNode: KeyNode) {
    this.#chainKey = keyNode.chainKey;
    this.#chainCode = keyNode.chainCode;
  }

  static fromMnemonic(mnemonic: string): BjjNode {
    const seed = mnemonicToSeed(mnemonic);
    return new BjjNode(getMasterKeyFromSeed(seed));
  }

  /**
   * Derives new BIP32Node along path
   * @param {string} path - path to derive along
   * @returns {BIP32Node} - new BIP32 implementation Node
   */
  derive(path: string): BjjNode {
    // Get path segments
    const segments = getPathSegments(path);

    // Calculate new key node
    const keyNode = segments.reduce(
      (parentKeys: KeyNode, segment: number) => childKeyDerivationHardened(
        parentKeys, segment, BjjNode.HARDENED_OFFSET
      ),
      {
        chainKey: this.#chainKey,
        chainCode: this.#chainCode
      }
    );
    return new BjjNode(keyNode);
  }

  /**
  * Gets babyjubjub key pair of this BIP32 Node
  * @returns keypair
  */
  getBabyJubJubKey(): KeyPair {
    const privateKey = babyjubjub.seedToPrivateKey(this.#chainKey);
    const pubkey = babyjubjub.privateKeyToPubKey(privateKey);
    return {
      privateKey,
      pubkey,
    };
  }

  getBabyJubJubPublicKey() {
    const { pubkey } = this.getBabyJubJubKey();
    return pubkey;
  }

  async getEd25519Key(): Promise<KeyPair> {

    const pubkey = bytes.hexlify(await ed25519.getPublicKey(bytes.hexlify(this.#chainKey)));
    const privateKey = this.#chainKey;

    return { privateKey, pubkey };
  };

  /**
 * Get public portion of key
 * @returns {Promise<string>}
 */
  async getEd25519PublicKey(): Promise<string> {
    const { pubkey } = await this.getEd25519Key();
    return pubkey;
  };

  /**
   * @todo
   */
  // eslint-disable-next-line class-methods-use-this
  signBabyJubJub() {
    throw new Error("not implemented");
  }

  /**
   * Sign a message with private key
   * @param {Hex} message
   * @returns {Promise<Uint8Array>} - signature
   */
  async signEd25519(message: Hex): Promise<Uint8Array> {
    return await ed25519.sign(message, this.#chainKey);
  }
}
