import { HDKey } from 'ethereum-cryptography/hdkey';
import { mnemonicToSeedSync } from 'ethereum-cryptography/bip39';
import { bytesToHex } from 'ethereum-cryptography/utils';

const getPath = (index = 0) => {
  return `m/44'/60'/0'/0/${index}`;
};

// For deriving 0x private key from mnemonic and derivation index. Not for use with 0zk.
export const mnemonicTo0xPrivateKey = (mnemonic: string, derivationIndex?: number) => {
  const seed = mnemonicToSeedSync(mnemonic);
  const path = getPath(derivationIndex);
  const node = HDKey.fromMasterSeed(seed).derive(path);
  const privateKey = bytesToHex(node.privateKey as Uint8Array);
  return privateKey;
};
