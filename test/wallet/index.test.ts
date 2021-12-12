/* globals describe it beforeEach afterEach */
import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';

import memdown from 'memdown';
import { Database } from '../../src/database';
import { MerkleTree } from '../../src/merkletree';
import { ERC20Note } from '../../src/note';
import { babyjubjub } from '../../src/utils';

import { Wallet } from '../../src/wallet';

import type { Commitment } from '../../src/merkletree';

chai.use(chaiAsPromised);
const { expect } = chai;

let db: Database;
let merkletree: MerkleTree;
let wallet: Wallet;

const testMnemonic = 'test test test test test test test test test test test junk';
const testEncryptionKey = '01';

const keypairs = [{ // Primary 0
  privateKey: '0852ea0ca28847f125cf5c206d8f62d4dc59202477dce90988dc57d5e9b2f144',
  publicKey: 'c95956104f69131b1c269c30688d3afedd0c3a155d270e862ea4c1f89a603a1b',
  address: 'rgeth1q8y4j4ssfa53xxcuy6wrq6yd8tld6rp6z4wjwr5x96jvr7y6vqapk0tmp0s',
},
{ // Primary 1
  privateKey: '0d65921bba9cd412064b41cf915266f5d9302e8bcbfd3ed8457ea914edbb01c2',
  publicKey: '6dd2398c78ea7662655bbce41224012c4948645ba12fc843f9dbb9a6b9e24005',
  address: 'rgeth1q9kaywvv0r48vcn9tw7wgy3yqykyjjrytwsjljzrl8dmnf4eufqq2qdalzf',
},
{ // Primary 5
  privateKey: '0a84aed056690cf95db7a35a2f79795f3f6656203a05b35047b7cb7b6f4d27c3',
  publicKey: '49036a0ebd462c2a7e4311de737a92b6e36bd0c5505c446ec8919dfccc5d448e',
  address: 'rgeth1q9ysx6swh4rzc2n7gvgauum6j2mwx67sc4g9c3rwezgemlxvt4zgujlt072',
},
{ // Change 2
  privateKey: '0ad38aeedddc5a9cbc51007ce04d1800a628cc5aea50c5c8fb4cd23c13941500',
  publicKey: 'e4fb4c45e08bf87ba679185d03b0d5de4df67b5079226eff9d7e990a30773e07',
  address: 'rgeth1q8j0knz9uz9ls7ax0yv96qas6h0ymanm2pujymhln4lfjz3swulqwn5p63t',
}];

const senderPublicKey = '37e3984a41b34eaac002c140b28e5d080f388098a51d34237f33e84d14b9e491';

const keypairsPopulated = keypairs.map((key) => ({
  ...key,
  sharedKey: babyjubjub.ecdh(key.privateKey, senderPublicKey),
}));

const notesPrep = [
  0, 1, 2, 3, 2, 0,
];

const leaves: Commitment[] = notesPrep.map((keyIndex) => {
  const note = new ERC20Note(
    keypairsPopulated[keyIndex].publicKey,
    '1e686e7506b0f4f21d6991b4cb58d39e77c31ed0577a986750c8dce8804af5b9',
    'ffff',
    '7f4925cdf66ddf5b88016df1fe915e68eff8f192',
  );

  return {
    hash: note.hash,
    txid: '0x1097c636f99f179de275635277e458820485039b0a37088a5d657b999f73b59b',
    senderPublicKey,
    ciphertext: note.encrypt(keypairsPopulated[keyIndex].sharedKey),
  };
});

const notesPrep2 = [
  0, 1, 2, 3, 2, 0,
];

const leaves2: Commitment[] = notesPrep2.map((keyIndex) => {
  const note = new ERC20Note(
    keypairsPopulated[keyIndex].publicKey,
    '1e686e7506b0f4f21d6991b4cb58d39e77c31ed0577a986750c8dce8804af5b9',
    'ffff',
    '7f4925cdf66ddf5b88016df1fe915e68eff8f192',
  );

  return {
    hash: note.hash,
    txid: '0x1097c636f99f179de275635277e458820485039b0a37088a5d657b999f73b59b',
    data: note.serialize(),
  };
});

