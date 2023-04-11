import { BigNumberish } from 'ethers';

export const enum Circuits {
  OneTwo,
  OneThree,
  TwoTwo,
  TwoThree,
  EightTwo,
}

export type G1Point = {
  x: BigNumberish;
  y: BigNumberish;
};
export type G2Point = {
  x: [BigNumberish, BigNumberish];
  y: [BigNumberish, BigNumberish];
};

export type SnarkProof = {
  a: G1Point;
  b: G2Point;
  c: G1Point;
};

export type Proof = {
  pi_a: string[];
  pi_b: string[][];
  pi_c: string[];
};

export type PublicInputs = {
  merkleRoot: bigint;
  boundParamsHash: bigint;
  nullifiers: bigint[];
  commitmentsOut: bigint[];
};

export type PrivateInputs = {
  tokenAddress: bigint;
  publicKey: [bigint, bigint];
  signature: [bigint, bigint, bigint];
  randomIn: bigint[];
  valueIn: bigint[];
  pathElements: bigint[][];
  leavesIndices: bigint[];
  nullifyingKey: bigint;
  npkOut: bigint[];
  valueOut: bigint[];
};

export type FormattedCircuitInputs = {
  merkleRoot: bigint;
  boundParamsHash: bigint;
  nullifiers: bigint[];
  commitmentsOut: bigint[];
  token: bigint;
  publicKey: bigint[];
  signature: bigint[];
  randomIn: bigint[];
  valueIn: bigint[];
  pathElements: bigint[];
  leavesIndices: bigint[];
  nullifyingKey: bigint;
  npkOut: bigint[];
  valueOut: bigint[];
};

export type ArtifactGetter = {
  assertArtifactExists: (nullifiers: number, commitments: number) => void;
  getArtifacts: (publicInputs: PublicInputs) => Promise<Artifact>;
};
