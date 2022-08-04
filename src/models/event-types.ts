export enum LeptonEvent {
  WalletScanComplete = 'scanned',
  ContractNullifierReceived = 'nullified',
  MerkletreeHistoryScanStarted = 'merkletree-history-scan-started',
  MerkletreeHistoryScanUpdate = 'merkletree-history-scan-update',
  MerkletreeHistoryScanComplete = 'merkletree-history-scan-complete',
  MerkletreeHistoryScanIncomplete = 'merkletree-history-scan-incomplete',
}

export type ScannedEventData = {
  chainID: number;
};

export type MerkletreeHistoryScanEventData = {
  chainID: number;
};

export type MerkletreeHistoryScanUpdateData = {
  chainID: number;
  progress: number;
};
