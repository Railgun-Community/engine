import { RailgunTxidMerkletreeData } from '../models/formatted-types';
import { Chain } from '../models/engine-types';
import { BlindedCommitmentData, POIsPerList } from '../models/poi-types';

export abstract class POINodeInterface {
  abstract getPOIsPerList(
    chain: Chain,
    listKeys: string[],
    blindedCommitmentDatas: BlindedCommitmentData[],
  ): Promise<{ [blindedCommitment: string]: POIsPerList }>;

  abstract generateAndSubmitPOI(
    chain: Chain,
    listKey: string,
    blindedCommitments: string[],
    txidMerkletreeData: RailgunTxidMerkletreeData,
  ): Promise<void>;
}
