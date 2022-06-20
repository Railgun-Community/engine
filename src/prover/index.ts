/* eslint-disable camelcase */
// @ts-ignore-next-line
import { groth16 } from 'snarkjs';
import {
  ArtifactsGetter,
  FormattedCircuitInputs,
  PrivateInputs,
  Proof,
  PublicInputs,
  SnarkProof,
} from './types';

export { ArtifactsGetter, FormattedCircuitInputs, PrivateInputs, Proof, PublicInputs, SnarkProof };

export class Prover {
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
    return this.groth16Override || groth16;
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
    const verified = await this.verify(publicInputs, proof);
    if (verified !== true) throw new Error('Proof generation failed');

    // Return proof with inputs
    return {
      proof,
      publicInputs,
    };
  }

  static formatProof(proof: Proof): SnarkProof {
    return {
      a: {
        x: BigInt(proof.pi_a[0]),
        y: BigInt(proof.pi_a[1]),
      },
      b: {
        x: [BigInt(proof.pi_b[0][1]), BigInt(proof.pi_b[0][0])],
        y: [BigInt(proof.pi_b[1][1]), BigInt(proof.pi_b[1][0])],
      },
      c: {
        x: BigInt(proof.pi_c[0]),
        y: BigInt(proof.pi_c[1]),
      },
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
