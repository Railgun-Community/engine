import BN from 'bn.js';

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

export type CommitmentCiphertext = {
  ciphertext: bigint[]; // uint256[4]
  ephemeralKeys: bigint[]; // uint256[2]
  memo: bigint[]; // bytes32[]
};

export type BoundParams = {
  treeNumber: bigint;
  withdraw: bigint;
  adaptContract: string;
  adaptParams: string;
  commitmentCiphertext: CommitmentCiphertext[];
};

export type TokenData = {
  tokenType: string;
  tokenAddress: string;
  tokenSubID: string;
};

export type EncryptedRandom = [string, string];

export type CommitmentPreimage = {
  npk: string;
  token: TokenData;
  value: bigint;
};

export type G1Point = {
  x: bigint;
  y: bigint;
};
export type G2Point = {
  x: bigint[];
  y: bigint[];
};

export type SnarkProof = {
  a: G1Point;
  b: G2Point;
  c: G1Point;
};

export type SerializedTransaction = {
  proof: SnarkProof;
  merkleRoot: bigint;
  nullifiers: bigint[];
  commitments: bigint[];
  boundParams: BoundParams;
  withdrawPreimage?: CommitmentPreimage;
  overrideOutput: string;
};

export type NoteSerialized = {
  npk: string;
  value: string;
  token: string;
  encryptedRandom: string[];
};
