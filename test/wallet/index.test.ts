/* globals describe it beforeEach afterEach */
import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';

import memdown from 'memdown';
import Database from '../../src/database';
import MerkleTree from '../../src/merkletree';

import Wallet from '../../src/wallet';

chai.use(chaiAsPromised);
const { expect } = chai;

let db: Database;
let merkletree: MerkleTree;
let wallet: Wallet;

const testMnemonic = 'test test test test test test test test test test test junk';
const testEncryptionKey = '01';

describe('Wallet/Index', () => {
  beforeEach(async () => {
    // Create database and wallet
    db = new Database(memdown());
    merkletree = new MerkleTree(db, 1, 'erc20', async () => true);
    wallet = await Wallet.fromMnemonic(db, testEncryptionKey, testMnemonic);
  });

  it('Should load existing wallet', async () => {
    const wallet2 = await Wallet.loadExisting(db, testEncryptionKey, wallet.id);
    expect(wallet2.id).to.equal(wallet.id);
  });

  it('Should get wallet prefix path', async () => {
    expect(wallet.getWalletDBPrefix(1)).to.deep.equal([
      '000000000000000000000000000000000000000000000000000077616c6c6574',
      'c9855eb0e997395c2e4e2ada52487860509e0daf2ef8f74a6fe7ded9853efa42',
      '0000000000000000000000000000000000000000000000000000000000000001',
    ]);
  });

  it('Should derive addresses correctly', async () => {
    const vectors = [
      {
        index: 0,
        change: false,
        chainID: 1,
        address: 'rgeth1q8y4j4ssfa53xxcuy6wrq6yd8tld6rp6z4wjwr5x96jvr7y6vqapk0tmp0s',
      },
      {
        index: 0,
        change: false,
        chainID: 56,
        address: 'rgbsc1q8y4j4ssfa53xxcuy6wrq6yd8tld6rp6z4wjwr5x96jvr7y6vqapknjv6r8',
      },
      {
        index: 13,
        change: true,
        chainID: 1,
        address: 'rgeth1qy87jfm8nwnl0t4y2f2tnv5vyzfxlt8sgphhvg2wya79t0uqpskpzpercjs',
      },
      {
        index: 0,
        change: false,
        chainID: undefined,
        address: 'rgany1q8y4j4ssfa53xxcuy6wrq6yd8tld6rp6z4wjwr5x96jvr7y6vqapkz2ffkk',
      },
    ];

    vectors.forEach((vector) => {
      expect(wallet.getAddress(
        vector.index,
        vector.change,
        vector.chainID,
      )).to.deep.equal(vector.address);
    });
  });

  it('Should get empty wallet details', async () => {
    expect(await wallet.getWalletDetails(1)).to.deep.equal({
      treeScannedHeights: [],
      primaryHeight: 0,
      changeHeight: 0,
    });
  });

  it('Should scan balances', async () => {
    expect(await wallet.getWalletDetails(1)).to.deep.equal({
      treeScannedHeights: [],
      primaryHeight: 0,
      changeHeight: 0,
    });

    const fillerLeaves = [{
      hash: '02',
      senderPublicKey: '',
      ciphertext: { iv: '', data: [] },
    },
    {
      hash: '04',
      senderPublicKey: '',
      ciphertext: { iv: '', data: [] },
    },
    {
      hash: '08',
      senderPublicKey: '',
      ciphertext: { iv: '', data: [] },
    },
    {
      hash: '10',
      senderPublicKey: '',
      ciphertext: { iv: '', data: [] },
    },
    {
      hash: '20',
      senderPublicKey: '',
      ciphertext: { iv: '', data: [] },
    },
    {
      hash: '40',
      senderPublicKey: '',
      ciphertext: { iv: '', data: [] },
    }];

    await merkletree.queueLeaves(0, fillerLeaves, 0);
    await wallet.scan(merkletree);

    expect(await wallet.getWalletDetails(1)).to.deep.equal({
      treeScannedHeights: [0],
      primaryHeight: 0,
      changeHeight: 0,
    });

    await merkletree.queueLeaves(1, fillerLeaves, 0);
    await merkletree.queueLeaves(2, fillerLeaves, 0);
    await wallet.scan(merkletree);

    expect(await wallet.getWalletDetails(1)).to.deep.equal({
      treeScannedHeights: [0, 0, 0],
      primaryHeight: 0,
      changeHeight: 0,
    });
  });

  afterEach(() => {
    // Clean up database
    db.level.close();
  });
});
