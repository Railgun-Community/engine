/* globals describe it beforeEach */
import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';

// @ts-ignore
import artifacts from 'railgun-artifacts';

import BN from 'bn.js';
import memdown from 'memdown';
import { Database } from '../../src/database';
import { Commitment, MerkleTree } from '../../src/merkletree';
import { Wallet } from '../../src/wallet';
import { ERC20Note } from '../../src/note';
import { babyjubjub } from '../../src/utils';
import { ERC20Transaction } from '../../src/transaction';
import { Prover, Circuits, Artifacts } from '../../src/prover';
import { config } from '../config.test';

chai.use(chaiAsPromised);
const { expect } = chai;

let db: Database;
let merkletree: MerkleTree;
let wallet: Wallet;
let transaction: ERC20Transaction;
let prover: Prover;

async function artifactsGetter(circuit: Circuits): Promise<Artifacts> {
  if (circuit === 'erc20small') {
    return artifacts.small;
  }
  return artifacts.large;
}

const testMnemonic = config.mnemonic;
const testEncryptionKey = config.encryptionKey;

const keypairs = [
  {
    // Primary 0
    privateKey: '0852ea0ca28847f125cf5c206d8f62d4dc59202477dce90988dc57d5e9b2f144',
    pubkey: 'c95956104f69131b1c269c30688d3afedd0c3a155d270e862ea4c1f89a603a1b',
    address: 'rgeth1q8y4j4ssfa53xxcuy6wrq6yd8tld6rp6z4wjwr5x96jvr7y6vqapk0tmp0s',
  },
  {
    // Primary 1
    privateKey: '0d65921bba9cd412064b41cf915266f5d9302e8bcbfd3ed8457ea914edbb01c2',
    pubkey: '6dd2398c78ea7662655bbce41224012c4948645ba12fc843f9dbb9a6b9e24005',
    address: 'rgeth1q9kaywvv0r48vcn9tw7wgy3yqykyjjrytwsjljzrl8dmnf4eufqq2qdalzf',
  },
  {
    // Primary 5
    privateKey: '0a84aed056690cf95db7a35a2f79795f3f6656203a05b35047b7cb7b6f4d27c3',
    pubkey: '49036a0ebd462c2a7e4311de737a92b6e36bd0c5505c446ec8919dfccc5d448e',
    address: 'rgeth1q9ysx6swh4rzc2n7gvgauum6j2mwx67sc4g9c3rwezgemlxvt4zgujlt072',
  },
  {
    // Change 2
    privateKey: '0ad38aeedddc5a9cbc51007ce04d1800a628cc5aea50c5c8fb4cd23c13941500',
    pubkey: 'e4fb4c45e08bf87ba679185d03b0d5de4df67b5079226eff9d7e990a30773e07',
    address: 'rgeth1q8j0knz9uz9ls7ax0yv96qas6h0ymanm2pujymhln4lfjz3swulqwn5p63t',
  },
];

const senderPubKey = '37e3984a41b34eaac002c140b28e5d080f388098a51d34237f33e84d14b9e491';

const keypairsPopulated = keypairs.map((key) => ({
  ...key,
  sharedKey: babyjubjub.ecdh(key.privateKey, senderPubKey),
}));

const notesPrep = [0];

const leaves: Commitment[] = notesPrep.map((keyIndex) => {
  const note = new ERC20Note(
    keypairsPopulated[keyIndex].pubkey,
    '1e686e7506b0f4f21d6991b4cb58d39e77c31ed0577a986750c8dce8804af5b9',
    new BN('11000000000000000000000000', 10),
    '7f4925cdf66ddf5b88016df1fe915e68eff8f192',
  );

  return {
    hash: note.hash,
    txid: '0x1097c636f99f179de275635277e458820485039b0a37088a5d657b999f73b59b',
    senderPubKey,
    ciphertext: note.encrypt(keypairsPopulated[keyIndex].sharedKey),
    revealKey: ['01', '02'], // TODO
  };
});

const notesPrep2 = [0, 1, 0, 0, 0, 0, 1, 0, 0, 1, 0];

const leaves2: Commitment[] = notesPrep2.map((keyIndex) => {
  const note = new ERC20Note(
    keypairsPopulated[keyIndex].pubkey,
    '1e686e7506b0f4f21d6991b4cb58d39e77c31ed0577a986750c8dce8804af5b9',
    new BN(1000000000000 * (keyIndex + 1)),
    '7f4925cdf66ddf5b88016df1fe915e68eff8f192',
  );

  return {
    hash: note.hash,
    txid: '0x1097c636f99f179de275635277e458820485039b0a37088a5d657b999f73b59b',
    data: note.serialize(),
  };
});

