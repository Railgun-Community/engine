import { Commitment, Nullifier, RailgunTransaction } from './formatted-types';
import { Chain } from './engine-types';
import { POIsPerList, TXIDVersion } from './poi-types';

export enum EngineEvent {
  WalletScanComplete = 'scanned',
  ContractNullifierReceived = 'nullified',
  MerkletreeHistoryScanStarted = 'merkletree-history-scan-started',
  MerkletreeHistoryScanUpdate = 'merkletree-history-scan-update',
  MerkletreeHistoryScanComplete = 'merkletree-history-scan-complete',
  MerkletreeHistoryScanIncomplete = 'merkletree-history-scan-incomplete',
}

export type QuickSyncEvents = (chain: Chain, startingBlock: number) => Promise<AccumulatedEvents>;
export type EventsCommitmentListener = (
  txidVersion: TXIDVersion,
  event: CommitmentEvent,
) => Promise<void>;
export type EventsNullifierListener = (
  txidVersion: TXIDVersion,
  nullifiers: Nullifier[],
) => Promise<void>;
export type EventsUnshieldListener = (
  txidVersion: TXIDVersion,
  unshields: UnshieldStoredEvent[],
) => Promise<void>;

export type QuickSyncRailgunTransactions = (
  chain: Chain,
  latestGraphID: Optional<string>,
) => Promise<RailgunTransaction[]>;

export type GetLatestValidatedRailgunTxid = (
  chain: Chain,
) => Promise<{ txidIndex: Optional<number>; merkleroot: Optional<string> }>;

export type CommitmentEvent = {
  txid: string;
  treeNumber: number;
  startPosition: number;
  commitments: Commitment[];
  blockNumber: number;
};

export type UnshieldStoredEvent = {
  txid: string;
  timestamp: Optional<number>;
  toAddress: string;
  tokenType: number;
  tokenAddress: string;
  tokenSubID: string;
  amount: string;
  fee: string;
  blockNumber: number;
  eventLogIndex: number;
  railgunTxid: Optional<string>;
  poisPerList: Optional<POIsPerList>;
  blindedCommitment: Optional<string>;
  txidVersion: TXIDVersion;
};

export type AccumulatedEvents = {
  commitmentEvents: CommitmentEvent[];
  unshieldEvents: UnshieldStoredEvent[];
  nullifierEvents: Nullifier[];
};

export type WalletScannedEventData = {
  chain: Chain;
};

export type MerkletreeHistoryScanEventData = {
  chain: Chain;
};

export type MerkletreeHistoryScanUpdateData = {
  chain: Chain;
  progress: number;
};
