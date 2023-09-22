import EngineDebug from '../debugger/debugger';
import { ByteLength, hexToBigInt, nToHex } from '../utils/bytes';
import {
  ArtifactGetter,
  FormattedCircuitInputsRailgun,
  UnprovedTransactionInputs,
  Proof,
  PublicInputsRailgun,
  SnarkProof,
  NativeProverFormattedJsonInputsRailgun,
  FormattedCircuitInputsPOI,
  NativeProverFormattedJsonInputsPOI,
  PublicInputsPOI,
} from '../models/prover-types';
import { stringifySafe } from '../utils/stringify';
import { ProofCache } from './proof-cache';
import { POIEngineProofInputsWithListPOIData } from '../models/poi-types';
import { ProofCachePOI } from './proof-cache-poi';
import { isDefined } from '../utils/is-defined';

const ZERO_VALUE_POI = 0n;

type NativeProveRailgun = (
  circuitId: number,
  datBuffer: Buffer,
  zkeyBuffer: Buffer,
  inputJson: NativeProverFormattedJsonInputsRailgun,
  progressCallback: ProverProgressCallback,
) => Proof;

type NativeProvePOI = (
  datBuffer: Buffer,
  zkeyBuffer: Buffer,
  inputJson: NativeProverFormattedJsonInputsPOI,
  progressCallback: ProverProgressCallback,
) => Proof;

type Groth16FullProveRailgun = (
  formattedInputs: FormattedCircuitInputsRailgun,
  wasm: Optional<ArrayLike<number>>,
  zkey: ArrayLike<number>,
  logger: { debug: (log: string) => void },
  dat: Optional<ArrayLike<number>>,
  progressCallback: ProverProgressCallback,
) => Promise<{ proof: Proof; publicSignals?: string[] }>;

type Groth16FullProvePOI = (
  formattedInputs: FormattedCircuitInputsPOI,
  wasm: Optional<ArrayLike<number>>,
  zkey: ArrayLike<number>,
  logger: { debug: (log: string) => void },
  dat: Optional<ArrayLike<number>>,
  progressCallback: ProverProgressCallback,
) => Promise<{ proof: Proof; publicSignals?: string[] }>;

type Groth16Verify = Optional<
  (vkey: object, publicSignals: bigint[], proof: Proof) => Promise<boolean>
>;

export type SnarkJSGroth16 = {
  fullProve: (
    formattedInputs: Partial<Record<string, bigint | bigint[] | bigint[][]>>,
    wasm: Optional<ArrayLike<number>>,
    zkey: ArrayLike<number>,
    logger: { debug: (log: string) => void },
  ) => Promise<{ proof: Proof; publicSignals: string[] }>;
  verify: Groth16Verify;
};

export type Groth16Implementation = {
  fullProveRailgun: Groth16FullProveRailgun;
  fullProvePOI: Groth16FullProvePOI;
  verify: Groth16Verify;
};

export type ProverProgressCallback = (progress: number) => void;

export class Prover {
  private artifactGetter: ArtifactGetter;

  groth16: Optional<Groth16Implementation>;

  constructor(artifactGetter: ArtifactGetter) {
    this.artifactGetter = artifactGetter;
  }

  /**
   * Used to set Groth16 implementation from snarkjs.min.js or snarkjs.
   */
  setSnarkJSGroth16(snarkJSGroth16: SnarkJSGroth16) {
    const suppressDebugLogger = { debug: () => {} };

    this.groth16 = {
      fullProveRailgun: (
        formattedInputs: FormattedCircuitInputsRailgun,
        wasm: Optional<ArrayLike<number>>,
        zkey: ArrayLike<number>,
      ) => {
        return snarkJSGroth16.fullProve(formattedInputs, wasm, zkey, suppressDebugLogger);
      },
      fullProvePOI: (
        formattedInputs: FormattedCircuitInputsPOI,
        wasm: Optional<ArrayLike<number>>,
        zkey: ArrayLike<number>,
      ) => {
        return snarkJSGroth16.fullProve(formattedInputs, wasm, zkey, suppressDebugLogger);
      },
      verify: snarkJSGroth16.verify,
    };
  }

