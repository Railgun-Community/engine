import BN from 'bn.js';
import { SnarkProof } from '../prover/types';

export type BytesData = ArrayLike<number> | string | BN;

export type BigIntish = string | number | bigint | boolean;

export type Hex = Uint8Array | string;

export type AdaptID = {
  contract: string;
  parameters: string;
};

export interface Ciphertext {
  iv: BytesData;
  tag: BytesData;
  data: BytesData[];
}

export type OutputCommitmentCiphertext = {
  ciphertext: bigint[]; // uint256[4]
  ephemeralKeys: bigint[]; // uint256[2]
  memo: bigint[]; // bytes32[]
};

export type BoundParams = {
  treeNumber: bigint;
  withdraw: bigint;
  adaptContract: string;
  adaptParams: string;
  commitmentCiphertext: OutputCommitmentCiphertext[];
};

export enum TokenType {
  ERC20 = '0x0000000000000000000000000000000000000000',
  ERC721 = '0x0000000000000000000000000000000000000001',
  ERC1155 = '0x0000000000000000000000000000000000000002',
}

export type TokenData = {
  tokenType: TokenType;
  tokenAddress: string;
  tokenSubID: string;
};

export type EncryptedData = [string, string];

export type CommitmentPreimage = {
  npk: string;
  token: TokenData;
  value: bigint;
};

export type SerializedTransaction = {
  proof: SnarkProof;
  merkleRoot: bigint;
  nullifiers: bigint[];
  commitments: bigint[];
  boundParams: BoundParams;
  withdrawPreimage: CommitmentPreimage;
  overrideOutput: string;
};

export type NoteSerialized = {
  npk: string;
  value: string;
  token: string;
  encryptedRandom: [string, string];
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
  memo: string; // bytes32[]
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
};
