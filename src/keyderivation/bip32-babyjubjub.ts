import { babyjubjub, bytes, hash } from '../utils';
import { encode } from './bech32-encode';
import { mnemonicToSeed } from './bip39';
import { KeyNode } from '../models/types';
import { childKeyDerivationHardened, getPathSegments } from '../utils/bip32';

const CURVE_SEED = bytes.fromUTF8String('babyjubjub seed');
const HARDENED_OFFSET = 0x80000000;

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
  getBabyJubJubKey(
    chainID: number | undefined = undefined,
  ): { privateKey: string, pubkey: string, address: string; } {
    const privateKey = babyjubjub.seedToPrivateKey(this.#chainKey);
    const pubkey = babyjubjub.privateKeyToPubKey(privateKey);
    const address = encode(pubkey, chainID);
    return {
      privateKey,
      pubkey,
      address,
    };
  }
}