  /**
   * Used to set Groth16 implementation from RAILGUN Native Prover.
   */
  setNativeProverGroth16(
    nativeProveRailgun: NativeProveRailgun,
    nativeProvePOI: NativeProvePOI,
    circuits: { [name: string]: number },
  ) {
    const circuitIdForInputsOutputs = (inputs: number, outputs: number): number => {
      const circuitString = `${inputs}X${outputs}`;
      const circuitName = `JOINSPLIT_${circuitString}`;
      const circuitId = circuits[circuitName];
      if (circuitId == null) {
        throw new Error(`No circuit found for ${circuitString.toLowerCase()}`);
      }
      return circuitId;
    };

    const fullProveRailgun = (
      formattedInputs: FormattedCircuitInputsRailgun,
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

        const jsonInputs = JSON.parse(stringInputs) as NativeProverFormattedJsonInputsRailgun;

        const datBuffer = dat as Buffer;
        const zkeyBuffer = zkey as Buffer;

        const start = Date.now();

        const proof: Proof = nativeProveRailgun(
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

    const fullProvePOI = (
      formattedInputs: FormattedCircuitInputsPOI,
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

        const stringInputs = stringifySafe(formattedInputs);
        logger.debug(stringInputs);

        const jsonInputs = JSON.parse(stringInputs) as NativeProverFormattedJsonInputsPOI;

        const datBuffer = dat as Buffer;
        const zkeyBuffer = zkey as Buffer;

        const start = Date.now();

        const proof: Proof = nativeProvePOI(datBuffer, zkeyBuffer, jsonInputs, progressCallback);

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
      fullProveRailgun,
      fullProvePOI,

      // Proof will be verified during gas estimate, and on-chain.
      verify: undefined,
    };
  }

  async verifyRailgunProof(
    publicInputs: PublicInputsRailgun,
    proof: Proof,
    artifacts: Artifact,
  ): Promise<boolean> {
    if (!this.groth16) {
      throw new Error('Requires groth16 implementation');
    }
    if (!this.groth16.verify) {
      // Wallet-side verification is a fail-safe.
      // Snark verification will occur during gas estimate (and on-chain) regardless.
      return true;
    }

    // Return output of groth16 verify
    const publicSignals: bigint[] = [
      publicInputs.merkleRoot,
      publicInputs.boundParamsHash,
      ...publicInputs.nullifiers,
      ...publicInputs.commitmentsOut,
    ];

    return this.groth16.verify(artifacts.vkey, publicSignals, proof);
  }

  async verifyPOIProof(
    publicInputs: PublicInputsPOI,
    proof: Proof,
    artifacts: Artifact,
  ): Promise<boolean> {
    if (!this.groth16) {
      throw new Error('Requires groth16 implementation');
    }
    if (!this.groth16.verify) {
      // Wallet-side verification is a fail-safe.
      // Snark verification will occur during gas estimate (and on-chain) regardless.
      return true;
    }

    const publicSignals: bigint[] = [
      ...publicInputs.blindedCommitmentsOut,
      publicInputs.anyRailgunTxidMerklerootAfterTransaction,
      ...publicInputs.poiMerkleroots,
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

  dummyProveRailgun(publicInputs: PublicInputsRailgun): Proof {
    // Make sure we have valid artifacts for this number of inputs.
    // Note that the artifacts are not used in the dummy proof.
    this.artifactGetter.assertArtifactExists(
      publicInputs.nullifiers.length,
      publicInputs.commitmentsOut.length,
    );
    return Prover.zeroProof;
  }

  async proveRailgun(
    unprovedTransactionInputs: UnprovedTransactionInputs,
    progressCallback: ProverProgressCallback,
  ): Promise<{ proof: Proof; publicInputs: PublicInputsRailgun }> {
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
    const formattedInputs = Prover.formatRailgunInputs(unprovedTransactionInputs);

    // Generate proof: Progress from 20 - 99%
    const initialProgressProof = 20;
    const finalProgressProof = 99;
    progressCallback(initialProgressProof);
    const { proof } = await this.groth16.fullProveRailgun(
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

    // Throw if proof is invalid
    if (!(await this.verifyRailgunProof(publicInputs, proof, artifacts))) {
      throw new Error('Proof verification failed');
    }

    ProofCache.store(unprovedTransactionInputs, proof);

    progressCallback(100);

    // Return proof with inputs
    return {
      proof,
      publicInputs,
    };
  }

  async provePOI(
    inputs: POIEngineProofInputsWithListPOIData,
    blindedCommitmentsOut: string[],
    progressCallback: ProverProgressCallback,
  ): Promise<{ proof: Proof; publicInputs: PublicInputsPOI }> {
    if (!this.groth16) {
      throw new Error('Requires groth16 full prover implementation');
    }

    const formattedInputs = Prover.formatPOIInputs(inputs);

    const formattedBlindedCommitmentsOut = Prover.padWithZerosToMax(
      blindedCommitmentsOut.map(hexToBigInt),
      13,
    );

    const publicInputs: PublicInputsPOI = {
      anyRailgunTxidMerklerootAfterTransaction:
        formattedInputs.anyRailgunTxidMerklerootAfterTransaction,
      blindedCommitmentsOut: formattedBlindedCommitmentsOut,
      poiMerkleroots: formattedInputs.poiMerkleroots,
    };

    const existingProof = ProofCachePOI.get(inputs.blindedCommitmentsIn, blindedCommitmentsOut);
    if (existingProof) {
      return { proof: existingProof, publicInputs };
    }

    progressCallback(5);

    const artifacts = await this.artifactGetter.getArtifactsPOI();
    if (!artifacts.wasm && !artifacts.dat) {
      throw new Error('Requires WASM or DAT prover artifact');
    }

    // Generate proof: Progress from 20 - 99%
    const initialProgressProof = 20;
    const finalProgressProof = 99;
    progressCallback(initialProgressProof);
    const proofData = await this.groth16.fullProvePOI(
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
    const { proof, publicSignals } = proofData;

    if (isDefined(publicSignals)) {
      // snarkjs will provide publicSignals for validation

      for (let i = 0; i < formattedBlindedCommitmentsOut.length; i += 1) {
        const blindedCommitmentOutString = formattedBlindedCommitmentsOut[i].toString();
        if (blindedCommitmentOutString !== publicSignals[i]) {
          throw new Error(
            `Invalid blindedCommitmentOut value: expected ${publicSignals[i]}, got ${blindedCommitmentOutString}`,
          );
        }
      }
    }

    progressCallback(finalProgressProof);

    // Throw if proof is invalid
    if (!(await this.verifyPOIProof(publicInputs, proof, artifacts))) {
      throw new Error('Proof verification failed');
    }

    ProofCachePOI.store(inputs.blindedCommitmentsIn, blindedCommitmentsOut, proof);

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

  private static formatRailgunInputs(
    transactionInputs: UnprovedTransactionInputs,
  ): FormattedCircuitInputsRailgun {
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

  private static padWithZerosToMax(array: bigint[], max: number): bigint[] {
    const padded = [...array];
    while (padded.length < max) {
      padded.push(ZERO_VALUE_POI);
    }
    return padded;
  }

  private static padWithArraysOfZerosToMaxAndLength(
    doubleArray: bigint[][],
    max: number,
    length: number,
  ): bigint[][] {
    const padded = [...doubleArray];
    while (padded.length < max) {
      padded.push(new Array<bigint>(length).fill(ZERO_VALUE_POI));
    }
    return padded;
  }

  private static formatPOIInputs(
    proofInputs: POIEngineProofInputsWithListPOIData,
  ): FormattedCircuitInputsPOI {
    const maxInputs = 13;
    const maxOutputs = 13;

    return {
      anyRailgunTxidMerklerootAfterTransaction: hexToBigInt(
        proofInputs.anyRailgunTxidMerklerootAfterTransaction,
      ),
      boundParamsHash: hexToBigInt(proofInputs.boundParamsHash),
      nullifiers: this.padWithZerosToMax(proofInputs.nullifiers.map(hexToBigInt), maxInputs),
      commitmentsOut: this.padWithZerosToMax(
        proofInputs.commitmentsOut.map(hexToBigInt),
        maxOutputs,
      ),
      spendingPublicKey: proofInputs.spendingPublicKey,
      nullifyingKey: proofInputs.nullifyingKey,
      token: hexToBigInt(proofInputs.token),
      randomsIn: this.padWithZerosToMax(proofInputs.randomsIn.map(hexToBigInt), maxInputs),
      valuesIn: this.padWithZerosToMax(proofInputs.valuesIn, maxOutputs),
      utxoPositionsIn: this.padWithZerosToMax(proofInputs.utxoPositionsIn.map(BigInt), maxInputs),
      blindedCommitmentsIn: this.padWithZerosToMax(
        proofInputs.blindedCommitmentsIn.map(hexToBigInt),
        maxInputs,
      ),
      creationTxidsIn: this.padWithZerosToMax(
        proofInputs.creationTxidsIn.map(hexToBigInt),
        maxInputs,
      ),

      npksOut: this.padWithZerosToMax(proofInputs.npksOut, maxOutputs),
      valuesOut: this.padWithZerosToMax(proofInputs.valuesOut, maxOutputs),
      railgunTxidMerkleProofIndices: hexToBigInt(proofInputs.railgunTxidMerkleProofIndices),
      railgunTxidMerkleProofPathElements:
        proofInputs.railgunTxidMerkleProofPathElements.map(hexToBigInt),
      poiMerkleroots: this.padWithZerosToMax(
        proofInputs.poiMerkleroots.map(hexToBigInt),
        maxInputs,
      ),
      poiInMerkleProofIndices: this.padWithZerosToMax(
        proofInputs.poiInMerkleProofIndices.map(hexToBigInt),
        maxInputs,
      ),
      poiInMerkleProofPathElements: this.padWithArraysOfZerosToMaxAndLength(
        proofInputs.poiInMerkleProofPathElements.map((pathElements) =>
          pathElements.map(hexToBigInt),
        ),
        maxInputs,
        16,
      ),
    };
  }
}
