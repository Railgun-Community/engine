import { BigNumber } from 'ethers';
import { BytesData, Commitment, Nullifier } from './formatted-types';
import { Chain } from './engine-types';
import { CommitmentCiphertextStructOutput } from '../typechain-types/contracts/logic/RailgunSmartWallet';

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

export type UnshieldEventArgs = {
  treeNumber: BigNumber;
  startPosition: BigNumber;
  hash: string[];
  ciphertext: CommitmentCiphertextStructOutput[];
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
