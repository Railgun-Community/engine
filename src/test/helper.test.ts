/// <reference types="../types/global" />
import { ContractTransaction, Provider, TransactionResponse, Wallet } from 'ethers';
import artifacts from './test-artifacts-lite';
import { Nullifier, RailgunTransactionV2 } from '../models/formatted-types';
import {
  AccumulatedEvents,
  CommitmentEvent,
  EngineEvent,
  WalletScannedEventData,
  UnshieldStoredEvent,
  QuickSyncEvents,
  QuickSyncRailgunTransactionsV2,
  GetLatestValidatedRailgunTxid,
} from '../models/event-types';
import { AbstractWallet } from '../wallet/abstract-wallet';
import { Chain } from '../models/engine-types';
import { ArtifactGetter, PublicInputsRailgun } from '../models/prover-types';
import { Mnemonic } from '../key-derivation';
import { TypedContractEvent, TypedDeferredTopicFilter } from '../abi/typechain/common';
import { promiseTimeout } from '../utils/promises';
import { MerklerootValidator } from '../models/merkletree-types';
import { TXIDVersion } from '../models';
import { RailgunVersionedSmartContracts } from '../contracts/railgun-smart-wallet/railgun-versioned-smart-contracts';
import { ContractStore } from '../contracts/contract-store';

export const DECIMALS_18 = BigInt(10) ** BigInt(18);
export const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

const testNodeArtifactGetter = async (inputs: PublicInputsRailgun): Promise<Artifact> => {
  const nullifiers = inputs.nullifiers.length;
  const commitments = inputs.commitmentsOut.length;
  assertTestNodeArtifactExists(nullifiers, commitments);

  try {
    return {
      ...artifacts.getArtifacts(nullifiers, commitments),
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

const testNodeArtifactGetterPOI = async (
  maxInputs: number,
  maxOutputs: number,
): Promise<Artifact> => {
  try {
    return {
      ...artifacts.getArtifactsPOI(maxInputs, maxOutputs),
      dat: undefined,
    };
  } catch (err) {
    throw new Error(`Could not find lite artifact for tests: POI`);
  }
};

export const testArtifactsGetter: ArtifactGetter = {
  getArtifacts: testNodeArtifactGetter,
  assertArtifactExists: assertTestNodeArtifactExists,
  getArtifactsPOI: testNodeArtifactGetterPOI,
};

export const mockQuickSyncEvents: QuickSyncEvents = (
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _txidVersion: TXIDVersion,
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

export const mockQuickSyncRailgunTransactionsV2: QuickSyncRailgunTransactionsV2 = (
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _chain: Chain,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _latestGraphID: Optional<string>,
): Promise<RailgunTransactionV2[]> => Promise.resolve([]);

export const mockRailgunTxidMerklerootValidator: MerklerootValidator = (): Promise<boolean> =>
  Promise.resolve(true);

export const mockGetLatestValidatedRailgunTxid: GetLatestValidatedRailgunTxid = () =>
  Promise.resolve({ txidIndex: 0, merkleroot: '0x00' });

export const awaitScan = (wallet: AbstractWallet, chain: Chain) =>
  new Promise((resolve, reject) =>
    wallet.once(
      EngineEvent.WalletDecryptBalancesComplete,
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
  txidVersion: TXIDVersion,
  chain: Chain,
  event: TypedDeferredTopicFilter<TypedContractEvent>,
) => {
  await promiseTimeout(
    new Promise<void>((resolve) => {
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      // @ts-expect-error
      RailgunVersionedSmartContracts.getAccumulator(txidVersion, chain).contractForListeners.once(
        event,
        () => resolve(),
      );
    }),
    30000,
    `Timed out waiting for event: ${event.fragment.name}`,
  );
};

const awaitPoseidonMerkleAccumulatorV3Update = async (txidVersion: TXIDVersion, chain: Chain) => {
  return awaitRailgunSmartWalletEvent(
    txidVersion,
    chain,
    ContractStore.poseidonMerkleAccumulatorV3Contracts
      .getOrThrow(null, chain)
      .contract.filters.AccumulatorStateUpdate(),
  );
};

export const awaitRailgunSmartWalletShield = async (txidVersion: TXIDVersion, chain: Chain) => {
  switch (txidVersion) {
    case TXIDVersion.V2_PoseidonMerkle:
      return awaitRailgunSmartWalletEvent(
        txidVersion,
        chain,
        ContractStore.railgunSmartWalletContracts.getOrThrow(null, chain).contract.filters.Shield(),
      );

    case TXIDVersion.V3_PoseidonMerkle:
      return awaitPoseidonMerkleAccumulatorV3Update(txidVersion, chain);
  }
  throw new Error('Unsupported txidVersion');
};

export const awaitRailgunSmartWalletTransact = async (txidVersion: TXIDVersion, chain: Chain) => {
  switch (txidVersion) {
    case TXIDVersion.V2_PoseidonMerkle:
      return awaitRailgunSmartWalletEvent(
        txidVersion,
        chain,
        ContractStore.railgunSmartWalletContracts
          .getOrThrow(null, chain)
          .contract.filters.Transact(),
      );

    case TXIDVersion.V3_PoseidonMerkle:
      return awaitPoseidonMerkleAccumulatorV3Update(txidVersion, chain);
  }
  throw new Error('Unsupported txidVersion');
};

export const awaitRailgunSmartWalletUnshield = async (txidVersion: TXIDVersion, chain: Chain) => {
  switch (txidVersion) {
    case TXIDVersion.V2_PoseidonMerkle:
      return awaitRailgunSmartWalletEvent(
        txidVersion,
        chain,
        ContractStore.railgunSmartWalletContracts
          .getOrThrow(null, chain)
          .contract.filters.Unshield(),
      );

    case TXIDVersion.V3_PoseidonMerkle:
      return awaitPoseidonMerkleAccumulatorV3Update(txidVersion, chain);
  }
  throw new Error('Unsupported txidVersion');
};

export const awaitRailgunSmartWalletNullified = async (txidVersion: TXIDVersion, chain: Chain) => {
  switch (txidVersion) {
    case TXIDVersion.V2_PoseidonMerkle:
      return awaitRailgunSmartWalletEvent(
        txidVersion,
        chain,
        ContractStore.railgunSmartWalletContracts
          .getOrThrow(null, chain)
          .contract.filters.Nullified(),
      );

    case TXIDVersion.V3_PoseidonMerkle:
      return awaitPoseidonMerkleAccumulatorV3Update(txidVersion, chain);
  }
  throw new Error('Unsupported txidVersion');
};

export const getEthersWallet = (mnemonic: string, provider?: Provider): Wallet => {
  const privateKey = Mnemonic.to0xPrivateKey(mnemonic);
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
  if (retries > 5) {
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

export const isV2Test = (): boolean => {
  return process.env.V2_TEST === '1';
};

export const getTestTXIDVersion = () => {
  if (isV2Test()) {
    return TXIDVersion.V2_PoseidonMerkle;
  }
  return TXIDVersion.V3_PoseidonMerkle;
};
