declare module 'circomlibjs' {
  export type Signature = {
    R8: [bigint, bigint];
    S: bigint;
  };
  namespace eddsa {
    export function verifyPoseidon(msg: bigint, sig: Signature, A: bigint[]): boolean;
    export function signPoseidon(prv: Uint8Array, msg: bigint): Signature;
    export function prv2pub(prv: Uint8Array): [bigint, bigint];
  }
  export function poseidon(inputs: bigint[] | string[]): bigint;
}
