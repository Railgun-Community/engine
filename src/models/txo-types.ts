import { Note } from '../note/note';
import { NoteExtraData } from './formatted-types';

export type TXO = {
  tree: number;
  position: number;
  txid: string;
  spendtxid: string | false;
  note: Note;
};

export type SentCommitment = {
  tree: number;
  position: number;
  txid: string;
  note: Note;
  noteExtraData?: NoteExtraData;
};

export type SpendingSolutionGroup = {
  utxos: TXO[];
  spendingTree: number;
  outputs: Note[];
  withdrawValue: bigint;
};
