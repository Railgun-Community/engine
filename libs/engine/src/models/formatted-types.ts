import BN from 'bn.js';

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

export type CTRCiphertext = {
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
  ShieldCommitment = 'ShieldCommitment',
  TransactCommitment = 'TransactCommitment',
  LegacyEncryptedCommitment = 'LegacyEncryptedCommitment',
  LegacyGeneratedCommitment = 'LegacyGeneratedCommitment',
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

export type EncryptedNoteAnnotationData = string;

// !! DO NOT MODIFY THIS TYPE - IT IS STORED IN DB WITH THESE EXACT KEYS !!
export type NoteSerialized = {
  npk: string;
  value: string;
  token: string;
  random: string;
  annotationData: string;
  recipientAddress: string;
  senderAddress: Optional<string>;
  memoText: Optional<string>;
  shieldFee: Optional<string>;
};

// !! DO NOT MODIFY THIS TYPE - IT IS STORED IN DB WITH THESE EXACT KEYS !!
export type LegacyNoteSerialized = {
  npk: string;
  value: string;
  token: string;
  encryptedRandom: [string, string];
  memoField: string[];
  recipientAddress: string;
  memoText: Optional<string>;
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

export type CommitmentCiphertext = {
  ciphertext: Ciphertext;
  blindedSenderViewingKey: string;
  blindedReceiverViewingKey: string;
  annotationData: string;
  memo: string;
};

export type ShieldCommitment = {
  commitmentType: CommitmentType.ShieldCommitment;
  hash: string;
  txid: string;
  preImage: PreImage;
  encryptedBundle: [string, string, string];
  shieldKey: string;
  blockNumber: number;
  fee: Optional<string>;
};

export type TransactCommitment = {
  commitmentType: CommitmentType.TransactCommitment;
  hash: string;
  txid: string;
  ciphertext: CommitmentCiphertext;
  blockNumber: number;
};

export type Commitment =
  | ShieldCommitment
  | TransactCommitment
  | LegacyGeneratedCommitment
  | LegacyEncryptedCommitment;

export type Nullifier = {
  nullifier: string;
  treeNumber: number;
  txid: string;
  blockNumber: number;
};

// !! DO NOT MODIFY THIS TYPE - IT IS STORED IN DB WITH THESE EXACT KEYS !!
export type StoredReceiveCommitment = {
  spendtxid: string | false;
  txid: string;
  nullifier: string;
  decrypted: NoteSerialized | LegacyNoteSerialized;
  senderAddress: Optional<string>;
};

// !! DO NOT MODIFY THIS TYPE - IT IS STORED IN DB WITH THESE EXACT KEYS !!
export type StoredSendCommitment = {
  txid: string;
  decrypted: NoteSerialized | LegacyNoteSerialized;
  noteExtraData?: NoteAnnotationData;
  recipientAddress: string;
};

/**
 * Legacy event types: Pre version 3.
 * Need to support these for legacy notes.
 */

export type LegacyGeneratedCommitment = {
  commitmentType: CommitmentType.LegacyGeneratedCommitment;
  hash: string;
  txid: string;
  preImage: PreImage;
  encryptedRandom: [string, string];
  blockNumber: number;
};

export type LegacyCommitmentCiphertext = {
  ciphertext: Ciphertext; // iv & tag (16 bytes each), recipient master public key (packedPoint) (uint256), packedField (uint256) {sign, random, amount}, token (uint256)
  ephemeralKeys: string[]; // receiver first, sender second (packed points 32 bytes each)
  memo: string[]; // bytes32[]
};

export type LegacyEncryptedCommitment = {
  commitmentType: CommitmentType.LegacyEncryptedCommitment;
  hash: string;
  txid: string;
  ciphertext: LegacyCommitmentCiphertext;
  blockNumber: number;
};
