import bip39 from 'bip39';

export default {
  generateMnemonic: bip39.generateMnemonic,
  validateMnemonic: bip39.validateMnemonic,
  mnemonicToSeed: bip39.mnemonicToSeedSync,
  mnemonicToEntropy: bip39.mnemonicToEntropy,
  entropyToMnemonic: bip39.entropyToMnemonic,
};
