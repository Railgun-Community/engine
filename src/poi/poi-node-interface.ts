import { Chain } from '../models/engine-types';
import {
  BlindedCommitmentData,
  POIEngineProofInputs,
  POIsPerList,
  TXIDVersion,
} from '../models/poi-types';

export abstract class POINodeInterface {
  abstract isActive(chain: Chain): boolean;

  abstract getPOIsPerList(
    txidVersion: TXIDVersion,
    chain: Chain,
    listKeys: string[],
    blindedCommitmentDatas: BlindedCommitmentData[],
  ): Promise<{ [blindedCommitment: string]: POIsPerList }>;

  abstract generateAndSubmitPOI(
    txidVersion: TXIDVersion,
    chain: Chain,
    listKey: string,
    proofInputs: POIEngineProofInputs,
    blindedCommitmentsOut: string[],
    txidMerklerootIndex: number,
    railgunTransactionBlockNumber: number,
  ): Promise<void>;
}