describe('Wallet/Index', () => {
  beforeEach(async () => {
    // Create database and wallet
    db = new Database(memdown());
    merkletree = new MerkleTree(db, 1, 'erc20', async () => true);
    wallet = await Wallet.fromMnemonic(db, testEncryptionKey, testMnemonic);
    wallet.loadTree(merkletree);
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

  it('Should get wallet details path', async () => {
    expect(wallet.getWalletDetailsPath()).to.deep.equal([
      '000000000000000000000000000000000000000000000000000077616c6c6574',
      'c9855eb0e997395c2e4e2ada52487860509e0daf2ef8f74a6fe7ded9853efa42',
      '0000000000000000000000000000000000000000000000000000000000000000',
    ]);
  });

  it('Should get keypairs', async () => {
    expect(wallet.getKeypair(testEncryptionKey, 0, false)).to.deep.equal({
      address: 'rgany1q8y4j4ssfa53xxcuy6wrq6yd8tld6rp6z4wjwr5x96jvr7y6vqapkz2ffkk',
      privateKey: '0852ea0ca28847f125cf5c206d8f62d4dc59202477dce90988dc57d5e9b2f144',
      publicKey: 'c95956104f69131b1c269c30688d3afedd0c3a155d270e862ea4c1f89a603a1b',
    });
    expect(() => { wallet.getKeypair('111111', 0, false); }).to.throw('Wrong encryption key');
  });

  it('Should get addresses', async () => {
    expect(await wallet.addresses(0)).to.deep.equal([
      'rgany1q8y4j4ssfa53xxcuy6wrq6yd8tld6rp6z4wjwr5x96jvr7y6vqapkz2ffkk',
      'rgany1q9kaywvv0r48vcn9tw7wgy3yqykyjjrytwsjljzrl8dmnf4eufqq2dv0hm0',
      'rgany1qyzzx3d36h7q9d6l68jd86h8egen0vnw2hkv8rv7w7fep2md8kyfvmm50s2',
      'rgany1qyaf5xkrufh0y8wx6yer7skpfd0u9yfludk65ulp3d9ut4ramlf2jd9z4v3',
      'rgany1q8x0yspfamxvdykkf8upnjt7jr0h2hs86mwq0jarszkp7utd0j0s67er68c',
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
        index: 1,
        change: false,
        chainID: 1,
        address: 'rgeth1q9kaywvv0r48vcn9tw7wgy3yqykyjjrytwsjljzrl8dmnf4eufqq2qdalzf',
      },
      {
        index: 5,
        change: false,
        chainID: 1,
        address: 'rgeth1q9ysx6swh4rzc2n7gvgauum6j2mwx67sc4g9c3rwezgemlxvt4zgujlt072',
      },
      {
        index: 2,
        change: true,
        chainID: 1,
        address: 'rgeth1q8j0knz9uz9ls7ax0yv96qas6h0ymanm2pujymhln4lfjz3swulqwn5p63t',
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
    expect(await wallet.getWalletDetails()).to.deep.equal({
      treeScannedHeights: [],
      primaryHeight: 0,
      changeHeight: 0,
    });
  });

  it('Should scan ERC20 balances', async () => {
    await merkletree.queueLeaves(0, 0, leaves);

    const process = wallet.scan(1);

    // Should respect scan lock
    wallet.scan(1);
    await process;

    expect(await wallet.getWalletDetails()).to.deep.equal({
      treeScannedHeights: [5],
      primaryHeight: 5,
      changeHeight: 2,
    });

    await merkletree.queueLeaves(0, 6, leaves2);

    await wallet.scan(1);

    expect(await wallet.getWalletDetails()).to.deep.equal({
      treeScannedHeights: [11],
      primaryHeight: 5,
      changeHeight: 2,
    });

    const balances = await wallet.balances(1);

    expect(balances['0000000000000000000000007f4925cdf66ddf5b88016df1fe915e68eff8f192'].utxos.length)
      .to.equal(12);

    expect(
      balances['0000000000000000000000007f4925cdf66ddf5b88016df1fe915e68eff8f192'].balance.eqn(786420),
    ).to.equal(true);

    await merkletree.nullify([{
      txid: '000001',
      nullifier: '15f75defeb0075ee0e898acc70780d245ab1c19b33cfd2b855dd66faee94a5e0',
    }]);

    const balances2 = await wallet.balances(1);

    expect(balances2['0000000000000000000000007f4925cdf66ddf5b88016df1fe915e68eff8f192'].utxos.length)
      .to.equal(11);

    expect(
      balances2['0000000000000000000000007f4925cdf66ddf5b88016df1fe915e68eff8f192'].balance.eqn(720885),
    ).to.equal(true);

    await merkletree.nullify([{
      txid: '000001',
      nullifier: '1c3ba503ad9e144683649756ce1e9a919afb56d836988435c1528ea8942f286e',
    }]);

    const balances3 = await wallet.balances(1);

    expect(balances3['0000000000000000000000007f4925cdf66ddf5b88016df1fe915e68eff8f192'].utxos.length)
      .to.equal(10);

    expect(
      balances3['0000000000000000000000007f4925cdf66ddf5b88016df1fe915e68eff8f192'].balance.eqn(655350),
    ).to.equal(true);

    expect((await wallet.balancesByTree(1))['0000000000000000000000007f4925cdf66ddf5b88016df1fe915e68eff8f192'][0].utxos.length).to.equal(10);
  }).timeout(60000);

  afterEach(() => {
    // Clean up database
    wallet.unloadTree(merkletree.chainID);
    db.close();
  });
});
