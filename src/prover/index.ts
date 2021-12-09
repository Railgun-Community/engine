// @ts-ignore-next-line
import { groth16 } from 'snarkjs';

export type Artifacts = {
  zkey: ArrayLike<number>,
  wasm: ArrayLike<number>,
  vkey: object,
};

export type Proof = {
  // eslint-disable-next-line camelcase
  pi_a: string[];
  // eslint-disable-next-line camelcase
  pi_b: string[][];
  // eslint-disable-next-line camelcase
  pi_c: string[];
  protocol: string;
};

export type ERC20Inputs = {
  hashOfInputs: string;
  adaptID: string;
  tokenField: string;
  depositAmount: string;
  withdrawAmount: string;
  outputTokenField: string;
  outputEthAddress: string;
  randomIn: string[];
  valuesIn: string[];
  spendingKeys: string[];
  treeNumber: string;
  merkleRoot: string;
  nullifiers: string[];
  pathElements: string[];
  pathIndices: string[];
  recipientPK: string[];
  randomOut: string[];
  valuesOut: string[];
  commitmentsOut: string[];
  ciphertextHash: string;
};

export type CircuitInputs = ERC20Inputs; // | ERC721Inputs

export type ArtifactsGetter = () => Promise<Artifacts>;

class Prover {
  artifactsGetter: ArtifactsGetter;

  constructor(artifactsGetter: ArtifactsGetter) {
    this.artifactsGetter = artifactsGetter;
  }

  async verify(inputs: CircuitInputs, proof: Proof): Promise<boolean> {
    // Fetch artifacts
    const artifacts = await this.artifactsGetter();

    // Return output of groth16 verify
    return groth16.verify(artifacts.vkey, inputs, proof);
  }

  async prove(inputs: CircuitInputs): Promise<{proof: Proof, inputs: CircuitInputs}> {
    // Fetch artifacts
    const artifacts = await this.artifactsGetter();

    // Generate proof
    const proof: Proof = await groth16.fullProve(inputs, artifacts.wasm, artifacts.zkey);

    // Throw if proof is invalid
    if (await this.verify(inputs, proof)) throw new Error('Proof generation failed');

    // Return proof with inputs
    return {
      proof,
      inputs,
    };
  }
}

export { Prover };
