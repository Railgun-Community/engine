declare module 'circomlibjs' {
  namespace babyjubjub {
    export function unpackPoint(buff: Uint8Array): [bigint, bigint];
    export function packPoint(P: [bigint, bigint]): Uint8Array;
  }
  export function poseidon(inputs: bigint[]): bigint;
  namespace eddsa {
    export function signPoseidon(prv: bigint, msg: any): { R8: Uint8Array; S: bigint };
  }
}
