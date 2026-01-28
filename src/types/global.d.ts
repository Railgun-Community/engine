declare type Optional<T> = T | undefined;

declare module '@railgun-community/circomlibjs' {
  export type Signature = {
    R8: [bigint, bigint];
    S: bigint;
  };
  export namespace eddsa {
    export function verifyPoseidon(msg: bigint, sig: Signature, A: bigint[]): boolean;
    export function signPoseidon(prv: Uint8Array, msg: bigint): Signature;
    export function prv2pub(prv: Buffer): [bigint, bigint];
  }
  export namespace babyjub {
    export function packPoint(point: [bigint, bigint]): Buffer;
    export function unpackPoint(buffer: Buffer): [bigint, bigint];
  }
  export function poseidon(inputs: bigint[]): bigint;
}

declare type Artifact = {
  zkey: ArrayLike<number>;
  wasm: Optional<ArrayLike<number>>;
  dat: Optional<ArrayLike<number>>;
  vkey: object;
};

// declare module 'railgun-community-circuit-artifacts' {
//   type ArtifactListMetadata = {
//     nullifiers: number;
//     commitments: number;
//   }[];

//   export function getArtifact(nullifiers: number, commitments: number): Artifact;

//   export function getVKey(nullifiers: number, commitments: number): string;

//   export function listArtifacts(): ArtifactListMetadata;
// }

// declare module 'snarkjs';
// todo: figure out the best way to declare snarkjs(snarkjs declaration from prover is being overridden by engine or other packer declaration)
declare module 'snarkjs' {
  // Define types at the module level
  export interface SnarkjsProof {
    pi_a: [string, string];
    pi_b: [[string, string], [string, string]];
    pi_c: [string, string];
    protocol: 'groth16';
  }

  export type PublicSignals = string[];

  export interface SNARK {
    proof: SnarkjsProof;
    publicSignals: PublicSignals;
  }

  export interface VKey {
    protocol: 'groth16';
    curve: Curves;
    nPublic: number;
    vk_alpha_1: (string | bigint)[];
    vk_beta_2: (string | bigint)[][];
    vk_gamma_2: (string | bigint)[][];
    vk_delta_2: (string | bigint)[][];
    vk_alphabeta_12: (string | bigint)[][][];
    IC: (string | bigint)[][];
  }

  export interface CurveOptions {
    [key: string]: any;
  }

  export type Curves = 'bn128' | 'bls12381';

  export interface Curve {
    terminate: () => Promise<void>;
  }

  export namespace groth16 {
    function fullProve(
      inputs: unknown,
      wasm: Uint8Array | string,
      zkey: Uint8Array | string,
      logger?: unknown,
      wtnsCalcOptions?: any,
      proverOptions?: { singleThread?: boolean },
    ): Promise<SNARK>;

    function verify(
      vkVerifier: VKey,
      publicSignals: unknown,
      proof: SnarkjsProof,
      logger?: unknown,
    ): Promise<boolean>;
  }

  export namespace curves {
    function getCurveFromName(name: string, options?: CurveOptions): Promise<Curve>;
  }
}

declare module 'hash-emoji';
