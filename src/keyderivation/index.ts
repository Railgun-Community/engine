import bip39 from './bip39';
import bip32 from './bip32-babyjubjub';
import bech32Encode from './bech32-encode';
import utils from '../utils';

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
    const seed = bip39.mnemonicToSeed(mnemonic);

    // Calculate keynode
    const keyNode = bip32.getMasterKeyFromSeed(seed);

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
    const segments = bip32.getPathSegments(path);

    // Calculate new key node
    const keyNode = segments.reduce(
      (parentKeys: KeyNode, segment: number) => bip32.childKeyDerivationHardened(
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
  ): { privateKey: string, publicKey: string, address: string } {
    const privateKey = utils.babyjubjub.seedToPrivateKey(this.#chainKey);
    const publicKey = utils.babyjubjub.privateKeyToPublicKey(privateKey);
    const address = bech32Encode.encode(publicKey, chainID);
    return {
      privateKey,
      publicKey,
      address,
    };
  }

  /**
   * Generate mnemonic
   */
  static createMnemonic(): string {
    return bip39.generateMnemonic();
  }
}

export default BIP32Node;
