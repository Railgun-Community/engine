import { Note } from '../note/note';

export type TXO = {
  tree: number;
  position: number;
  txid: string;
  spendtxid: string | false;
  note: Note;
};

export type SpendingSolutionGroup = {
  utxos: TXO[];
  spendingTree: number;
  outputs: Note[];
  withdrawValue: bigint;
};
