// @ts-ignore-next-line
import { groth16 } from 'snarkjs';

export type Artifacts = {
  zkey: ArrayLike<number>;
  wasm: ArrayLike<number>;
  vkey: object;
};

export const enum Circuits {
  OneTwo,
  OneThree,
  TwoTwo,
  TwoThree,
  EightTwo,
}

export type Proof = {
  a: string[];
  b: string[][];
  c: string[];
};

export type PublicInputs = {
  merkleRoot: bigint;
  boundParamsHash: bigint;
  nullifiers: bigint[];
  commitmentsOut: bigint[];
};

export type PrivateInputs = {
  token: bigint;
  publicKey: [bigint, bigint]; // babyjubjub pubkey unpacked
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
class Prover {
  private artifactsGetter: ArtifactsGetter;

  private groth16Override: any;

  constructor(artifactsGetter: ArtifactsGetter) {
    this.artifactsGetter = artifactsGetter;
  }

  /**
   * Used in browser to override with implementation from snarkjs.min.js.
   */
  overrideGroth16(groth16Override: any) {
    this.groth16Override = groth16Override;
  }

  private getGroth16Impl() {
    return this.groth16Override ?? groth16;
  }

  async verify(publicInputs: PublicInputs, proof: Proof): Promise<boolean> {
    // Fetch artifacts
    const artifacts = await this.artifactsGetter(publicInputs);
    // Return output of groth16 verify
    const publicSignals = [
      publicInputs.merkleRoot,
      publicInputs.boundParamsHash,
      ...publicInputs.nullifiers,
      ...publicInputs.commitmentsOut,
    ];
    return this.getGroth16Impl().verify(artifacts.vkey, publicSignals, proof);
  }

  async prove(
    publicInputs: PublicInputs,
    privateInputs: PrivateInputs,
  ): Promise<{ proof: Proof; publicInputs: PublicInputs }> {
    // 1-2  1-3  2-2  2-3  8-2 [nullifiers, commitments]
    // Fetch artifacts
    const artifacts = await this.artifactsGetter(publicInputs);

    // Get formatted inputs
    const formattedInputs = Prover.formatInputs(publicInputs, privateInputs);

    // Generate proof
    const { proof } = await this.getGroth16Impl().fullProve(
      formattedInputs,
      artifacts.wasm,
      artifacts.zkey,
    );

    // Throw if proof is invalid
    if (!(await this.verify(publicInputs, proof))) throw new Error('Proof generation failed');

    // Return proof with inputs
    return {
      proof,
      publicInputs,
    };
  }

  static formatInputs(
    publicInputs: PublicInputs,
    privateInputs: PrivateInputs,
  ): FormattedCircuitInputs {
    return {
      merkleRoot: publicInputs.merkleRoot,
      boundParamsHash: publicInputs.boundParamsHash,
      nullifiers: publicInputs.nullifiers,
      commitmentsOut: publicInputs.commitmentsOut,
      token: privateInputs.token,
      publicKey: privateInputs.publicKey,
      signature: privateInputs.signature,
      randomIn: privateInputs.randomIn,
      valueIn: privateInputs.valueIn,
      pathElements: privateInputs.pathElements.flat(2),
      leavesIndices: privateInputs.leavesIndices,
      nullifyingKey: privateInputs.nullifyingKey,
      npkOut: privateInputs.npkOut,
      valueOut: privateInputs.valueOut,
    };
  }
}

export { Prover };
