import { NoteExtraData } from '../models/formatted-types';
import { TXO } from '../models/txo-types';

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

export type TransactionHistoryTokenAmount = {
  token: string;
  amount: bigint;
  noteExtraData?: NoteExtraData;
};
export type TransactionHistoryEntry = {
  txid: string;
  receiveTokenAmounts: TransactionHistoryTokenAmount[];
  transferTokenAmounts: TransactionHistoryTokenAmount[];
  changeTokenAmounts: TransactionHistoryTokenAmount[];
  relayerFeeTokenAmount?: TransactionHistoryTokenAmount;
};
export type TransactionHistoryEntryReceived = {
  txid: string;
  receiveTokenAmounts: TransactionHistoryTokenAmount[];
};
export type TransactionHistoryEntrySpent = {
  txid: string;
  transferTokenAmounts: TransactionHistoryTokenAmount[];
  changeTokenAmounts: TransactionHistoryTokenAmount[];
  relayerFeeTokenAmount?: TransactionHistoryTokenAmount;
};
export type TransactionHistoryEntryPreprocessSpent = {
  txid: string;
  tokenAmounts: TransactionHistoryTokenAmount[];
};

export enum NoteType {
  Receiver = 'Receiver',
  Spender = 'Spender',
}
