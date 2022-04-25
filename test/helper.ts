/* eslint-disable @typescript-eslint/no-unused-vars */
import { mnemonicToSeedSync } from 'ethereum-cryptography/bip39';
import { HDKey } from 'ethereum-cryptography/hdkey';
import { bytesToHex } from 'ethereum-cryptography/utils';
import { ethers } from 'ethers';
// @ts-ignore
import artifacts from 'railgun-artifacts-node';
import { AccumulatedEvents, QuickSync } from '../src';
import { CommitmentEvent } from '../src/contract/erc20/events';
import { Nullifier } from '../src/merkletree';
import { PublicInputs } from '../src/prover';
import { ScannedEventData, Wallet } from '../src/wallet';

export const DECIMALS = 10n ** 18n;
const WALLET_PATH = "m/44'/60'/0'/0/0";
export const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

const { log } = console;
export const artifactsGetter = (inputs: PublicInputs) => {
  log(`artifacts ${inputs.nullifiers.length}-${inputs.commitmentsOut.length}`);
  return artifacts[inputs.nullifiers.length][inputs.commitmentsOut.length];
};

export const quicksync: QuickSync = (
  chainID: number,
  startingBlock: number,
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