const notesPrep3 = [0, 1, 0];

const leaves3: Commitment[] = notesPrep3.map((keyIndex) => {
  const note = new ERC20Note(
    keypairsPopulated[keyIndex].pubkey,
    '1e686e7506b0f4f21d6991b4cb58d39e77c31ed0577a986750c8dce8804af5b9',
    new BN(2166666666667),
    '7f4925cdf66ddf5b88016df1fe915e68eff8f192',
  );

  return {
    hash: note.hash,
    txid: '0x1097c636f99f179de275635277e458820485039b0a37088a5d657b999f73b59b',
    data: note.serialize(),
  };
});

const notesPrep4 = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];

const leaves4: Commitment[] = notesPrep4.map((keyIndex) => {
  const note = new ERC20Note(
    keypairsPopulated[keyIndex].pubkey,
    '1e686e7506b0f4f21d6991b4cb58d39e77c31ed0577a986750c8dce8804af5b9',
    new BN(343000000000),
    '7f4925cdf66ddf5b88016df1fe915e68eff8f192',
  );

  return {
    hash: note.hash,
    txid: '0x1097c636f99f179de275635277e458820485039b0a37088a5d657b999f73b59b',
    data: note.serialize(),
  };
});

// eslint-disable-next-line func-names
describe('Transaction/ERC20', function () {
  this.timeout(120000);

  this.beforeAll(async () => {
    db = new Database(memdown());
    merkletree = new MerkleTree(db, 1, 'erc20', async () => true);
    wallet = await Wallet.fromMnemonic(
      db,
      testEncryptionKey,
      testMnemonic,
      undefined,
      "m/1984'/0'/0'",
    );
    prover = new Prover(artifactsGetter);
    wallet.loadTree(merkletree);
    await merkletree.queueLeaves(0, 0, leaves);
    await merkletree.queueLeaves(1, 0, leaves2);
    await merkletree.queueLeaves(2, 0, leaves3);
    await merkletree.queueLeaves(3, 0, leaves4);
    await wallet.scan(1);
  });

  beforeEach(async () => {
    transaction = new ERC20Transaction('7f4925cdf66ddf5b88016df1fe915e68eff8f192', 1);
  });

  it('Should calculate adaptID', async () => {
    expect(transaction.adaptIDhash).to.equal(
      'f5a5fd42d16a20302798ef6ed309979b43003d2320d9f0e8ea9831a92759fb4b',
    );

    transaction.adaptID.contract = '7f4925cdf66ddf5b88016df1fe915e68eff8f192';
    transaction.adaptID.parameters =
      '21543ad39bf8f7649d6325e44f53cbc84f501847cf42bd9fb14d63be21dcffc8';

    expect(transaction.adaptIDhash).to.equal(
      'b107d2ef47e7d68c13fd053058bafd99807941d5826cb10adf4c0103a8ff81fe',
    );
  });

  it('Should generate inputs for transaction', async () => {
    transaction.outputs = [
      new ERC20Note(
        'c95956104f69131b1c269c30688d3afedd0c3a155d270e862ea4c1f89a603a1b',
        '1bcfa32dbb44dc6a26712bc500b6373885b08a7cd73ee433072f1d410aeb4801',
        new BN(6500000000000),
        '7f4925cdf66ddf5b88016df1fe915e68eff8f192',
      ),
    ];

    const inputs = await transaction.generateInputs(wallet, testEncryptionKey);

    expect(inputs.inputs.nullifiers.length).to.equal(2);
    expect(inputs.inputs.nullifiers[0]).to.equal(
      '15f75defeb0075ee0e898acc70780d245ab1c19b33cfd2b855dd66faee94a5e0',
    );

    transaction.outputs = [
      new ERC20Note(
        'c95956104f69131b1c269c30688d3afedd0c3a155d270e862ea4c1f89a603a1b',
        '1bcfa32dbb44dc6a26712bc500b6373885b08a7cd73ee433072f1d410aeb4801',
        new BN(6500000000000),
        '7f4925cdf66ddf5b88016df1fe915e68eff8f192',
      ),
      new ERC20Note(
        'c95956104f69131b1c269c30688d3afedd0c3a155d270e862ea4c1f89a603a1b',
        '1bcfa32dbb44dc6a26712bc500b6373885b08a7cd73ee433072f1d410aeb4801',
        new BN(6500000000000),
        '7f4925cdf66ddf5b88016df1fe915e68eff8f192',
      ),
      new ERC20Note(
        'c95956104f69131b1c269c30688d3afedd0c3a155d270e862ea4c1f89a603a1b',
        '1bcfa32dbb44dc6a26712bc500b6373885b08a7cd73ee433072f1d410aeb4801',
        new BN(6500000000000),
        '7f4925cdf66ddf5b88016df1fe915e68eff8f192',
      ),
    ];

    await expect(
      transaction.generateInputs(wallet, testEncryptionKey),
    ).to.eventually.be.rejectedWith('Too many outputs specified');

    transaction.outputs = [
      new ERC20Note(
        'c95956104f69131b1c269c30688d3afedd0c3a155d270e862ea4c1f89a603a1b',
        '1bcfa32dbb44dc6a26712bc500b6373885b08a7cd73ee433072f1d410aeb4801',
        new BN(6500000000000),
        '000925cdf66ddf5b88016df1fe915e68eff8f192',
      ),
    ];

    await expect(
      transaction.generateInputs(wallet, testEncryptionKey),
    ).to.eventually.be.rejectedWith('TokenID mismatch on output 0');

    transaction.outputs = [
      new ERC20Note(
        'c95956104f69131b1c269c30688d3afedd0c3a155d270e862ea4c1f89a603a1b',
        '1bcfa32dbb44dc6a26712bc500b6373885b08a7cd73ee433072f1d410aeb4801',
        new BN('21000000000027360000000000', 10),
        '7f4925cdf66ddf5b88016df1fe915e68eff8f192',
      ),
    ];

    await expect(
      transaction.generateInputs(wallet, testEncryptionKey),
    ).to.eventually.be.rejectedWith('Wallet balance too low');

    transaction.outputs = [
      new ERC20Note(
        'c95956104f69131b1c269c30688d3afedd0c3a155d270e862ea4c1f89a603a1b',
        '1bcfa32dbb44dc6a26712bc500b6373885b08a7cd73ee433072f1d410aeb4801',
        new BN('11000000000027360000000000', 10),
        '7f4925cdf66ddf5b88016df1fe915e68eff8f192',
      ),
    ];

    await expect(
      transaction.generateInputs(wallet, testEncryptionKey),
    ).to.eventually.be.rejectedWith(
      'Balances need to be consolidated before being able to spend this amount',
    );

    const transaction2 = new ERC20Transaction('ff', 1);

    transaction2.setWithdraw(new BN(12));

    await expect(
      transaction2.generateInputs(wallet, testEncryptionKey),
    ).to.eventually.be.rejectedWith('Wallet balance too low');

    transaction.outputs = [
      new ERC20Note(
        'c95956104f69131b1c269c30688d3afedd0c3a155d270e862ea4c1f89a603a1b',
        '1bcfa32dbb44dc6a26712bc500b6373885b08a7cd73ee433072f1d410aeb4801',
        new BN(6500000000000),
        '7f4925cdf66ddf5b88016df1fe915e68eff8f192',
      ),
    ];

    transaction.withdraw = new BN(2);

    await expect(
      transaction.generateInputs(wallet, testEncryptionKey),
    ).to.eventually.be.rejectedWith('Withdraw address not set');

    transaction.withdrawAddress = '01';

    expect(
      (await transaction.generateInputs(wallet, testEncryptionKey)).inputs.nullifiers.length,
    ).to.equal(2);

    transaction.setDeposit('00');
    transaction.setWithdraw('00');

    await expect(
      transaction.generateInputs(wallet, testEncryptionKey),
    ).to.eventually.be.rejectedWith("Withdraw shouldn't be set");
  });

  it('Should create transaction proofs', async () => {
    transaction.outputs = [
      new ERC20Note(
        'c95956104f69131b1c269c30688d3afedd0c3a155d270e862ea4c1f89a603a1b',
        '1bcfa32dbb44dc6a26712bc500b6373885b08a7cd73ee433072f1d410aeb4801',
        new BN(6500000000000),
        '7f4925cdf66ddf5b88016df1fe915e68eff8f192',
      ),
    ];

    const tx = await transaction.prove(prover, wallet, testEncryptionKey);

    expect(tx.nullifiers.length).to.equal(2);

    transaction.outputs = [
      new ERC20Note(
        'c95956104f69131b1c269c30688d3afedd0c3a155d270e862ea4c1f89a603a1b',
        '1bcfa32dbb44dc6a26712bc500b6373885b08a7cd73ee433072f1d410aeb4801',
        new BN(1715000000000),
        '7f4925cdf66ddf5b88016df1fe915e68eff8f192',
      ),
    ];

    transaction.tree = 3;

    const tx2 = await transaction.prove(prover, wallet, testEncryptionKey);

    expect(tx2.nullifiers.length).to.equal(10);
  });

  it('Should create dummy transaction proofs', async () => {
    transaction.outputs = [
      new ERC20Note(
        'c95956104f69131b1c269c30688d3afedd0c3a155d270e862ea4c1f89a603a1b',
        '1bcfa32dbb44dc6a26712bc500b6373885b08a7cd73ee433072f1d410aeb4801',
        new BN(6500000000000),
        '7f4925cdf66ddf5b88016df1fe915e68eff8f192',
      ),
    ];

    const tx = await transaction.prove(prover, wallet, testEncryptionKey);

    expect(tx.nullifiers.length).to.equal(2);

    transaction.outputs = [
      new ERC20Note(
        'c95956104f69131b1c269c30688d3afedd0c3a155d270e862ea4c1f89a603a1b',
        '1bcfa32dbb44dc6a26712bc500b6373885b08a7cd73ee433072f1d410aeb4801',
        new BN(1715000000000),
        '7f4925cdf66ddf5b88016df1fe915e68eff8f192',
      ),
    ];

    transaction.tree = 3;

    const tx2 = await transaction.dummyProve(wallet, testEncryptionKey);

    expect(tx2.nullifiers.length).to.equal(10);
  });

  // it('Generator', async () => {
  //   const dblocal = new Database(memdown());
  //   const merkletreelocal = new MerkleTree(dblocal, 1, 'erc20', async () => true);
  //   const walletlocal = await Wallet.fromMnemonic(dblocal, testEncryptionKey, testMnemonic);
  //   const proverlocal = new Prover(artifactsGetter);

  //   const note = new ERC20Note(
  //     'c95956104f69131b1c269c30688d3afedd0c3a155d270e862ea4c1f89a603a1b',
  //     '1e686e7506b0f4f21d6991b4cb58d39e77c31ed0577a986750c8dce8804af5b9',
  //     new BN('11000000000000000000000000', 10),
  //     '5FbDB2315678afecb367f032d93F642f64180aa3',
  //   );

  //   walletlocal.loadTree(merkletreelocal);

  //   const encryptionKey = babyjubjub.ecdh(
  //     '0852ea0ca28847f125cf5c206d8f62d4dc59202477dce90988dc57d5e9b2f144',
  //     'c95956104f69131b1c269c30688d3afedd0c3a155d270e862ea4c1f89a603a1b',
  //   );

  //   await merkletreelocal.queueLeaves(0, 0, [
  //     {
  //       hash: note.hash,
  //       txid: '0x1097c636f99f179de275635277e458820485039b0a37088a5d657b999f73b59b',
  //       senderPubKey: 'c95956104f69131b1c269c30688d3afedd0c3a155d270e862ea4c1f89a603a1b',
  //       ciphertext: note.encrypt(encryptionKey),
  //     },
  //   ]);
  //   await walletlocal.scan(1);

  //   const transactionlocal = new ERC20Transaction('5FbDB2315678afecb367f032d93F642f64180aa3', 1);

  //   transactionlocal.outputs = [
  //     new ERC20Note(
  //       'c95956104f69131b1c269c30688d3afedd0c3a155d270e862ea4c1f89a603a1b',
  //       '1bcfa32dbb44dc6a26712bc500b6373885b08a7cd73ee433072f1d410aeb4801',
  //       'ffff',
  //       '5FbDB2315678afecb367f032d93F642f64180aa3',
  //     ),
  //   ];

  //   const tx = await transactionlocal.prove(proverlocal, walletlocal, testEncryptionKey);

  //   console.log(JSON.stringify(tx, null, '  '));
  // });

  this.afterAll(() => {
    // Clean up database
    wallet.unloadTree(merkletree.chainID);
    db.close();
  });
});
