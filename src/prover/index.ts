// @ts-ignore-next-line
import { groth16 } from "snarkjs";
import { bytes } from "../utils";

export type Artifacts = {
  zkey: ArrayLike<number>;
  wasm: ArrayLike<number>;
  vkey: object;
};

const enum Circuits {
  OneTwo,
  OneThree,
  TwoTwo,
  TwoThree,
  EightTwo
}

export type Proof = {
  a: string[];
  b: string[][];
  c: string[];
};

export type PublicInputs = {
  merkleRoot: bytes.BytesData;
  boundParamsHash: bytes.BytesData;
  nullifiers: bytes.BytesData[];
  commitmentsOut: bytes.BytesData[];
};

export type PrivateInputs = {
  token: bytes.BytesData;
  publicKey: [bytes.BytesData, bytes.BytesData]; // Unpacked public key
  signature: [bytes.BytesData, bytes.BytesData, bytes.BytesData]; // R[0], R[1], S
  randomIn: bytes.BytesData[];
  valueIn: bytes.BytesData[];
  pathElements: bytes.BytesData[][];
  leavesIndices: bytes.BytesData[];
  nullifyingKey: bytes.BytesData;
  npkOut: bytes.BytesData[];
  valueOut: bytes.BytesData[];
};

export type FormattedCircuitInputs = {
  [key: string]: string | string[];
};

// eslint-disable-next-line no-unused-vars
export type ArtifactsGetter = (circuit: Circuits) => Promise<Artifacts>;

class Prover {
  artifactsGetter: ArtifactsGetter;

  constructor(artifactsGetter: ArtifactsGetter) {
    this.artifactsGetter = artifactsGetter;
  }

  async verify(
    circuit: Circuits,
    inputs: PublicInputs,
    proof: Proof
  ): Promise<boolean> {
    // Fetch artifacts
    const artifacts = await this.artifactsGetter(circuit);
    // Return output of groth16 verify
    return groth16.verify(artifacts.vkey, inputs, proof);
  }

  async prove(
    circuit: Circuits,
    publicInputs: PublicInputs,
    privateInputs: PrivateInputs
  ): Promise<{ proof: Proof; inputs: PublicInputs }> {
    // Fetch artifacts
    const artifacts = await this.artifactsGetter(circuit);

    // Get formatted inputs
    const formattedInputs = Prover.formatInputs(publicInputs, privateInputs);

    // Generate proof
    const { proof } = await groth16.fullProve(
      formattedInputs,
      artifacts.wasm,
      artifacts.zkey
    );

    // Format proof
    const proofFormatted = {
      a: [bytes.hexlify(proof.pi_a[0], true), bytes.hexlify(proof.pi_a[1], true)],
      b: [
        [bytes.hexlify(proof.pi_b[0][1], true), bytes.hexlify(proof.pi_b[0][0], true)],
        [bytes.hexlify(proof.pi_b[1][1], true), bytes.hexlify(proof.pi_b[1][0], true)]
      ],
      c: [bytes.hexlify(proof.pi_c[0], true), bytes.hexlify(proof.pi_c[1], true)]
    };

    // Throw if proof is invalid
    if (!(await this.verify(circuit, publicInputs, proofFormatted)))
      throw new Error("Proof generation failed");

    // Return proof with inputs
    return {
      proof: proofFormatted,
      inputs: publicInputs
    };
  }

  static formatInputs(
    publicInputs: PublicInputs,
    privateInputs: PrivateInputs
  ): FormattedCircuitInputs {
    return {
      merkleRoot: bytes.hexlify(publicInputs.merkleRoot, true),
      boundParamsHash: bytes.hexlify(publicInputs.boundParamsHash, true),
      nullifiers: publicInputs.nullifiers.map((el) => bytes.hexlify(el, true)),
      commitmentsOut: publicInputs.commitmentsOut.map((el) =>
        bytes.hexlify(el, true)
      ),
      token: bytes.hexlify(privateInputs.token, true),
      publicKey: privateInputs.publicKey.map((el) => bytes.hexlify(el, true)),
      signature: privateInputs.signature.map((el) => bytes.hexlify(el, true)),
      randomIn: privateInputs.randomIn.map((el) => bytes.hexlify(el, true)),
      valueIn: privateInputs.valueIn.map((el) => bytes.hexlify(el, true)),
      pathElements: privateInputs.pathElements
        .flat(2)
        .map((el) => bytes.hexlify(el, true)),
      leavesIndices: privateInputs.leavesIndices.map((el) =>
        bytes.hexlify(el, true)
      ),
      nullifyingKey: bytes.hexlify(privateInputs.nullifyingKey, true),
      npkOut: privateInputs.npkOut.map((el) => bytes.hexlify(el, true)),
      valueOut: privateInputs.valueOut.map((el) => bytes.hexlify(el, true))
    };
  }
}

export { Prover };
