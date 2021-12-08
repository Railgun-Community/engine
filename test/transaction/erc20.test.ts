/* globals describe it beforeEach */
import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';

import { ERC20Transaction } from '../../src/transaction';

chai.use(chaiAsPromised);
const { expect } = chai;

let transaction: ERC20Transaction;

describe('Wallet/Index', () => {
  beforeEach(async () => {
    transaction = new ERC20Transaction('7f4925cdf66ddf5b88016df1fe915e68eff8f192');
  });

  it('Should calculate adaptID correctly', async () => {
    expect(transaction.adaptIDhash).to.equal('f5a5fd42d16a20302798ef6ed309979b43003d2320d9f0e8ea9831a92759fb4b');

    transaction.adaptID.contract = '7f4925cdf66ddf5b88016df1fe915e68eff8f192';
    transaction.adaptID.parameters = '21543ad39bf8f7649d6325e44f53cbc84f501847cf42bd9fb14d63be21dcffc8';

    expect(transaction.adaptIDhash).to.equal('b107d2ef47e7d68c13fd053058bafd99807941d5826cb10adf4c0103a8ff81fe');
  });
});
