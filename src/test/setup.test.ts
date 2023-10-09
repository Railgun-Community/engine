import { TXOPOIListStatus } from '../models/poi-types';
import { POI, POIListType } from '../poi/poi';
import { MOCK_LIST_KEY, TestPOINodeInterface } from './test-poi-node-interface.test';

before(() => {
  POI.init([{ key: MOCK_LIST_KEY, type: POIListType.Gather }], new TestPOINodeInterface());
});

beforeEach(() => {
  TestPOINodeInterface.overridePOIsListStatus = TXOPOIListStatus.Valid;
});
