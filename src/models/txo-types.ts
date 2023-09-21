import { TransactNote } from '../note/transact-note';
import { CommitmentType, NoteAnnotationData, TokenData } from './formatted-types';
import { POIsPerList } from './poi-types';

export type TXO = {
  tree: number;
  position: number;
  txid: string;
  timestamp: Optional<number>;
  spendtxid: string | false;
  nullifier: string;
  note: TransactNote;
  creationRailgunTxid: Optional<string>;
  creationPOIs: Optional<POIsPerList>;
  blindedCommitment: Optional<string>;
  commitmentType: CommitmentType;
};

export type SentCommitment = {
  tree: number;
  position: number;
  txid: string;
  timestamp: Optional<number>;
  note: TransactNote;
  noteAnnotationData?: NoteAnnotationData;
  isLegacyTransactNote: boolean;
  spentRailgunTxid: Optional<string>;
  spentPOIs: Optional<POIsPerList>;
  blindedCommitment: Optional<string>;
  commitmentType: CommitmentType;
};

export type SpendingSolutionGroup = {
  utxos: TXO[];
  spendingTree: number;
  tokenOutputs: TransactNote[];
  unshieldValue: bigint;
  tokenData: TokenData;
};

export type UnshieldData = {
  toAddress: string;
  value: bigint;
  tokenData: TokenData;
  allowOverride?: boolean;
};
