/* eslint-disable @typescript-eslint/no-unused-vars */
import { createDummyMerkleProof } from '../merkletree/merkle-proof';
import { Proof } from '../models/prover-types';
import { Chain } from '../models/engine-types';
import {
  BlindedCommitmentData,
  LegacyTransactProofData,
  POIsPerList,
  TXIDVersion,
  TXOPOIListStatus,
} from '../models/poi-types';
import { POINodeInterface } from '../poi/poi-node-interface';
import { MerkleProof } from '../models/formatted-types';
import { POIList, POIListType } from '../poi';

export const MOCK_LIST_KEY = 'test_list';

export const MOCK_LIST: POIList = {
  key: MOCK_LIST_KEY,
  type: POIListType.Gather,
  name: 'mock list',
  description: 'mock',
};

export const MOCK_LIST_ACTIVE: POIList = {
  key: MOCK_LIST_KEY,
  type: POIListType.Active,
  name: 'mock list',
  description: 'mock',
};

export class TestPOINodeInterface extends POINodeInterface {
  // eslint-disable-next-line class-methods-use-this
  isActive() {
    return true;
  }

  // eslint-disable-next-line class-methods-use-this
  async isRequired(chain: Chain): Promise<boolean> {
    return true;
  }

  static overridePOIsListStatus = TXOPOIListStatus.Valid;

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
        // Use 'override' value
        poisPerList[blindedCommitmentData.blindedCommitment][listKey] =
          TestPOINodeInterface.overridePOIsListStatus;
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

  // eslint-disable-next-line class-methods-use-this
  async submitLegacyTransactProofs(
    txidVersion: TXIDVersion,
    chain: Chain,
    listKeys: string[],
    legacyTransactProofDatas: LegacyTransactProofData[],
  ): Promise<void> {
    return Promise.resolve();
  }
}
