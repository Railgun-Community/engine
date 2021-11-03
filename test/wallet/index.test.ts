/* globals describe it beforeEach afterEach */
import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';

import memdown from 'memdown';
import Database from '../../src/database';

import Wallet from '../../src/wallet';

chai.use(chaiAsPromised);
const { expect } = chai;

let db: Database;
let wallet: Wallet;

const testMnemonic = 'test test test test test test test test test test test junk';
const testEncryptionKey = '01';

describe('Wallet/Index', () => {
  beforeEach(async () => {
    // Create database and wallet
    db = new Database(memdown());
    wallet = await Wallet.fromMnemonic(db, testEncryptionKey, testMnemonic);
  });

  it('Should load existing wallet', async () => {
    const wallet2 = await Wallet.loadExisting(db, testEncryptionKey, wallet.id);
    expect(wallet2.id).to.equal(wallet.id);
  });

  it('Should get wallet prefix path', async () => {
    expect(wallet.getWalletDBPrefix(0)).to.deep.equal([
      '0000000000000000000000000000000000000000000000000000000000000000',
      '000000000000000000000000000000000000000000000000000077616c6c6574',
      'c9855eb0e997395c2e4e2ada52487860509e0daf2ef8f74a6fe7ded9853efa42',
    ]);
  });

  afterEach(() => {
    // Clean up database
    db.level.close();
  });
});
