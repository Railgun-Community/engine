import EngineDebug from '../debugger/debugger';
import { Proof } from '../models/prover-types';
import { Prover } from '../prover/prover';

export type TransactProofData = {
  snarkProof: Proof;
  poiMerkleroots: string[];
  txidMerkleroot: string;
  txidMerklerootIndex: number;
  blindedCommitmentsOut: string[];
  railgunTxidIfHasUnshield: string;
};

export class POIProof {
  static verifyTransactProof = async (
    prover: Prover,
    transactProofData: TransactProofData,
  ): Promise<boolean> => {
    // Mini
    if (await this.tryVerifyProof(prover, transactProofData, 3, 3)) {
      return true;
    }
    // Full
    return this.tryVerifyProof(prover, transactProofData, 13, 13);
  };

  private static getPublicInputsPOI = (
    prover: Prover,
    transactProofData: TransactProofData,
    maxInputs: number,
    maxOutputs: number,
  ) => {
    return prover.getPublicInputsPOI(
      transactProofData.txidMerkleroot,
      transactProofData.blindedCommitmentsOut,
      transactProofData.poiMerkleroots,
      transactProofData.railgunTxidIfHasUnshield,
      maxInputs,
      maxOutputs,
    );
  };

  private static tryVerifyProof = async (
    prover: Prover,
    transactProofData: TransactProofData,
    maxInputs: number,
    maxOutputs: number,
  ) => {
    try {
      const publicInputs = this.getPublicInputsPOI(
        prover,
        transactProofData,
        maxInputs,
        maxOutputs,
      );
      return await prover.verifyPOIProof(
        publicInputs,
        transactProofData.snarkProof,
        maxInputs,
        maxOutputs,
      );
    } catch (err) {
      EngineDebug.error(err as Error);
      return false;
    }
  };
}
