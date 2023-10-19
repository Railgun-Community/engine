import { TXOPOIListStatus } from '../models/poi-types';
import { POI } from '../poi/poi';
import { MOCK_LIST, TestPOINodeInterface } from './test-poi-node-interface.test';

before(() => {
  POI.init([MOCK_LIST], new TestPOINodeInterface());
});

beforeEach(() => {
  TestPOINodeInterface.overridePOIsListStatus = TXOPOIListStatus.Valid;
});
