import bip39 from './bip39';
import bip32 from './bip32-babyjubjub';
import utils from '../utils';

import type { KeyNode } from './bip32-babyjubjub';

class BIP32Node {
  private chainKey: string;

  private chainCode: string;

  constructor(keyNode: KeyNode) {
    this.chainKey = keyNode.chainKey;
    this.chainCode = keyNode.chainCode;
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
        chainCode: this.chainCode,
        chainKey: this.chainKey,
      },
    );

    // Return new BIP32Node
    return new BIP32Node(keyNode);
  }

  /**
   * Gets babyjubjub key pair of this BIP32 Node
   * @returns keypair
   */
  getBabyJubJubKey(): { privateKey: string, publicKey: string } {
    const privateKey = utils.babyjubjub.seedToPrivateKey(this.chainKey);
    const publicKey = utils.babyjubjub.privateKeyToPublicKey(privateKey);

    return {
      privateKey,
      publicKey,
    };
  }
}

export default BIP32Node;
