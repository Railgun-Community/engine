import EngineDebug from '../debugger';
import { ByteLength, nToHex } from '../utils/bytes';
import {
  ArtifactsGetter,
  FormattedCircuitInputs,
  PrivateInputs,
  Proof,
  PublicInputs,
  SnarkProof,
} from './types';

type NativeProverFormattedJsonInputs = {
  merkleRoot: string;
  boundParamsHash: string;
  nullifiers: string[];
  commitmentsOut: string[];
  token: string;
  publicKey: string[];
  signature: string[];
  randomIn: string[];
  valueIn: string[];
  pathElements: string[];
  leavesIndices: string[];
  nullifyingKey: string;
  npkOut: string[];
  valueOut: string[];
};

type NativeProve = (
  circuitId: number,
  datBuffer: Buffer,
  zkeyBuffer: Buffer,
  inputJson: NativeProverFormattedJsonInputs,
  progressCallback: ProverProgressCallback,
) => Proof;

type Groth16FullProve = (
  formattedInputs: FormattedCircuitInputs,
  wasm: Optional<ArrayLike<number>>,
  zkey: ArrayLike<number>,
  logger: { debug: (log: string) => void },
  dat: Optional<ArrayLike<number>>,
  progressCallback: ProverProgressCallback,
) => Promise<{ proof: Proof }>;

export type Groth16 = {
  fullProve: Groth16FullProve;
  verify: Optional<(vkey: object, publicSignals: bigint[], proof: Proof) => Promise<boolean>>;
};

export type ProverProgressCallback = (progress: number) => void;

export { ArtifactsGetter, FormattedCircuitInputs, PrivateInputs, Proof, PublicInputs, SnarkProof };

export class Prover {
  private artifactsGetter: ArtifactsGetter;

  private groth16: Optional<Groth16>;

  constructor(artifactsGetter: ArtifactsGetter) {
    this.artifactsGetter = artifactsGetter;
  }

  /**
   * Used to set Groth16 implementation from snarkjs.min.js or snarkjs.
   */
  setSnarkJSGroth16(snarkJSGroth16: Groth16) {
    this.groth16 = {
      fullProve: snarkJSGroth16.fullProve,
      verify: snarkJSGroth16.verify,
    };
  }

  /**
   * Used to set Groth16 implementation from RAILGUN Native Prover.
   */
  setNativeProverGroth16(nativeProve: NativeProve, circuits: { [name: string]: number }) {
    const circuitIdForInputsOutputs = (inputs: number, outputs: number): number => {
      const circuitString = `${inputs}X${outputs}`;
      const circuitName = `JOINSPLIT_${circuitString}`;
      const circuitId = circuits[circuitName];
      if (circuitId == null) {
        throw new Error(`No circuit found for ${circuitString.toLowerCase()}`);
      }
      return circuitId;
    };

    /**
     * JSON.stringify does not handle bigint values out-of-the-box.
     * This handler will safely stringify bigints into decimal strings.
     */
    const stringifySafe = (obj: object) => {
      return JSON.stringify(obj, (_key, value) =>
        typeof value === 'bigint' ? value.toString(10) : value,
      );
    };

    const fullProve = async (
      formattedInputs: FormattedCircuitInputs,
      _wasm: ArrayLike<number> | undefined,
      zkey: ArrayLike<number>,
      logger: { debug: (log: string) => void },
      dat: ArrayLike<number> | undefined,
      progressCallback: ProverProgressCallback,
    ): Promise<{
      proof: Proof;
    }> => {
      try {
        if (!dat) {
          throw new Error('DAT artifact is required.');
        }
        const inputs = formattedInputs.nullifiers.length;
        const outputs = formattedInputs.commitmentsOut.length;
        const circuitId = circuitIdForInputsOutputs(inputs, outputs);

        const stringInputs = stringifySafe(formattedInputs);
        logger.debug(stringInputs);

        const jsonInputs = JSON.parse(stringInputs) as NativeProverFormattedJsonInputs;

        const datBuffer = dat as Buffer;
        const zkeyBuffer = zkey as Buffer;

        const start = Date.now();

        const proof: Proof = nativeProve(
          circuitId,
          datBuffer,
          zkeyBuffer,
          jsonInputs,
          progressCallback,
        );

        logger.debug(`Proof lapsed ${Date.now() - start} ms`);

        return { proof };
      } catch (err) {
        if (!(err instanceof Error)) {
          throw err;
        }
        logger.debug(err.message);
        throw new Error(`Unable to generate proof: ${err.message}`);
      }
    };

    this.groth16 = {
      fullProve,

      // Proof will be verified during gas estimate, and on-chain.
      verify: undefined,
    };
  }

  private async maybeVerify(publicInputs: PublicInputs, proof: Proof): Promise<boolean> {
    if (!this.groth16) {
      throw new Error('Requires groth16 verification implementation');
    }
    if (!this.groth16.verify) {
      // Wallet-side verification is a fail-safe.
      // Snark verification will occur during gas estimate (and on-chain) regardless.
      return true;
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
    progressCallback: ProverProgressCallback,
  ): Promise<{ proof: Proof; publicInputs: PublicInputs }> {
    if (!this.groth16) {
      throw new Error('Requires groth16 full prover implementation');
    }

    // 1-2  1-3  2-2  2-3  8-2 [nullifiers, commitments]
    // Fetch artifacts
    progressCallback(5);
    const artifacts = await this.artifactsGetter(publicInputs);
    if (!artifacts.wasm && !artifacts.dat) {
      throw new Error('Requires WASM or DAT prover artifact');
    }

    // Get formatted inputs
    const formattedInputs = Prover.formatInputs(publicInputs, privateInputs);

    // Generate proof: Progress from 20 - 99%
    const initialProgressProof = 20;
    const finalProgressProof = 99;
    progressCallback(initialProgressProof);
    const { proof } = await this.groth16.fullProve(
      formattedInputs,
      artifacts.wasm,
      artifacts.zkey,
      { debug: EngineDebug.log },
      artifacts.dat,
      (progress: number) => {
        progressCallback(
          (progress * (finalProgressProof - initialProgressProof)) / 100 + initialProgressProof,
        );
      },
    );
    progressCallback(finalProgressProof);

    // Throw if proof is invalid
    if (!(await this.maybeVerify(publicInputs, proof))) {
      throw new Error('Proof generation failed');
    }
    progressCallback(100);

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
      token: privateInputs.tokenAddress,
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
