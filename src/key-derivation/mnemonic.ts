import { HDKey } from 'ethereum-cryptography/hdkey';
import { mnemonicToSeedSync } from 'ethereum-cryptography/bip39';
import { bytesToHex } from 'ethereum-cryptography/utils';
import { defaultPath } from 'ethers';

export const mnemonicToPrivateKey = (mnemonic: string) => {
  const seed = mnemonicToSeedSync(mnemonic);
  const node = HDKey.fromMasterSeed(seed).derive(defaultPath);
  const privateKey = bytesToHex(node.privateKey as Uint8Array);
  return privateKey;
};
