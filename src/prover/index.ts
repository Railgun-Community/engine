import { ByteLength, nToHex } from '../utils/bytes';
import {
  ArtifactsGetter,
  FormattedCircuitInputs,
  PrivateInputs,
  Proof,
  PublicInputs,
  SnarkProof,
} from './types';

export type Groth16 = {
  verify: (vkey: object, publicSignals: bigint[], proof: Proof) => Promise<boolean>;
  fullProve: (
    formattedInputs: FormattedCircuitInputs,
    wasm: ArrayLike<number> | undefined,
    dat: ArrayLike<number> | undefined,
    zkey: ArrayLike<number>,
  ) => Promise<{ proof: Proof }>;
};

export { ArtifactsGetter, FormattedCircuitInputs, PrivateInputs, Proof, PublicInputs, SnarkProof };

export class Prover {
  private artifactsGetter: ArtifactsGetter;

  private groth16: Groth16 | undefined;

  constructor(artifactsGetter: ArtifactsGetter) {
    this.artifactsGetter = artifactsGetter;
  }

  /**
   * Used to set implementation from snarkjs.min.js, snarkjs or Native Prover.
   */
  setGroth16(groth16Implementation: Groth16) {
    this.groth16 = groth16Implementation;
  }

  async verify(publicInputs: PublicInputs, proof: Proof): Promise<boolean> {
    if (!this.groth16) {
      throw new Error('Requires groth16 verification implementation');
    }

    // Fetch artifacts
    const artifacts = await this.artifactsGetter(publicInputs);
    // Return output of groth16 verify
    const publicSignals: bigint[] = [
      publicInputs.merkleRoot,
      publicInputs.boundParamsHash,
      ...publicInputs.nullifiers,
      ...publicInputs.commitmentsOut,
    ];
    return this.groth16.verify(artifacts.vkey, publicSignals, proof);
  }

  private static get zeroProof(): Proof {
    const zero = nToHex(BigInt(0), ByteLength.UINT_8);
    // prettier-ignore
    return {
      pi_a: [zero, zero],
      pi_b: [[zero, zero], [zero, zero]],
      pi_c: [zero, zero],
    };
  }

  async dummyProve(publicInputs: PublicInputs): Promise<Proof> {
    // Pull artifacts to make sure we have valid artifacts for this number of inputs.
    // Note that the artifacts are not used in the dummy proof.
    await this.artifactsGetter(publicInputs);
    return Prover.zeroProof;
  }

  async prove(
    publicInputs: PublicInputs,
    privateInputs: PrivateInputs,
  ): Promise<{ proof: Proof; publicInputs: PublicInputs }> {
    if (!this.groth16) {
      throw new Error('Requires groth16 full prover implementation');
    }

    // 1-2  1-3  2-2  2-3  8-2 [nullifiers, commitments]
    // Fetch artifacts
    const artifacts = await this.artifactsGetter(publicInputs);
    if (!artifacts.wasm && !artifacts.dat) {
      throw new Error('Requires WASM or DAT prover artifact');
    }

    // Get formatted inputs
    const formattedInputs = Prover.formatInputs(publicInputs, privateInputs);

    // Generate proof
    const { proof } = await this.groth16.fullProve(
      formattedInputs,
      artifacts.wasm,
      artifacts.dat,
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
