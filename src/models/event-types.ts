import { Commitment, Nullifier, RailgunTransaction } from './formatted-types';
import { Chain } from './engine-types';
import { POIsPerList, TXIDVersion } from './poi-types';

export enum EngineEvent {
  WalletScanComplete = 'scanned',
  ContractNullifierReceived = 'nullified',
  UTXOMerkletreeHistoryScanUpdate = 'utxo-merkletree-history-scan-update',
  TXIDMerkletreeHistoryScanUpdate = 'txid-merkletree-history-scan-update',
  POIProofUpdate = 'POIProofUpdate',
}

export type QuickSyncEvents = (
  txidVersion: TXIDVersion,
  chain: Chain,
  startingBlock: number,
) => Promise<AccumulatedEvents>;
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
  txidVersion: TXIDVersion,
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
};

export type AccumulatedEvents = {
  commitmentEvents: CommitmentEvent[];
  unshieldEvents: UnshieldStoredEvent[];
  nullifierEvents: Nullifier[];
};

export type WalletScannedEventData = {
  txidVersion: TXIDVersion;
  chain: Chain;
};

export type MerkletreeHistoryScanEventData = {
  txidVersion: TXIDVersion;
  chain: Chain;
  progress?: number;
  scanStatus: MerkletreeScanStatus;
};

export enum MerkletreeScanStatus {
  Started = 'Started',
  Updated = 'Updated',
  Complete = 'Complete',
  Incomplete = 'Incomplete',
}

export type POICurrentProofEventData = {
  txidVersion: TXIDVersion;
  chain: Chain;
  progress: number;
  listKey: string;
  txid: string;
  railgunTxid: string;
  index: number;
  totalCount: number;
};
