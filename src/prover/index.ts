// @ts-ignore-next-line
import { groth16 } from 'snarkjs';
import { bytes, hash, babyjubjub } from '../utils';

export type Artifacts = {
  zkey: ArrayLike<number>;
  wasm: ArrayLike<number>;
  vkey: object;
};

export type Proof = {
  a: bytes.BytesData[];
  b: bytes.BytesData[][];
  c: bytes.BytesData[];
};

export type ERC20Inputs = {
  type: 'erc20';
  adaptID: bytes.BytesData;
  tokenField: bytes.BytesData;
  depositAmount: bytes.BytesData;
  withdrawAmount: bytes.BytesData;
  outputTokenField: bytes.BytesData;
  outputEthAddress: bytes.BytesData;
  randomIn: bytes.BytesData[];
  valuesIn: bytes.BytesData[];
  spendingKeys: bytes.BytesData[];
  treeNumber: bytes.BytesData;
  merkleRoot: bytes.BytesData;
  nullifiers: bytes.BytesData[];
  pathElements: bytes.BytesData[];
  pathIndices: bytes.BytesData[];
  recipientPK: bytes.BytesData[];
  randomOut: bytes.BytesData[];
  valuesOut: bytes.BytesData[];
  commitmentsOut: bytes.BytesData[];
  ciphertextHash: bytes.BytesData;
};

export type CircuitInputs = ERC20Inputs; // | ERC721Inputs

export type FormattedCircuitInputs = {
  [key: string]: string | string[] | string[][];
}

export type ArtifactsGetter = () => Promise<Artifacts>;

class Prover {
  artifactsGetter: ArtifactsGetter;

  constructor(artifactsGetter: ArtifactsGetter) {
    this.artifactsGetter = artifactsGetter;
  }

  async verify(inputs: CircuitInputs, proof: Proof): Promise<boolean> {
    // Fetch artifacts
    const artifacts = await this.artifactsGetter();

    // Get formatted inputs
    const formattedInputs = Prover.formatInputs(inputs);

    // Return output of groth16 verify
    return groth16.verify(artifacts.vkey, formattedInputs, proof);
  }

  async prove(inputs: CircuitInputs): Promise<{proof: Proof, inputs: CircuitInputs}> {
    // Fetch artifacts
    const artifacts = await this.artifactsGetter();

    // Get formatted inputs
    const formattedInputs = Prover.formatInputs(inputs);

    // Generate proof
    const proof: Proof = await groth16.fullProve(formattedInputs, artifacts.wasm, artifacts.zkey);

    // Throw if proof is invalid
    if (await this.verify(inputs, proof)) throw new Error('Proof generation failed');

    // Return proof with inputs
    return {
      proof,
      inputs,
    };
  }

  static hashInputs(inputs: CircuitInputs): string {
    // if (inputs.type === 'erc20') {
    // Inputs type is ERC20, hash as ERC20 inputs
    const preimage = bytes.combine([
      inputs.adaptID,
      inputs.depositAmount,
      inputs.withdrawAmount,
      inputs.outputTokenField,
      inputs.outputEthAddress,
      inputs.treeNumber,
      inputs.merkleRoot,
      ...inputs.nullifiers,
      ...inputs.commitmentsOut,
      inputs.ciphertextHash,
    ].map((el) => bytes.padToLength(el, 32)));

    return hash.sha256(preimage);
    // }
  }

  static formatInputs(inputs: CircuitInputs): FormattedCircuitInputs {
    const hashOfInputs = Prover.hashInputs(inputs);

    // if (inputs.type === 'erc20') {
    // Inputs type is ERC20
    return {
      hashOfInputs: bytes.hexlify(hashOfInputs, true),
      adaptID: bytes.hexlify(inputs.adaptID, true),
      tokenField: bytes.hexlify(inputs.tokenField, true),
      depositAmount: bytes.hexlify(inputs.depositAmount, true),
      withdrawAmount: bytes.hexlify(inputs.withdrawAmount, true),
      outputTokenField: bytes.hexlify(inputs.outputTokenField, true),
      outputEthAddress: bytes.hexlify(inputs.outputEthAddress, true),
      randomIn: inputs.randomIn.map((el) => bytes.hexlify(el, true)),
      valuesIn: inputs.valuesIn.map((el) => bytes.hexlify(el, true)),
      spendingKeys: inputs.spendingKeys.map((el) => bytes.hexlify(el, true)),
      treeNumber: bytes.hexlify(inputs.treeNumber, true),
      merkleRoot: bytes.hexlify(inputs.merkleRoot, true),
      nullifiers: inputs.nullifiers.map((el) => bytes.hexlify(el, true)),
      pathElements: inputs.pathElements.map((el) => bytes.hexlify(el, true)),
      pathIndices: inputs.pathIndices.map((el) => bytes.hexlify(el, true)),
      recipientPK: inputs.recipientPK.map(
        (el) => babyjubjub.unpackPoint(el).map(
          (el2) => bytes.hexlify(el2, true),
        ),
      ),
      randomOut: inputs.randomOut.map((el) => bytes.hexlify(el, true)),
      valuesOut: inputs.valuesOut.map((el) => bytes.hexlify(el, true)),
      commitmentsOut: inputs.commitmentsOut.map((el) => bytes.hexlify(el, true)),
      ciphertextHash: bytes.hexlify(inputs.ciphertextHash, true),
    };
    // }
  }
}

export { Prover };
