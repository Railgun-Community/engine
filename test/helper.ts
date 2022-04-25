/* eslint-disable @typescript-eslint/no-unused-vars */
import { mnemonicToSeedSync } from 'ethereum-cryptography/bip39';
import { HDKey } from 'ethereum-cryptography/hdkey';
// @ts-ignore
import artifacts from 'railgun-artifacts-node';
import { ethers } from 'ethers';
import { bytesToHex } from 'ethereum-cryptography/utils';
import { PublicInputs } from '../src/prover';
import { ScannedEventData, Wallet } from '../src/wallet';
import { AccumulatedEvents, QuickSync } from '../src';
import { Nullifier } from '../src/merkletree';
import { CommitmentEvent } from '../src/contract/erc20/events';

export const DECIMALS = 10n ** 18n;
const WALLET_PATH = "m/44'/60'/0'/0/0";
export const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

export const artifactsGetter = (inputs: PublicInputs) => {
  if (
    !artifacts[inputs.nullifiers.length] ||
    !artifacts[inputs.nullifiers.length][inputs.commitmentsOut.length]
  ) {
    throw new Error(
      `No artifacts for inputs: ${inputs.nullifiers.length}-${inputs.commitmentsOut.length}`,
    );
  }
  return artifacts[inputs.nullifiers.length][inputs.commitmentsOut.length];
};

export const mockQuickSync: QuickSync = (
  _chainID: number,
  _startingBlock: number,
): Promise<AccumulatedEvents> =>
  Promise.resolve({
    commitmentEvents: [] as CommitmentEvent[],
    nullifierEvents: [] as Nullifier[],
  });

export const awaitScan = (wallet: Wallet, chainID: number) =>
  new Promise((resolve, reject) =>
    wallet.once('scanned', ({ chainID: returnedChainID }: ScannedEventData) =>
      returnedChainID === chainID ? resolve(returnedChainID) : reject(),
    ),
  );

export const getEthersWallet = (
  mnemonic: string,
  provider: ethers.providers.JsonRpcProvider,
): ethers.Wallet => {
  const node = HDKey.fromMasterSeed(mnemonicToSeedSync(mnemonic)).derive(WALLET_PATH);
  const wallet = new ethers.Wallet(bytesToHex(node.privateKey as Uint8Array), provider);
  return wallet;
};
