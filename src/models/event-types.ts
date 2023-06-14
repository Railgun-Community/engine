import { Commitment, Nullifier } from './formatted-types';
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
export type EventsCommitmentListener = (event: CommitmentEvent) => Promise<void>;
export type EventsNullifierListener = (nullifiers: Nullifier[]) => Promise<void>;
export type EventsUnshieldListener = (unshields: UnshieldStoredEvent[]) => Promise<void>;

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
