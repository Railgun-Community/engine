/* eslint-disable @typescript-eslint/no-unused-vars */
import {
  Chain,
  BlindedCommitmentData,
  POIsPerList,
  POIEngineProofInputs,
  TXOPOIListStatus,
} from '../models';
import { POINodeInterface } from '../poi/poi-node-interface';

export const MOCK_LIST_KEY = 'test_list';

export class TestPOINodeInterface extends POINodeInterface {
  // eslint-disable-next-line class-methods-use-this
  isActive() {
    return true;
  }

  // eslint-disable-next-line class-methods-use-this
  async getPOIsPerList(
    _chain: Chain,
    listKeys: string[],
    blindedCommitmentDatas: BlindedCommitmentData[],
  ): Promise<{ [blindedCommitment: string]: POIsPerList }> {
    const allMissing: { [blindedCommitment: string]: POIsPerList } = {};
    blindedCommitmentDatas.forEach((blindedCommitmentData) => {
      allMissing[blindedCommitmentData.blindedCommitment] ??= {};
      listKeys.forEach((listKey) => {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        allMissing[blindedCommitmentData.blindedCommitment][listKey] = TXOPOIListStatus.Missing;
      });
    });
    return allMissing;
  }

  // eslint-disable-next-line class-methods-use-this
  async generateAndSubmitPOI(
    chain: Chain,
    listKey: string,
    proofInputs: POIEngineProofInputs,
    blindedCommitmentsOut: string[],
    txidMerklerootIndex: number,
    railgunTransactionBlockNumber: number,
  ): Promise<void> {
    return Promise.resolve();
  }
}
