import { mnemonicToSeedSync } from 'ethereum-cryptography/bip39';
import { HDKey } from 'ethereum-cryptography/hdkey';
// eslint-disable-next-line import/no-unresolved
import artifacts from 'railgun-community-circuit-artifacts';
import { ethers } from 'ethers';
import { bytesToHex } from 'ethereum-cryptography/utils';
import { JsonRpcProvider } from '@ethersproject/providers';
import { Nullifier } from '../models/formatted-types';
import {
  AccumulatedEvents,
  CommitmentEvent,
  EngineEvent,
  QuickSync,
  WalletScannedEventData,
  UnshieldStoredEvent,
} from '../models/event-types';
import { AbstractWallet } from '../wallet/abstract-wallet';
import { Chain } from '../models/engine-types';
import { PublicInputs } from '../models/prover-types';

export const DECIMALS_18 = BigInt(10) ** BigInt(18);
const WALLET_PATH = "m/44'/60'/0'/0/0";
export const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

export const artifactGetter = async (inputs: PublicInputs) => {
  const nullifiers = inputs.nullifiers.length;
  const commitments = inputs.commitmentsOut.length;
  if (!artifactExists(nullifiers, commitments)) {
    throw new Error(
      `No artifacts for inputs: ${inputs.nullifiers.length}-${inputs.commitmentsOut.length}`,
    );
  }
  return artifacts.getArtifact(nullifiers, commitments);
};

export const artifactExists = (nullifiers: number, commitments: number): boolean => {
  const artifactList = artifacts.listArtifacts();
  const found = artifactList.find((artifactMetadata) => {
    return (
      artifactMetadata.nullifiers === nullifiers && artifactMetadata.commitments === commitments
    );
  });
  return found != null;
};

export const mockQuickSync: QuickSync = (
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _chain: Chain,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _startingBlock: number,
): Promise<AccumulatedEvents> =>
  Promise.resolve({
    commitmentEvents: [] as CommitmentEvent[],
    unshieldEvents: [] as UnshieldStoredEvent[],
    nullifierEvents: [] as Nullifier[],
  });

export const awaitScan = (wallet: AbstractWallet, chain: Chain) =>
  new Promise((resolve, reject) =>
    wallet.once(
      EngineEvent.WalletScanComplete,
      ({ chain: returnedChain }: WalletScannedEventData) =>
        returnedChain.type === chain.type && returnedChain.id === chain.id
          ? resolve(returnedChain)
          : reject(),
    ),
  );

export const awaitMultipleScans = async (
  wallet: AbstractWallet,
  chain: Chain,
  numScans: number,
) => {
  let i = 0;
  while (i < numScans) {
    // eslint-disable-next-line no-await-in-loop
    await awaitScan(wallet, chain);
    i += 1;
  }
  return Promise.resolve();
};

export const getEthersWallet = (mnemonic: string, provider: JsonRpcProvider): ethers.Wallet => {
  const node = HDKey.fromMasterSeed(mnemonicToSeedSync(mnemonic)).derive(WALLET_PATH);
  const wallet = new ethers.Wallet(bytesToHex(node.privateKey as Uint8Array), provider);
  return wallet;
};
