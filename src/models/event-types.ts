import { BigNumber, BigNumberish } from 'ethers';
import { BytesData, Commitment, Nullifier } from './formatted-types';
import { Chain } from './engine-types';

export enum EngineEvent {
  WalletScanComplete = 'scanned',
  ContractNullifierReceived = 'nullified',
  MerkletreeHistoryScanStarted = 'merkletree-history-scan-started',
  MerkletreeHistoryScanUpdate = 'merkletree-history-scan-update',
  MerkletreeHistoryScanComplete = 'merkletree-history-scan-complete',
  MerkletreeHistoryScanIncomplete = 'merkletree-history-scan-incomplete',
}

export type QuickSync = (chain: Chain, startingBlock: number) => Promise<AccumulatedEvents>;
export type EventsListener = (event: CommitmentEvent) => Promise<void>;
export type EventsNullifierListener = (nullifiers: Nullifier[]) => Promise<void>;

export type CommitmentEvent = {
  txid: BytesData;
  treeNumber: number;
  startPosition: number;
  commitments: Commitment[];
  blockNumber: number;
};

export type CommitmentCiphertextArgs = {
  ciphertext: [BigNumber, BigNumber, BigNumber, BigNumber];
  ephemeralKeys: [BigNumber, BigNumber];
  memo: BigNumber[];
};

export type CommitmentTokenData = {
  tokenType: BigNumberish;
  tokenAddress: string;
  tokenSubID: BigNumberish;
};

export type EncryptedDataArgs = [BigNumber, BigNumber];

export type CommitmentPreimageArgs = {
  npk: BigNumber;
  token: CommitmentTokenData;
  value: BigNumber;
};

export type EventTokenData = { tokenType: BigNumber; tokenAddress: string; tokenSubID: BigNumber };

/**
 * event.args of GeneratedCommitmentBatch Event
 */
export type GeneratedCommitmentBatchEventArgs = {
  treeNumber: BigNumber;
  startPosition: BigNumber;
  commitments: CommitmentPreimageArgs[];
  encryptedRandom: EncryptedDataArgs[];
};

/**
 * event.args of CommitmentBatch Event
 */
export type CommitmentBatchEventArgs = {
  treeNumber: BigNumber;
  startPosition: BigNumber;
  hash: BigNumber[];
  ciphertext: CommitmentCiphertextArgs[];
};

export type NullifierEventArgs = {
  treeNumber: BigNumber;
  nullifier: BigNumber[];
};

export type AccumulatedEvents = {
  commitmentEvents: CommitmentEvent[];
  nullifierEvents: Nullifier[];
};

export type ScannedEventData = {
  chain: Chain;
};

export type MerkletreeHistoryScanEventData = {
  chain: Chain;
};

export type MerkletreeHistoryScanUpdateData = {
  chain: Chain;
  progress: number;
};
