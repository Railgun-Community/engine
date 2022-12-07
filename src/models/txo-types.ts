import { TransactNote } from '../note/transact-note';
import { NoteAnnotationData, TokenData } from './formatted-types';

export type TXO = {
  tree: number;
  position: number;
  txid: string;
  spendtxid: string | false;
  note: TransactNote;
};

export type SentCommitment = {
  tree: number;
  position: number;
  txid: string;
  note: TransactNote;
  noteAnnotationData?: NoteAnnotationData;
  isLegacyTransactNote: boolean;
};

export type SpendingSolutionGroup = {
  utxos: TXO[];
  spendingTree: number;
  tokenOutputs: TransactNote[];
  unshieldValue: bigint;
  tokenHash: string;
};

export type UnshieldData = {
  toAddress: string;
  value: bigint;
  tokenData: TokenData;
  tokenHash: string;
  allowOverride?: boolean;
};
