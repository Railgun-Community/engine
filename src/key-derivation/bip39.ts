import { HDKey } from 'ethereum-cryptography/hdkey';
import * as bip39 from 'ethereum-cryptography/bip39';
import { wordlist } from 'ethereum-cryptography/bip39/wordlists/english';
import { toHex, bytesToHex } from 'ethereum-cryptography/utils';
import { mnemonicToSeedSync } from 'ethereum-cryptography/bip39';
import { HDNodeWallet, Mnemonic as EthersMnemonic } from 'ethers';
import { ByteUtils } from '../utils/bytes';

const getPath = (index = 0) => {
  return `m/44'/60'/0'/0/${index}`;
};

export class Mnemonic {
  static generate(strength: 128 | 192 | 256 = 128): string {
    return bip39.generateMnemonic(wordlist, strength);
  }

  static validate(mnemonic: string): boolean {
    return bip39.validateMnemonic(mnemonic, wordlist);
  }

  static toSeed(mnemonic: string, password: string = ''): string {
    return toHex(bip39.mnemonicToSeedSync(mnemonic, password));
  }

  static toEntropy(mnemonic: string): string {
    return toHex(bip39.mnemonicToEntropy(mnemonic, wordlist));
  }

  static fromEntropy(entropy: string): string {
    return bip39.entropyToMnemonic(ByteUtils.hexStringToBytes(entropy), wordlist);
  }

  /**
   * For deriving 0x private key from mnemonic and derivation index. Not for use with 0zk.
   */
  static to0xPrivateKey(mnemonic: string, derivationIndex?: number): string {
    const seed = mnemonicToSeedSync(mnemonic);
    const path = getPath(derivationIndex);
    const node = HDKey.fromMasterSeed(seed).derive(path);
    const privateKey = bytesToHex(node.privateKey as Uint8Array);
    return privateKey;
  }

  static to0xAddress(mnemonic: string, derivationIndex?: number): string {
    console.log('to0xAddress', mnemonic);
    console.log('derivationIndex', derivationIndex);
    
    const path = getPath(derivationIndex);

    console.log('path: ', path);
    
    const ethersMnemonic = EthersMnemonic.fromPhrase(mnemonic);
    
    const wallet = HDNodeWallet.fromMnemonic(ethersMnemonic, path);

    console.log('hdNodeWallet', wallet);
    const derived = wallet.derivePath(derivationIndex != null ? `${derivationIndex}` : "0")

    console.log('derived: ', derived);

    return wallet.derivePath(path).address;
  }
}
