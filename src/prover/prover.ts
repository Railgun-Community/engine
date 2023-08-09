import EngineDebug from '../debugger/debugger';
import { ByteLength, nToHex } from '../utils/bytes';
import {
  ArtifactGetter,
  FormattedCircuitInputs,
  UnprovedTransactionInputs,
  Proof,
  PublicInputs,
  SnarkProof,
} from '../models/prover-types';
import { stringifySafe } from '../utils/stringify';
import { ProofCache } from './proof-cache';

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

export class Prover {
  private artifactGetter: ArtifactGetter;

  private groth16: Optional<Groth16>;

  constructor(artifactGetter: ArtifactGetter) {
    this.artifactGetter = artifactGetter;
  }

  /**
   * Used to set Groth16 implementation from snarkjs.min.js or snarkjs.
   */
  setSnarkJSGroth16(snarkJSGroth16: Groth16) {
    this.groth16 = {
      fullProve: (
        formattedInputs: FormattedCircuitInputs,
        wasm: Optional<ArrayLike<number>>,
        zkey: ArrayLike<number>,
      ) => {
        const suppressDebugLogger = { debug: () => {} };

        // snarkjs: groth16FullProve(_input, wasmFile, zkeyFileName, logger)
        return snarkJSGroth16.fullProve(
          formattedInputs,
          wasm,
          zkey,
          suppressDebugLogger,
          undefined, // unused by snarkjs
          () => {}, // unused by snarkjs
        );
      },
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

    const fullProve = (
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

        return Promise.resolve({ proof });
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

  async verify(publicInputs: PublicInputs, proof: Proof): Promise<boolean> {
    if (!this.groth16) {
      throw new Error('Requires groth16 verification implementation');
    }
    if (!this.groth16.verify) {
      // Wallet-side verification is a fail-safe.
      // Snark verification will occur during gas estimate (and on-chain) regardless.
      return true;
    }

    // Fetch artifacts
    const artifacts = await this.artifactGetter.getArtifacts(publicInputs);

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

  dummyProve(publicInputs: PublicInputs): Proof {
    // Make sure we have valid artifacts for this number of inputs.
    // Note that the artifacts are not used in the dummy proof.
    this.artifactGetter.assertArtifactExists(
      publicInputs.nullifiers.length,
      publicInputs.commitmentsOut.length,
    );
    return Prover.zeroProof;
  }

  async prove(
    unprovedTransactionInputs: UnprovedTransactionInputs,
    progressCallback: ProverProgressCallback,
  ): Promise<{ proof: Proof; publicInputs: PublicInputs }> {
    if (!this.groth16) {
      throw new Error('Requires groth16 full prover implementation');
    }

    const { publicInputs } = unprovedTransactionInputs;

    const existingProof = ProofCache.get(unprovedTransactionInputs);
    if (existingProof) {
      return { proof: existingProof, publicInputs };
    }

    // 1-2  1-3  2-2  2-3  8-2 [nullifiers, commitments]
    // Fetch artifacts
    progressCallback(5);
    const artifacts = await this.artifactGetter.getArtifacts(publicInputs);
    if (!artifacts.wasm && !artifacts.dat) {
      throw new Error('Requires WASM or DAT prover artifact');
    }

    // Get formatted inputs
    const formattedInputs = Prover.formatInputs(unprovedTransactionInputs);

    // Generate proof: Progress from 20 - 99%
    const initialProgressProof = 20;
    const finalProgressProof = 99;
    progressCallback(initialProgressProof);
    const { proof } = await this.groth16.fullProve(
      formattedInputs,
      artifacts.wasm,
      artifacts.zkey,
      { debug: (msg: string) => EngineDebug.log(msg) },
      artifacts.dat,
      (progress: number) => {
        progressCallback(
          (progress * (finalProgressProof - initialProgressProof)) / 100 + initialProgressProof,
        );
      },
    );
    progressCallback(finalProgressProof);

    ProofCache.store(unprovedTransactionInputs, proof);

    // Throw if proof is invalid
    if (!(await this.verify(publicInputs, proof))) {
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

  static formatInputs(transactionInputs: UnprovedTransactionInputs): FormattedCircuitInputs {
    const { publicInputs, privateInputs } = transactionInputs;

    return {
      merkleRoot: publicInputs.merkleRoot,
      boundParamsHash: publicInputs.boundParamsHash,
      nullifiers: publicInputs.nullifiers,
      commitmentsOut: publicInputs.commitmentsOut,
      token: privateInputs.tokenAddress,
      publicKey: privateInputs.publicKey,
      signature: transactionInputs.signature,
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
