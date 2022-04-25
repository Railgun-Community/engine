import { Proof } from '../prover';
import { formatToByteLength } from '../utils/bytes';

export const HashZero = formatToByteLength('00', 32, true);
export type AdaptID = {
  contract: string;
  parameters: string;
};

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
