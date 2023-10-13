import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { POI, POIListType } from '../poi';
import { MOCK_LIST_KEY, TestPOINodeInterface } from '../../test/test-poi-node-interface.test';
import {
  Chain,
  OutputType,
  POIsPerList,
  SentCommitment,
  TXO,
  TXOPOIListStatus,
  UnshieldStoredEvent,
  WalletBalanceBucket,
} from '../../models';
import { TransactNote } from '../../note/transact-note';

chai.use(chaiAsPromised);
const { expect } = chai;

const activeList1 = 'activeList1';
const activeList2 = 'activeList2';

const invalidPOIsForList1 = {
  poisPerList: {
    [activeList1]: TXOPOIListStatus.Missing,
    [activeList2]: TXOPOIListStatus.Valid,
  } as POIsPerList,
};
const submittedPOIsForList1 = {
  poisPerList: {
    [activeList1]: TXOPOIListStatus.TransactProofSubmitted,
    [activeList2]: TXOPOIListStatus.Valid,
  } as POIsPerList,
};
const validPOIsForList1 = {
  poisPerList: {
    [activeList1]: TXOPOIListStatus.Valid,
    [activeList2]: TXOPOIListStatus.Valid,
  } as POIsPerList,
};
const shieldPendingPOIsForList1 = {
  poisPerList: {
    [activeList1]: TXOPOIListStatus.ShieldPending,
    [activeList2]: TXOPOIListStatus.Valid,
  } as POIsPerList,
};
const shieldBlockedPOIsForList1 = {
  poisPerList: {
    [activeList1]: TXOPOIListStatus.ShieldBlocked,
    [activeList2]: TXOPOIListStatus.Valid,
  } as POIsPerList,
};

const chain: Chain = { type: 0, id: 1 };

describe('poi', () => {
  before(() => {
    POI.init(
      [
        { key: MOCK_LIST_KEY, type: POIListType.Gather },
        { key: activeList1, type: POIListType.Active },
        { key: activeList2, type: POIListType.Active },
      ],
      new TestPOINodeInterface(),
    );
    POI.setLaunchBlock(chain, 0);
  });

  after(() => {
    POI.init([{ key: MOCK_LIST_KEY, type: POIListType.Gather }], new TestPOINodeInterface());
  });

  it('Should get which list keys can generate spent POIs', async () => {
    const listKeysLegacy = POI.getListKeysCanGenerateSpentPOIs(
      [invalidPOIsForList1 as TXO],
      [submittedPOIsForList1 as SentCommitment],
      [invalidPOIsForList1 as UnshieldStoredEvent],
      true,
    );
    expect(listKeysLegacy).to.deep.equal([MOCK_LIST_KEY, activeList1]);

    const listKeysNoInputProofs = POI.getListKeysCanGenerateSpentPOIs(
      [invalidPOIsForList1 as TXO],
      [submittedPOIsForList1 as SentCommitment],
      [submittedPOIsForList1 as UnshieldStoredEvent],
      false,
    );
    expect(listKeysNoInputProofs).to.deep.equal([]);

    const listKeysAllValidOutputProofs = POI.getListKeysCanGenerateSpentPOIs(
      [validPOIsForList1 as TXO],
      [submittedPOIsForList1 as SentCommitment],
      [validPOIsForList1 as UnshieldStoredEvent],
      false,
    );
    expect(listKeysAllValidOutputProofs).to.deep.equal([]);

    const listKeysInvalidUnshieldProof = POI.getListKeysCanGenerateSpentPOIs(
      [validPOIsForList1 as TXO],
      [submittedPOIsForList1 as SentCommitment],
      [invalidPOIsForList1 as UnshieldStoredEvent],
      false,
    );
    expect(listKeysInvalidUnshieldProof).to.deep.equal([activeList1]);
  });

  it('Should get appropriate balance bucket for TXO', async () => {
    const changeNote = { outputType: OutputType.Change } as TransactNote;

    const balanceBucketChange = POI.getBalanceBucket(chain, {
      note: changeNote,
    } as TXO);
    expect(balanceBucketChange).to.deep.equal(WalletBalanceBucket.MissingInternalPOI);

    const balanceBucketTransfer = POI.getBalanceBucket(chain, {
      note: { outputType: OutputType.Transfer } as TransactNote,
    } as TXO);
    expect(balanceBucketTransfer).to.deep.equal(WalletBalanceBucket.MissingExternalPOI);

    const balanceBucketInvalid = POI.getBalanceBucket(chain, {
      note: changeNote,
      ...invalidPOIsForList1,
    } as TXO);
    expect(balanceBucketInvalid).to.deep.equal(WalletBalanceBucket.MissingInternalPOI);

    const balanceBucketSubmitted = POI.getBalanceBucket(chain, {
      note: changeNote,
      ...submittedPOIsForList1,
    } as TXO);
    expect(balanceBucketSubmitted).to.deep.equal(WalletBalanceBucket.TransactProofSubmitted);

    const balanceBucketValid = POI.getBalanceBucket(chain, {
      note: changeNote,
      ...validPOIsForList1,
    } as TXO);
    expect(balanceBucketValid).to.deep.equal(WalletBalanceBucket.Spendable);

    const balanceBucketShieldPending = POI.getBalanceBucket(chain, {
      note: changeNote,
      ...shieldPendingPOIsForList1,
    } as TXO);
    expect(balanceBucketShieldPending).to.deep.equal(WalletBalanceBucket.ShieldPending);

    const balanceBucketShieldBlocked = POI.getBalanceBucket(chain, {
      note: changeNote,
      ...shieldBlockedPOIsForList1,
    } as TXO);
    expect(balanceBucketShieldBlocked).to.deep.equal(WalletBalanceBucket.ShieldBlocked);
  });
});
