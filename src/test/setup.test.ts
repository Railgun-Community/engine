import { JsonRpcProvider } from 'ethers';
import { TXIDVersion, TXOPOIListStatus } from '../models/poi-types';
import { POI } from '../poi/poi';
import { getTestTXIDVersion } from './helper.test';
import { MOCK_LIST, TestPOINodeInterface } from './test-poi-node-interface.test';
import { config } from './config.test';
import { isDefined } from '../utils/is-defined';

before(async () => {
  POI.init([MOCK_LIST], new TestPOINodeInterface());

  if (isDefined(process.env.RUN_HARDHAT_TESTS)) {
    // Ensure that hardhat is loaded.
    const provider = new JsonRpcProvider(config.rpc);
    switch (getTestTXIDVersion()) {
      case TXIDVersion.V2_PoseidonMerkle:
        if (!(await provider.getCode(config.contracts.proxy))) {
          throw new Error('RailgunSmartWallet hardhat instance not found');
        }
        break;
      case TXIDVersion.V3_PoseidonMerkle:
        if (!(await provider.getCode(config.contracts.poseidonMerkleAccumulatorV3))) {
          throw new Error('PoseidonMerkleAccumulator hardhat instance not found');
        }
        break;
    }
  }
});

beforeEach(() => {
  TestPOINodeInterface.overridePOIsListStatus = TXOPOIListStatus.Valid;
});
