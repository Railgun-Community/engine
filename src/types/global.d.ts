declare type Optional<T> = T | undefined;

declare module 'circomlibjs' {
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

declare module 'snarkjs';
