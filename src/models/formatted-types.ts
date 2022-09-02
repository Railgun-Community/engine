import BN from 'bn.js';
import { BigNumberish } from 'ethers';
import { SnarkProof } from '../prover/types';

export type BytesData = ArrayLike<number> | string | BN;

export type BigIntish = string | number | bigint | boolean;

export type Hex = Uint8Array | string;

export type AdaptID = {
  contract: string;
  parameters: string;
};

export type Ciphertext = {
  iv: BytesData;
  tag: BytesData;
  data: BytesData[];
};

export type CTRCiphertext = {
  iv: string;
  data: string[];
};

export type OutputCommitmentCiphertext = {
  ciphertext: [BigNumberish, BigNumberish, BigNumberish, BigNumberish]; // uint256[4]
  ephemeralKeys: [BigNumberish, BigNumberish]; // uint256[2]
  memo: BigNumberish[]; // bytes32[]
};

export type BoundParams = {
  treeNumber: BigNumberish;
  withdraw: BigNumberish;
  adaptContract: string;
  adaptParams: string;
  commitmentCiphertext: OutputCommitmentCiphertext[];
};

export enum TokenType {
  ERC20 = '0x0000000000000000000000000000000000000000',
  ERC721 = '0x0000000000000000000000000000000000000001',
  ERC1155 = '0x0000000000000000000000000000000000000002',
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

export type EncryptedData = [string, string];

export enum OutputType {
  Transfer = 0,
  RelayerFee = 1,
  Change = 2,
}

export type NoteExtraData = {
  outputType: OutputType;
};

export type CommitmentPreimage = {
  npk: string;
  token: TokenData;
  value: BigNumberish;
};

export type SerializedTransaction = {
  proof: SnarkProof;
  merkleRoot: BigNumberish;
  nullifiers: BigNumberish[];
  commitments: BigNumberish[];
  boundParams: BoundParams;
  withdrawPreimage: CommitmentPreimage;
  overrideOutput: string;
};

export type NoteSerialized = {
  npk: string;
  value: string;
  token: string;
  encryptedRandom: [string, string];
  memoField: string[];
  recipientAddress: string;
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

export type DepositInput = {
  preImage: CommitmentPreimage;
  encryptedRandom: EncryptedData;
};

/**
 * Processed from transaction events
 */
export type GeneratedCommitment = {
  hash: string;
  txid: string;
  preImage: PreImage;
  encryptedRandom: [string, string];
};

export type CommitmentCiphertext = {
  ciphertext: Ciphertext; // iv & tag (16 bytes each), recipient master public key (packedPoint) (uint256), packedField (uint256) {sign, random, amount}, token (uint256)
  ephemeralKeys: string[]; // sender first, recipient second (packed points 32 bytes each)
  memo: string[]; // bytes32[]
};

/**
 * Processed from from transfer transactions with data encrypted to ciphertext
 */
export type EncryptedCommitment = {
  hash: string;
  txid: string;
  ciphertext: CommitmentCiphertext;
};

/**
 * Stored Commitments are either GeneratedCommitment or EncryptedCommitment
 */
export type Commitment = GeneratedCommitment | EncryptedCommitment;

export type Nullifier = {
  nullifier: string;
  treeNumber: number;
  txid: string;
  blockNumber: number;
};

export type StoredReceiveCommitment = {
  spendtxid: string | false;
  txid: string;
  nullifier: string;
  decrypted: NoteSerialized;
};

export type StoredSpendCommitment = {
  txid: string;
  decrypted: NoteSerialized;
  noteExtraData?: NoteExtraData;
  recipientAddress: string;
};
