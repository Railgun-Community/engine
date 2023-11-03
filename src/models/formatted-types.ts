import BN from 'bn.js';
import { POIsPerList, TXIDVersion } from './poi-types';

export type BytesData = ArrayLike<number> | string | BN;

export type AdaptID = {
  contract: string;
  parameters: string;
};

export type Ciphertext = {
  iv: string;
  tag: string;
  data: string[];
};

export type CiphertextIVData = {
  iv: string;
  data: string[];
};

export enum TokenType {
  ERC20 = 0,
  ERC721 = 1,
  ERC1155 = 2,
}

export type TransactionReceiptLog = {
  topics: string[];
  data: string;
};

export type TokenData = {
  tokenType: TokenType;
  tokenAddress: string;
  tokenSubID: string;
};

export type NFTTokenData = TokenData & {
  tokenType: TokenType.ERC721 | TokenType.ERC1155;
};

export type EncryptedData = [string, string];

export enum CommitmentType {
  // V1
  LegacyEncryptedCommitment = 'LegacyEncryptedCommitment',
  LegacyGeneratedCommitment = 'LegacyGeneratedCommitment',
  // V2
  ShieldCommitment = 'ShieldCommitment',
  TransactCommitmentV2 = 'TransactCommitmentV2',
  // V3
  TransactCommitmentV3 = 'TransactCommitmentV3',
}

export enum OutputType {
  Transfer = 0,
  RelayerFee = 1,
  Change = 2,
}

export type NoteAnnotationData = {
  outputType: OutputType; // Chunk 0: Byte 1 (1)
  senderRandom: string; // Chunk 0: Bytes 2-16 (15)
  walletSource: Optional<string>; // Chunk 1: Bytes 22-32 (11) - can be extended left if needed
};

export type SenderAnnotationDecrypted = {
  walletSource: Optional<string>; // Chunk 0: 16 bytes
  outputType: OutputType; // Chunk 1: 1 byte per transact commitment
};

export type EncryptedNoteAnnotationData = string;

// !! DO NOT MODIFY THIS TYPE - IT IS STORED IN DB WITH THESE EXACT KEYS !!
export type NoteSerialized = {
  npk: string;
  value: string;
  tokenHash: string;
  random: string;
  recipientAddress: string;
  outputType: Optional<OutputType>;
  senderRandom: Optional<string>;
  walletSource: Optional<string>;
  senderAddress: Optional<string>;
  memoText: Optional<string>;
  shieldFee: Optional<string>;
  blockNumber: Optional<number>;
};

// !! DO NOT MODIFY THIS TYPE - IT IS STORED IN DB WITH THESE EXACT KEYS !!
export type LegacyNoteSerialized = {
  npk: string;
  value: string;
  tokenHash: string;
  encryptedRandom: [string, string];
  memoField: string[];
  recipientAddress: string;
  memoText: Optional<string>;
  blockNumber: Optional<number>;
};

export type MerkleProof = {
  leaf: string; // hash of commitment
  elements: string[];
  indices: string;
  root: string;
};

export type PreImage = {
  npk: string;
  token: TokenData;
  value: string;
};

export type ShieldCiphertext = {
  encryptedBundle: [string, string, string];
  shieldKey: string;
};

export type CommitmentCiphertextV2 = {
  ciphertext: Ciphertext;
  blindedSenderViewingKey: string;
  blindedReceiverViewingKey: string;
  annotationData: string;
  memo: string;
};

export type CommitmentCiphertextV3 = {
  ciphertext: CiphertextIVData;
  blindedSenderViewingKey: string;
  blindedReceiverViewingKey: string;
};

type CommitmentShared = {
  commitmentType: CommitmentType;
  hash: string;
  txid: string;
  blockNumber: number;
  timestamp: Optional<number>;
  utxoTree: number;
  utxoIndex: number;
};

export type ShieldCommitment = CommitmentShared & {
  commitmentType: CommitmentType.ShieldCommitment;
  preImage: PreImage;
  encryptedBundle: [string, string, string];
  shieldKey: string;
  fee: Optional<string>;
};

export type TransactCommitmentV2 = CommitmentShared & {
  commitmentType: CommitmentType.TransactCommitmentV2;
  ciphertext: CommitmentCiphertextV2;
  railgunTxid: Optional<string>;
};

export type TransactCommitmentV3 = CommitmentShared & {
  commitmentType: CommitmentType.TransactCommitmentV3;
  ciphertext: CommitmentCiphertextV3;
  senderCiphertext: string;
  railgunTxid: Optional<string>;
  transactCommitmentBatchIndex: number;
};

