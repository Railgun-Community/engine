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
  // Railgun TXID that created this TXO
  railgunTxid: Optional<string>;
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

export type TXOsReceivedPOIStatusInfo = {
  tree: number;
  startPosition: number;
  txid: string;
  txos: string;
  railgunTxid: string;
  blindedCommitments: string;
  poiStatuses: string;
};

export type TXOsSpentPOIStatusInfo = {
  blockNumber: number;
  txid: string;
  railgunTxid: string;
  railgunTransactionInfo: string;
  sentCommitmentsBlinded: string;
  poiStatusesSentCommitments: string;
  unshieldEventsBlinded: string;
  poiStatusesUnshieldEvents: string;
};
