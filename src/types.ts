export enum LeptonEvent {
  WalletScanComplete = 'scanned',
  ContractNullifierReceived = 'nullified',
  MerkletreeHistoryScanComplete = 'merkletree-history-scan-complete',
  MerkletreeHistoryScanIncomplete = 'merkletree-history-scan-incomplete',
}

export type ScannedEventData = {
  chainID: number;
};

export type MerkletreeHistoryScanEventData = {
  chainID: number;
};