export type UnshieldRailgunTransactionData = {
  tokenData: TokenData;
  toAddress: string;
  value: string;
};

export enum RailgunTransactionVersion {
  V2 = 'V2',
  V3 = 'V3',
}

// Comes from Graph
export type RailgunTransactionV2 = {
  version: RailgunTransactionVersion.V2;
  graphID: string;
  commitments: string[];
  nullifiers: string[];
  boundParamsHash: string;
  blockNumber: number;
  txid: string;
  unshield: Optional<UnshieldRailgunTransactionData>;
  utxoTreeIn: number;
  utxoTreeOut: number;
  utxoBatchStartPositionOut: number;
  timestamp: number;
  verificationHash: string;
};

// Comes from on-chain AccumulatorStateUpdate events
export type RailgunTransactionV3 = {
  version: RailgunTransactionVersion.V3;
  commitments: string[];
  nullifiers: string[];
  boundParamsHash: string;
  blockNumber: number;
  txid: string;
  unshield: Optional<UnshieldRailgunTransactionData>;
  utxoTreeIn: number;
  utxoTreeOut: number;
  utxoBatchStartPositionOut: number;
};

export type RailgunTransaction = RailgunTransactionV2 | RailgunTransactionV3;

export type RailgunTransactionWithHash = RailgunTransaction & {
  railgunTxid: string;
  hash: string;
};

export type TXIDMerkletreeData = {
  railgunTransaction: RailgunTransactionWithHash;
  currentMerkleProofForTree: MerkleProof;
  currentTxidIndexForTree: number;
};

export type Commitment =
  | ShieldCommitment // Shield V2 and V2.1
  | TransactCommitmentV2
  | TransactCommitmentV3
  | LegacyGeneratedCommitment // Shield V1
  | LegacyEncryptedCommitment; // Transact V1

export type Nullifier = {
  nullifier: string;
  treeNumber: number;
  txid: string;
  blockNumber: number;
};

// !! DO NOT MODIFY THIS TYPE - IT IS STORED IN DB WITH THESE EXACT KEYS !!
export type StoredReceiveCommitment = {
  txidVersion: TXIDVersion;
  spendtxid: string | false;
  txid: string;
  timestamp: Optional<number>;
  nullifier: string;
  blockNumber: number;
  decrypted: NoteSerialized | LegacyNoteSerialized;
  senderAddress: Optional<string>;
  commitmentType: CommitmentType;
  poisPerList: Optional<POIsPerList>;
  blindedCommitment: Optional<string>;
  transactCreationRailgunTxid: Optional<string>;
};

// !! DO NOT MODIFY THIS TYPE - IT IS STORED IN DB WITH THESE EXACT KEYS !!
export type StoredSendCommitment = {
  txidVersion: TXIDVersion;
  txid: string;
  timestamp: Optional<number>;
  decrypted: NoteSerialized | LegacyNoteSerialized;
  commitmentType: CommitmentType;
  outputType: Optional<OutputType>;
  walletSource: Optional<string>;
  recipientAddress: string;
  railgunTxid: Optional<string>;
  poisPerList: Optional<POIsPerList>;
  blindedCommitment: Optional<string>;
};

/**
 * Legacy event types: Pre version 3.
 * Need to support these for legacy notes.
 */

export type LegacyGeneratedCommitment = CommitmentShared & {
  commitmentType: CommitmentType.LegacyGeneratedCommitment;
  preImage: PreImage;
  encryptedRandom: [string, string];
};

export type LegacyCommitmentCiphertext = {
  ciphertext: Ciphertext; // iv & tag (16 bytes each), recipient master public key (packedPoint) (uint256), packedField (uint256) {sign, random, amount}, token (uint256)
  ephemeralKeys: string[]; // receiver first, sender second (packed points 32 bytes each)
  memo: string[]; // bytes32[]
};

export type LegacyEncryptedCommitment = CommitmentShared & {
  commitmentType: CommitmentType.LegacyEncryptedCommitment;
  ciphertext: LegacyCommitmentCiphertext;
  railgunTxid: Optional<string>;
};

export type CommitmentSummary = {
  commitmentCiphertext: CommitmentCiphertextV2 | CommitmentCiphertextV3;
  commitmentHash: string;
};

export type RelayAdaptShieldERC20Recipient = { tokenAddress: string; recipientAddress: string };

export type RelayAdaptShieldNFTRecipient = {
  nftTokenData: NFTTokenData;
  recipientAddress: string;
};

export type POICommitmentOutData = {
  blindedCommitmentsOut: string[];
  npksOut: bigint[];
  valuesOut: bigint[];
  poisPerList: Optional<POIsPerList>;
};
