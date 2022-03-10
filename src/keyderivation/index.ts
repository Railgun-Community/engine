import { generateMnemonic } from './bip39';
import {
  HARDENED_OFFSET,
  childKeyDerivationHardened,
  getPathSegments
} from '../utils/bip32';
import { KeyNode } from '../models/types';


export class BIP32Node {
  #chainKey: string;

  #chainCode: string;

  static HARDENED_OFFSET = HARDENED_OFFSET;

  constructor(keyNode: KeyNode) {
    this.#chainKey = keyNode.chainKey;
    this.#chainCode = keyNode.chainCode;
  }

  get keyNode() {
    return { chainKey: this.#chainKey, chainCode: this.#chainCode };
  }

  static create<T extends typeof BIP32Node>(this: T, keyNode: KeyNode): InstanceType<T> {
    return (new this(keyNode)) as InstanceType<T>;
  }

  /**
   * Derives new BIP32Node along path
   * @param {string} path - path to derive along
   * @returns {BIP32Node} - new BIP32 implementation Node
   */
  derive(path: string): BIP32Node {
    // Get path segments
    const segments = getPathSegments(path);

    // Calculate new key node
    const keyNode = segments.reduce(
      (parentKeys: KeyNode, segment: number) => childKeyDerivationHardened(
        parentKeys, segment,
      ),
      this.keyNode
    );

    // Return new BIP32Node subclass
    const Cstr = Object.getPrototypeOf(this).constructor;
    return new Cstr(keyNode);
  }

  /**
   * Generate mnemonic
   */
  static createMnemonic(): string {
    return generateMnemonic();
  }
}
