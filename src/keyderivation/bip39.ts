import * as bip39 from 'bip39';

function generateMnemonic(strength: 128 | 192 | 256 = 128) {
  // TODO: Remove dependency on bip39 lib
  return bip39.generateMnemonic(strength);
}

function validateMnemonic(mnemonic: string) {
  // TODO: Remove dependency on bip39 lib
  return bip39.validateMnemonic(mnemonic);
}

function mnemonicToSeed(mnemonic: string, password: string = '') {
  // TODO: Remove dependency on bip39 lib
  return bip39.mnemonicToSeedSync(mnemonic, password).toString('hex');
}

function mnemonicToEntropy(mnemonic: string) {
  // TODO: Remove dependency on bip39 lib
  return bip39.mnemonicToEntropy(mnemonic);
}

function entropyToMnemonic(mnemonic: string) {
  // TODO: Remove dependency on bip39 lib
  return bip39.entropyToMnemonic(mnemonic);
}

export default {
  generateMnemonic,
  validateMnemonic,
  mnemonicToSeed,
  mnemonicToEntropy,
  entropyToMnemonic,
};
