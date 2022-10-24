import { TransactNote } from '../note/transact-note';
import { NoteAnnotationData } from './formatted-types';

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
};

export type SpendingSolutionGroup = {
  utxos: TXO[];
  spendingTree: number;
  outputs: TransactNote[];
  unshieldValue: bigint;
};
