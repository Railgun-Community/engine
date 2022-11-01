import { UnshieldStoredEvent } from './event-types';
import { NoteAnnotationData } from './formatted-types';
import { TXO } from './txo-types';

export type WalletDetails = {
  treeScannedHeights: number[];
  creationTree: Optional<number>;
  creationTreeHeight: Optional<number>;
};

export type TreeBalance = {
  balance: bigint;
  utxos: TXO[];
};

export type Balances = {
  [key: string]: TreeBalance;
  // Key: Token
};

export type BalancesByTree = {
  [key: string]: TreeBalance[];
  // Index = tree
};

export type AddressKeys = {
  masterPublicKey: bigint;
  viewingPublicKey: Uint8Array;
};

export type WalletData = {
  mnemonic: string;
  index: number;
  creationBlockNumbers: Optional<number[][]>;
};

export type ViewOnlyWalletData = {
  shareableViewingKey: string;
  creationBlockNumbers: Optional<number[][]>;
};

export type ShareableViewingKeyData = {
  vpriv: string; // viewingPrivateKey
  spub: string; // spendingPublicKey
};

export type TransactionHistoryTokenAmount = {
  token: string;
  amount: bigint;
  noteAnnotationData?: NoteAnnotationData;
  memoText: Optional<string>;
};
export type TransactionHistoryTransferTokenAmount = TransactionHistoryTokenAmount & {
  recipientAddress: string;
};
export type TransactionHistoryEntryReceived = {
  txid: string;
  receiveTokenAmounts: TransactionHistoryTokenAmount[];
};
export type TransactionHistoryEntrySpent = {
  txid: string;
  transferTokenAmounts: TransactionHistoryTransferTokenAmount[];
  changeTokenAmounts: TransactionHistoryTokenAmount[];
  relayerFeeTokenAmount?: TransactionHistoryTokenAmount;
  unshieldTokenAmounts: TransactionHistoryTransferTokenAmount[];
  version: number;
};
export type TransactionHistoryEntry = TransactionHistoryEntrySpent &
  TransactionHistoryEntryReceived;
export type TransactionHistoryEntryPreprocessSpent = {
  txid: string;
  tokenAmounts: TransactionHistoryTokenAmount[];
  version: number;
  unshieldEvents: UnshieldStoredEvent[];
};
export enum TransactionHistoryItemVersion {
  Unknown = 0, // Receive note only: noteAnnotationData metadata not possible
  Legacy = 1, // No noteAnnotationData on spent notes
  UpdatedAug2022 = 2, // Adds noteAnnotationData for spent notes (outputType)
}

export enum NoteType {
  Receiver = 'Receiver',
  Spender = 'Spender',
}
