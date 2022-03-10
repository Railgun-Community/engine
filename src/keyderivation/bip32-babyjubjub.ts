import { babyjubjub, bytes, hash } from '../utils';
import { BIP32Node } from '.';
import { encode } from './bech32-encode';
import { mnemonicToSeed } from './bip39';

export class BjjNode extends BIP32Node {

  static CURVE_SEED = bytes.fromUTF8String('babyjubjub seed');

  /**
   * Creates KeyNode from seed
   * @param seed - bip32 seed
   * @returns BjjNode - babyjubjub BIP32Node
   */
  static getMasterKeyFromSeed(seed: bytes.BytesData): BjjNode {
    // HMAC with seed to get I
    const I = hash.sha512HMAC(BjjNode.CURVE_SEED, seed);

    // Slice 32 bytes for IL and IR values, IL = key, IR = chainCode
    const chainKey = I.slice(0, 64);
    const chainCode = I.slice(64);

    // Return node
    return new BjjNode({
      chainKey,
      chainCode,
    });
  }

  static fromMnemonic(mnemonic: string): BjjNode {
    const seed = mnemonicToSeed(mnemonic);
    return BjjNode.getMasterKeyFromSeed(seed);
  }

  derive(path: string): BjjNode {
    return super.derive(path) as BjjNode;
  }

  /**
  * Gets babyjubjub key pair of this BIP32 Node
  * @returns keypair
  */
  getBabyJubJubKey(
    chainID: number | undefined = undefined,
  ): { privateKey: string, pubkey: string, address: string; } {
    const privateKey = babyjubjub.seedToPrivateKey(this.keyNode.chainKey);
    const pubkey = babyjubjub.privateKeyToPubKey(privateKey);
    const address = encode(pubkey, chainID);
    return {
      privateKey,
      pubkey,
      address,
    };
  }
}
