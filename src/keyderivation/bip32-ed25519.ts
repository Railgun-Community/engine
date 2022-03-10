// import BN from 'bn.js';
import * as ed25519 from '@noble/ed25519';
import { bytes, hash } from '../utils';
import { BIP32Node } from '.';
import { mnemonicToSeed } from './bip39';

export type Hex = Uint8Array | string;
export type PrivKey = Hex | bigint | number;
export type PubKey = Hex | ed25519.Point;
export type SigType = Hex | ed25519.Signature;

export class EdNode extends BIP32Node {

  static CURVE_SEED: string = bytes.fromUTF8String('ed25519 seed');

  /**
   * Creates EdNode from seed
   * @param {BytesData} seed - seed
   * @returns {EdNode} - ed25519 BIP32Node
   */
  static getMasterKeyFromSeed(seed: bytes.BytesData): EdNode {
    // HMAC with seed to get I
    const I = hash.sha512HMAC(EdNode.CURVE_SEED, seed);

    // Slice 32 bytes for IL and IR values, IL = key, IR = chainCode
    const chainKey = I.slice(0, 64);
    const chainCode = I.slice(64);

    // Return node
    return new EdNode({ chainKey, chainCode });
  }

  /**
   * Creates EdNode from mnemonic phrase
   * @param {string} mnemonic - bip32 seed
   * @returns {EdNode} - ed25519 BIP32Node
   */
  static fromMnemonic(mnemonic: string): EdNode {
    const seed = mnemonicToSeed(mnemonic);
    return EdNode.getMasterKeyFromSeed(seed);
  }

  /**
   * derive new EdNode given path
   * @param {string} path
   * @returns {EdNode}
   */
  derive(path: string): EdNode {
    return super.derive(path) as EdNode;
  }

  /**
   * Get public portion of key
   * @returns {Promise<string>}
   */
  async getPublicKey(): Promise<string> {
    const publicKey = await ed25519.getPublicKey(bytes.hexlify(this.keyNode.chainKey));
    return bytes.hexlify(publicKey);
  }

  /**
   * Sign a message with private key
   * @param {Hex} message
   * @returns {Promise<Uint8Array>} - signature
   */
  async sign(message: Hex): Promise<Uint8Array> {
    return await ed25519.sign(message, this.keyNode.chainKey);
  }
}

export const { verify } = ed25519;
