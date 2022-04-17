import { Proof } from '../prover';

export type AdaptID = {
  contract: string;
  parameters: bigint;
};

export type BoundParams = {
  treeNumber: bigint;
  withdraw: bigint;
  adaptContract: string;
  adaptParams: any;
  commitmentCiphertext: any[];
};

export type TokenData = {
  tokenType: string;
  tokenAddress: string;
  tokenSubID: string;
};

export type EncryptedRandom = string[];

export type CommitmentPreimage = {
  npk: string;
  token: TokenData;
  value: string;
  encryptedRandom: EncryptedRandom;
};

export type SerializedTransaction = {
  proof: Proof;
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
