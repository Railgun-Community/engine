declare module 'circomlibjs' {
  /*
  namespace babyjubjub {
    export function unpackPoint(buff: Uint8Array): [bigint, bigint];
    export function packPoint(P: [bigint, bigint]): Uint8Array;
  }
  */
  namespace eddsa {
    export function verifyPoseidon(
      msg: bigint,
      sig: { R8: bigint[]; S: bigint },
      A: bigint[],
    ): boolean;
    export function signPoseidon(prv: any, msg: bigint): { R8: [bigint, bigint]; S: bigint };
    export function prv2pub(prv: string): [bigint, bigint];
  }
  export function poseidon(inputs: bigint[]): bigint;
}
