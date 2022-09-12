import { NoteExtraData } from './formatted-types';
import { TXO } from './txo-types';

export type WalletDetails = {
  treeScannedHeights: number[];
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

export type WalletData = { mnemonic: string; index: number };

export type ViewOnlyWalletData = { shareableViewingKey: string };

export type ShareableViewingKeyData = {
  vpriv: string; // viewingPrivateKey
  spub: string; // spendingPublicKey
};

export type TransactionHistoryTokenAmount = {
  token: string;
  amount: bigint;
  noteExtraData?: NoteExtraData;
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
  version: number;
};
export type TransactionHistoryEntry = TransactionHistoryEntrySpent &
  TransactionHistoryEntryReceived;
export type TransactionHistoryEntryPreprocessSpent = {
  txid: string;
  tokenAmounts: TransactionHistoryTokenAmount[];
  version: number;
};
export enum TransactionHistoryItemVersion {
  Unknown = 0, // Receive note only: noteExtraData metadata not possible
  Legacy = 1, // No noteExtraData on spent notes
  UpdatedAug2022 = 2, // Adds noteExtraData for spent notes (outputType)
}

export enum NoteType {
  Receiver = 'Receiver',
  Spender = 'Spender',
}
