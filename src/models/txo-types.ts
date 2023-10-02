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
  // POIs that created this TXO
  poisPerList: Optional<POIsPerList>;
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
  railgunTxid: Optional<string>;
  poisPerList: Optional<POIsPerList>;
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

type TXOsReceivedPOIStatusInfoShared = {
  tree: number;
  position: number;
  txid: string;
  commitment: string;
  blindedCommitment: string;
  poisPerList: Optional<POIsPerList>;
};

export type TXOsReceivedPOIStatusInfo = {
  strings: TXOsReceivedPOIStatusInfoShared;
  emojis: TXOsReceivedPOIStatusInfoShared;
};

export type TXOsSpentPOIStatusInfoShared = {
  blockNumber: number;
  txid: string;
  railgunTxid: string;
  railgunTransactionInfo: string;
  sentCommitmentsBlinded: string;
  poiStatusesSentCommitments: Optional<POIsPerList>[];
  unshieldEventsBlinded: string;
  poiStatusesUnshieldEvents: Optional<POIsPerList>[];
  listKeysCanGenerateSpentPOIs: string[];
};

export type TXOsSpentPOIStatusInfo = {
  strings: TXOsSpentPOIStatusInfoShared;
  emojis: TXOsSpentPOIStatusInfoShared;
};
