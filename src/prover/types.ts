export type Artifacts = {
  zkey: ArrayLike<number>;
  wasm: ArrayLike<number> | undefined;
  dat: ArrayLike<number> | undefined;
  vkey: object;
};

export const enum Circuits {
  OneTwo,
  OneThree,
  TwoTwo,
  TwoThree,
  EightTwo,
}

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
  token: bigint;
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
  [key: string]: bigint | bigint[];
};

// eslint-disable-next-line no-unused-vars
// export type ArtifactsGetter = (Circuits) => Promise<Artifacts>;
export type ArtifactsGetter = (publicInputs: PublicInputs) => Promise<Artifacts>;
