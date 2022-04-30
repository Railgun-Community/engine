import { Note } from '../note';

export type WalletDetails = {
  treeScannedHeights: number[];
};

export type TXO = {
  tree: number;
  position: number;
  txid: string;
  spendtxid: string | false;
  dummyKey?: string; // For dummy notes
  note: Note;
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

export type ScannedEventData = {
  chainID: number;
};

export type AddressKeys = {
  masterPublicKey: bigint;
  viewingPublicKey: Uint8Array;
};

export type WalletData = { mnemonic: string; index: number };

export type WalletNodes = { spending: Node; viewing: Node };
