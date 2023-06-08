/// <reference types="../types/global" />
import { mnemonicToSeedSync } from 'ethereum-cryptography/bip39';
import { HDKey } from 'ethereum-cryptography/hdkey';
import artifacts from 'railgun-community-circuit-artifacts';
import {
  ContractTransaction,
  JsonRpcProvider,
  Provider,
  TransactionResponse,
  Wallet,
} from 'ethers';
import { bytesToHex } from 'ethereum-cryptography/utils';
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
import { ArtifactGetter, PublicInputs } from '../models/prover-types';
import { mnemonicToPrivateKey } from '../key-derivation';

export const DECIMALS_18 = BigInt(10) ** BigInt(18);
export const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

const testNodeArtifactGetter = async (inputs: PublicInputs): Promise<Artifact> => {
  const nullifiers = inputs.nullifiers.length;
  const commitments = inputs.commitmentsOut.length;
  assertTestNodeArtifactExists(nullifiers, commitments);

  return {
    ...artifacts.getArtifact(nullifiers, commitments),
    dat: undefined,
  };
};

const assertTestNodeArtifactExists = (nullifiers: number, commitments: number): void => {
  const artifactList = artifacts.listArtifacts();
  const found = artifactList.find((artifactMetadata) => {
    return (
      artifactMetadata.nullifiers === nullifiers && artifactMetadata.commitments === commitments
    );
  });
  if (!found) {
    throw new Error(`No artifacts for inputs: ${nullifiers}-${commitments}`);
  }
};

export const testArtifactsGetter: ArtifactGetter = {
  getArtifacts: testNodeArtifactGetter,
  assertArtifactExists: assertTestNodeArtifactExists,
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

export const getEthersWallet = (mnemonic: string, provider?: Provider): Wallet => {
  const privateKey = mnemonicToPrivateKey(mnemonic);
  return new Wallet(privateKey, provider);
};

// TODO: This logic is messy - it's because of Ethers v6.4.0.
// It seems like the nonce isn't updated appropriately via hardhat.
// Ethers will probably improve the nonce calculation in the future. (Or hardhat?).
// We should be able to remove `additionalNonce` when it's updated.
export const sendTransactionWithLatestNonce = async (
  wallet: Wallet,
  transaction: ContractTransaction,
  additionalNonce = 0,
): Promise<TransactionResponse> => {
  if (additionalNonce > 2) {
    throw new Error('Nonce already used - many pending transactions');
  }
  const updatedNonceTx = {
    ...transaction,
    nonce: (await wallet.getNonce('latest')) + additionalNonce,
  };
  try {
    return await wallet.sendTransaction(updatedNonceTx);
  } catch (err) {
    if (!(err instanceof Error)) {
      throw err;
    }
    if (err.message.includes('nonce has already been used')) {
      return sendTransactionWithLatestNonce(wallet, transaction, additionalNonce + 1);
    }
    throw err;
  }
};
