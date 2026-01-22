import type {
  Groth16Prover,
  Proof as CoreProof,
  POICircuitInputs,
  POIPublicInputs,
  ProverArtifacts,
  TransactionCircuitInputs,
  TransactionPublicInputs,
} from '@railgun-reloaded/prover'
import {
  createGroth16ForEngine,
  SnarkjsPoiProver,
  SnarkjsTransactionProver,
  standardToSnarkJSTransactionInput,
  standardToSnarkJSPOIInput
} from '@railgun-reloaded/prover'


type SnarkResult = Awaited<ReturnType<Groth16Prover['fullProve']>>


export class EngineGroth16AdapterProver {
  /**
   * Transaction circuit artifacts (vkey, zkey, wasm)
   */
  private readonly txArtifacts: ProverArtifacts | null

  /**
   * POI circuit artifacts (vkey, zkey, wasm)
   */
  private readonly poiArtifacts: ProverArtifacts | null

  /**
   * Groth16 adapter instance matching snarkjs.groth16 interface
   */
  private readonly groth16: ReturnType<typeof createGroth16ForEngine>

  /**
   * Creates a new EngineGroth16AdapterProver instance.
   * @param txArtifacts - Transaction circuit artifacts, or null if not needed
   * @param poiArtifacts - POI circuit artifacts, or null if not needed
   */
  constructor(txArtifacts: ProverArtifacts | null, poiArtifacts: ProverArtifacts | null) {
    this.txArtifacts = txArtifacts
    this.poiArtifacts = poiArtifacts


    this.groth16 = createGroth16ForEngine(

      txArtifacts ? new SnarkjsTransactionProver(txArtifacts) : null,

      poiArtifacts ? new SnarkjsPoiProver(poiArtifacts) : null,

      txArtifacts,
      poiArtifacts
    )
  }

  /**
   * Generate a Groth16 proof for a transaction circuit using the core adapter.
   * @param circuitInputs - Transaction circuit inputs in standard format
   * @returns SNARKJS-style SNARK object ({ proof, publicSignals })
   */
  async proveTransactionViaAdapter(
    circuitInputs: TransactionCircuitInputs
  ): Promise<SnarkResult> {
    if (!this.txArtifacts) {
      throw new Error('Transaction artifacts are required to generate transaction proofs.')
    }

    const snarkjsInputs = standardToSnarkJSTransactionInput(circuitInputs)

    return this.groth16.fullProve(
      snarkjsInputs,
      this.txArtifacts.wasm,
      this.txArtifacts.zkey
    )
  }

  /**
   * Generate a Groth16 proof for a POI circuit using the core adapter.
   * @param circuitInputs - POI circuit inputs in standard format
   * @returns SNARKJS-style SNARK object ({ proof, publicSignals })
   */
  async provePOIViaAdapter(
    circuitInputs: POICircuitInputs
  ): Promise<SnarkResult> {
    if (!this.poiArtifacts) {
      throw new Error('POI artifacts are required to generate POI proofs.')
    }

    const snarkjsInputs = standardToSnarkJSPOIInput(circuitInputs)

    return this.groth16.fullProve(
      snarkjsInputs,
      this.poiArtifacts.wasm,
      this.poiArtifacts.zkey
    )
  }

  /**
   * Convenience helper to generate and immediately validate a transaction proof
   * using the adapter verify method.
   * @param circuitInputs - Transaction circuit inputs in standard format
   * @param vkey - Verification key for the transaction circuit
   * @returns Object containing proof, publicInputs, and verification result
   */
  async proveAndVerifyTransaction(
    circuitInputs: TransactionCircuitInputs,
    vkey: ProverArtifacts['vkey']
  ): Promise<{ proof: CoreProof; publicInputs: TransactionPublicInputs; isValid: boolean }> {
    const txProver = new SnarkjsTransactionProver(this.txArtifacts as ProverArtifacts)
    const { proof, publicInputs } = await txProver.prove(circuitInputs)

    const snarkjsResult = await this.proveTransactionViaAdapter(circuitInputs)
    const isValid = await this.groth16.verify(
      vkey,
      snarkjsResult.publicSignals,
      snarkjsResult.proof
    )

    return { proof, publicInputs, isValid }
  }

  /**
   * Convenience helper to generate and immediately validate a POI proof
   * using the adapter verify method.
   * @param circuitInputs - POI circuit inputs in standard format
   * @param vkey - Verification key for the POI circuit
   * @returns Object containing proof, publicInputs, and verification result
   */
  async proveAndVerifyPOI(
    circuitInputs: POICircuitInputs,
    vkey: ProverArtifacts['vkey']
  ): Promise<{ proof: CoreProof; publicInputs: POIPublicInputs; isValid: boolean }> {
    const poiProver = new SnarkjsPoiProver(this.poiArtifacts as ProverArtifacts)
    const { proof, publicInputs } = await poiProver.prove(circuitInputs)

    const snarkjsResult = await this.provePOIViaAdapter(circuitInputs)
    const isValid = await this.groth16.verify(
      vkey,
      snarkjsResult.publicSignals,
      snarkjsResult.proof
    )

    return { proof, publicInputs, isValid }
  }
}
