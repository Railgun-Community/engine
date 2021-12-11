// @ts-ignore-next-line
import { groth16 } from 'snarkjs';
import {
  bytes,
  hash,
  babyjubjub,
  constants,
} from '../utils';

export type Artifacts = {
  zkey: ArrayLike<number>;
  wasm: ArrayLike<number>;
  vkey: object;
};

export type Circuits = 'erc20small' | 'erc20large';

export type Proof = {
  a: bytes.BytesData[];
  b: bytes.BytesData[][];
  c: bytes.BytesData[];
};

export type ERC20PrivateInputs = {
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
  pathElements: bytes.BytesData[][];
  pathIndices: bytes.BytesData[];
  recipientPK: bytes.BytesData[];
  randomOut: bytes.BytesData[];
  valuesOut: bytes.BytesData[];
  commitmentsOut: bytes.BytesData[];
  ciphertextHash: bytes.BytesData;
};

export type ERC20PublicInputs = {
  type: 'erc20';
  adaptID: bytes.BytesData;
  depositAmount: bytes.BytesData;
  withdrawAmount: bytes.BytesData;
  outputTokenField: bytes.BytesData;
  outputEthAddress: bytes.BytesData;
  treeNumber: bytes.BytesData;
  merkleRoot: bytes.BytesData;
  nullifiers: bytes.BytesData[];
  commitmentsOut: bytes.BytesData[];
  ciphertextHash: bytes.BytesData;
};

export type PrivateInputs = ERC20PrivateInputs; // | ERC721PrivateInputs
export type PublicInputs = ERC20PublicInputs; // | ERC721PublicInputs

export type FormattedCircuitInputs = {
  [key: string]: string | string[] | string[][];
}

// eslint-disable-next-line no-unused-vars
export type ArtifactsGetter = (circuit: Circuits) => Promise<Artifacts>;

class Prover {
  artifactsGetter: ArtifactsGetter;

  constructor(artifactsGetter: ArtifactsGetter) {
    this.artifactsGetter = artifactsGetter;
  }

  async verify(circuit: Circuits, inputs: PublicInputs, proof: Proof): Promise<boolean> {
    // Fetch artifacts
    const artifacts = await this.artifactsGetter(circuit);

    // Get inputs hash
    const hashOfInputs = Prover.hashInputs(inputs);

    // Return output of groth16 verify
    return groth16.verify(artifacts.vkey, [hashOfInputs], proof);
  }

  async prove(
    circuit: Circuits,
    inputs: PrivateInputs,
  ): Promise<{proof: Proof, inputs: PublicInputs}> {
    // Fetch artifacts
    const artifacts = await this.artifactsGetter(circuit);

    // Get formatted inputs
    const formattedInputs = Prover.formatPrivateInputs(inputs);

    // Get public inputs
    const publicInputs = Prover.privateToPublicInputs(inputs);

    // Generate proof
    const { proof } = await groth16.fullProve(formattedInputs, artifacts.wasm, artifacts.zkey);

    // Throw if proof is invalid
    if (!(await this.verify(circuit, publicInputs, proof))) throw new Error('Proof generation failed');

    // Return proof with inputs
    return {
      proof,
      inputs: publicInputs,
    };
  }

  static hashInputs(inputs: PublicInputs): string {
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

    return bytes.hexlify(
      bytes.numberify(
        hash.sha256(preimage),
      ).mod(constants.SNARK_PRIME),
    );
    // }
  }

  static privateToPublicInputs(inputs: PrivateInputs): PublicInputs {
    // if (inputs.type === 'erc20') {
    // Inputs type is ERC20
    return {
      type: inputs.type,
      adaptID: inputs.adaptID,
      depositAmount: inputs.depositAmount,
      withdrawAmount: inputs.withdrawAmount,
      outputTokenField: inputs.outputTokenField,
      outputEthAddress: inputs.outputEthAddress,
      treeNumber: inputs.treeNumber,
      merkleRoot: inputs.merkleRoot,
      nullifiers: inputs.nullifiers,
      commitmentsOut: inputs.commitmentsOut,
      ciphertextHash: inputs.ciphertextHash,
    };
    // }
  }

  static formatPrivateInputs(inputs: PrivateInputs): FormattedCircuitInputs {
    const publicInputs = Prover.privateToPublicInputs(inputs);
    const hashOfInputs = Prover.hashInputs(publicInputs);

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
      pathElements: inputs.pathElements.map((el) => el.map((el2) => bytes.hexlify(el2, true))),
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
