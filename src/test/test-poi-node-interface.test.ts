/* eslint-disable @typescript-eslint/no-unused-vars */
import { createDummyMerkleProof } from '../merkletree/merkle-proof';
import { Proof } from '../models/prover-types';
import { Chain } from '../models/engine-types';
import {
  BlindedCommitmentData,
  POIsPerList,
  TXIDVersion,
  TXOPOIListStatus,
} from '../models/poi-types';
import { POINodeInterface } from '../poi/poi-node-interface';
import { MerkleProof } from '../models/formatted-types';

export const MOCK_LIST_KEY = 'test_list';

export class TestPOINodeInterface extends POINodeInterface {
  // eslint-disable-next-line class-methods-use-this
  isActive() {
    return true;
  }

  // eslint-disable-next-line class-methods-use-this
  async getPOIsPerList(
    txidVersion: TXIDVersion,
    chain: Chain,
    listKeys: string[],
    blindedCommitmentDatas: BlindedCommitmentData[],
  ): Promise<{ [blindedCommitment: string]: POIsPerList }> {
    const poisPerList: { [blindedCommitment: string]: POIsPerList } = {};
    blindedCommitmentDatas.forEach((blindedCommitmentData) => {
      poisPerList[blindedCommitmentData.blindedCommitment] ??= {};
      listKeys.forEach((listKey) => {
        // All "Missing"
        poisPerList[blindedCommitmentData.blindedCommitment][listKey] = TXOPOIListStatus.Missing;
      });
    });
    return poisPerList;
  }

  // eslint-disable-next-line class-methods-use-this
  async getPOIMerkleProofs(
    txidVersion: TXIDVersion,
    chain: Chain,
    listKey: string,
    blindedCommitments: string[],
  ): Promise<MerkleProof[]> {
    // Use dummy proofs even after POI launch block, for tests.
    return blindedCommitments.map(createDummyMerkleProof);
  }

  // eslint-disable-next-line class-methods-use-this
  async submitPOI(
    txidVersion: TXIDVersion,
    chain: Chain,
    listKey: string,
    snarkProof: Proof,
    poiMerkleroots: string[],
    txidMerkleroot: string,
    txidMerklerootIndex: number,
    blindedCommitmentsOut: string[],
    railgunTxidIfHasUnshield: string,
  ): Promise<void> {
    return Promise.resolve();
  }
}
