declare module 'circomlibjs' {
  /*
  namespace babyjubjub {
    export function unpackPoint(buff: Uint8Array): [bigint, bigint];
    export function packPoint(P: [bigint, bigint]): Uint8Array;
  }
  namespace eddsa {
    export function signPoseidon(prv: any, msg: any): { R8: Uint8Array; S: bigint };
  }
  */
  export function poseidon(inputs: bigint[]): bigint;
}
