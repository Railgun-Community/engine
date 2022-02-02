import { mnemonicToSeed, generateMnemonic } from './bip39';
import { getMasterKeyFromSeed, getPathSegments, childKeyDerivationHardened } from './bip32-babyjubjub';
import { encode } from './bech32-encode';
import { babyjubjub } from '../utils';

import type { KeyNode } from './bip32-babyjubjub';

class BIP32Node {
  #chainKey: string;

  #chainCode: string;

  constructor(keyNode: KeyNode) {
    this.#chainKey = keyNode.chainKey;
    this.#chainCode = keyNode.chainCode;
  }

  /**
   * Constructs BIP32Node from mnemonic
   * @param mnemonic - mnemonic to construct from
   * @returns BIP32 Node
   */
  static fromMnemonic(mnemonic: string): BIP32Node {
    // Calcualte seed
    const seed = mnemonicToSeed(mnemonic);

    // Calculate keynode
    const keyNode = getMasterKeyFromSeed(seed);

    // Return BIP32Node
    return new BIP32Node(keyNode);
  }

  /**
   * Derives new BIP32Node along path
   * @param path - path to derive along
   * @returns new BIP32 Node
   */
  derive(path: string) {
    // Get path segments
    const segments = getPathSegments(path);

    // Calculate new key node
    const keyNode = segments.reduce(
      (parentKeys: KeyNode, segment: number) => childKeyDerivationHardened(
        parentKeys, segment,
      ),
      {
        chainCode: this.#chainCode,
        chainKey: this.#chainKey,
      },
    );

    // Return new BIP32Node
    return new BIP32Node(keyNode);
  }

  /**
   * Gets babyjubjub key pair of this BIP32 Node
   * @returns keypair
   */
  getBabyJubJubKey(
    chainID: number | undefined = undefined,
  ): { privateKey: string, pubkey: string, address: string } {
    const privateKey = babyjubjub.seedToPrivateKey(this.#chainKey);
    const pubkey = babyjubjub.privateKeyToPubKey(privateKey);
    const address = encode(pubkey, chainID);
    return {
      privateKey,
      pubkey,
      address,
    };
  }

  /**
   * Generate mnemonic
   */
  static createMnemonic(): string {
    return generateMnemonic();
  }
}

export { BIP32Node };
