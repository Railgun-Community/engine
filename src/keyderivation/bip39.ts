import * as bip39 from 'ethereum-cryptography/bip39';
import { wordlist } from 'ethereum-cryptography/bip39/wordlists/english';
import { toHex } from 'ethereum-cryptography/utils';
import { hexStringToBytes } from '../utils/bytes';

function generateMnemonic(strength: 128 | 192 | 256 = 128): string {
  return bip39.generateMnemonic(wordlist, strength);
}

function validateMnemonic(mnemonic: string): boolean {
  return bip39.validateMnemonic(mnemonic, wordlist);
}

function mnemonicToSeed(mnemonic: string, password: string = ''): string {
  return toHex(bip39.mnemonicToSeedSync(mnemonic, password));
}

function mnemonicToEntropy(mnemonic: string): string {
  return toHex(bip39.mnemonicToEntropy(mnemonic, wordlist));
}

function entropyToMnemonic(entropy: string): string {
  return bip39.entropyToMnemonic(hexStringToBytes(entropy), wordlist);
}

export { generateMnemonic, validateMnemonic, mnemonicToSeed, mnemonicToEntropy, entropyToMnemonic };
