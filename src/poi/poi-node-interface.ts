import { POIsPerList } from '../models/formatted-types';
import { Chain } from '../models/engine-types';
import { Proof } from '../models/prover-types';

export abstract class POINodeInterface {
  abstract getPOIsPerList(
    chain: Chain,
    listKeys: string[],
    blindedCommitments: string[],
  ): Promise<{ [blindedCommitment: string]: POIsPerList }>;

  abstract submitPOI(
    chain: Chain,
    listKey: string,
    proof: Proof,
    poiMerkleroots: string[],
    txidMerkleroot: string,
    txidMerklerootIndex: number,
    blindedCommitmentOutputs: string[],
  ): Promise<void>;
}
