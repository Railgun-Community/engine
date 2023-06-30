/// <reference types="../types/global" />
import { ContractTransaction, Provider, TransactionResponse, Wallet } from 'ethers';
import artifacts from './test-artifacts-lite';
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
import { TypedContractEvent, TypedDeferredTopicFilter } from '../abi/typechain/common';
import { RailgunSmartWalletContract } from '../contracts/railgun-smart-wallet/railgun-smart-wallet';
import { promiseTimeout } from '../utils';

export const DECIMALS_18 = BigInt(10) ** BigInt(18);
export const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

const testNodeArtifactGetter = async (inputs: PublicInputs): Promise<Artifact> => {
  const nullifiers = inputs.nullifiers.length;
  const commitments = inputs.commitmentsOut.length;
  assertTestNodeArtifactExists(nullifiers, commitments);

  try {
    return {
      ...artifacts.getArtifact(nullifiers, commitments),
      dat: undefined,
    };
  } catch (err) {
    throw new Error(
      `Could not find lite artifact for tests: ${inputs.nullifiers.length}:${inputs.commitmentsOut.length}`,
    );
  }
};

const assertTestNodeArtifactExists = (nullifiers: number, commitments: number): void => {
  const artifactList = artifacts.listArtifacts();
  const found = artifactList.find((artifactMetadata) => {
    return (
      artifactMetadata.nullifiers === nullifiers && artifactMetadata.commitments === commitments
    );
  });
  if (!found) {
    throw new Error(
      `No artifacts for inputs: ${nullifiers}-${commitments}. NOTE: railgun-community-circuit-artifacts-lite only includes a small subset of artifacts for testing.`,
    );
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

export const awaitRailgunSmartWalletEvent = async (
  railgunSmartWallet: RailgunSmartWalletContract,
  event: TypedDeferredTopicFilter<TypedContractEvent>,
) => {
  await promiseTimeout(
    new Promise<void>((resolve) => {
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      railgunSmartWallet.contractForListeners.once(event, () => resolve());
    }),
    15000,
    `Timed out waiting for RailgunSmartWallet event: ${event.fragment.name}`,
  );
};

export const awaitRailgunSmartWalletShield = async (
  railgunSmartWallet: RailgunSmartWalletContract,
) => {
  return awaitRailgunSmartWalletEvent(
    railgunSmartWallet,
    railgunSmartWallet.contract.filters.Shield(),
  );
};

export const awaitRailgunSmartWalletTransact = async (
  railgunSmartWallet: RailgunSmartWalletContract,
) => {
  return awaitRailgunSmartWalletEvent(
    railgunSmartWallet,
    railgunSmartWallet.contract.filters.Transact(),
  );
};

export const awaitRailgunSmartWalletUnshield = async (
  railgunSmartWallet: RailgunSmartWalletContract,
) => {
  return awaitRailgunSmartWalletEvent(
    railgunSmartWallet,
    railgunSmartWallet.contract.filters.Unshield(),
  );
};

export const awaitRailgunSmartWalletNullified = async (
  railgunSmartWallet: RailgunSmartWalletContract,
) => {
  return awaitRailgunSmartWalletEvent(
    railgunSmartWallet,
    railgunSmartWallet.contract.filters.Nullified(),
  );
};

export const getEthersWallet = (mnemonic: string, provider?: Provider): Wallet => {
  const privateKey = mnemonicToPrivateKey(mnemonic);
  return new Wallet(privateKey, provider);
};

// TODO: This logic is messy - it's because of Ethers v6.4.0.
// It seems like the nonce isn't updated quickly enough via hardhat.
// Ethers will probably improve the nonce calculation in the future. (Or hardhat?).
// We should be able to remove `additionalNonce` and `retries` when it's updated.
export const sendTransactionWithLatestNonce = async (
  wallet: Wallet,
  transaction: ContractTransaction,
  expectedNextNonce?: number,
  retries = 0,
): Promise<TransactionResponse> => {
  if (retries > 3) {
    throw new Error('Nonce already used - many pending transactions');
  }
  const latestNonce = await wallet.getNonce('latest');
  const nonce = expectedNextNonce ?? latestNonce;
  const updatedNonceTx: ContractTransaction = {
    ...transaction,
    nonce,
  };
  try {
    return await wallet.sendTransaction(updatedNonceTx);
  } catch (err) {
    if (!(err instanceof Error)) {
      throw err;
    }
    if (err.message.includes('nonce has already been used')) {
      return sendTransactionWithLatestNonce(wallet, transaction, nonce + 1, retries + 1);
    }
    throw err;
  }
};
