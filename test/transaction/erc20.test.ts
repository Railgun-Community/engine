/* eslint-disable @typescript-eslint/no-unused-vars */
/* globals describe it beforeEach */
import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';

import BN from 'bn.js';
import memdown from 'memdown';
import { Wallet as EthersWallet } from '@ethersproject/wallet';
import { walkUpBindingElementsAndPatterns } from 'typescript';
import { Database } from '../../src/database';
import { Commitment, MerkleTree } from '../../src/merkletree';
import { getMasterPublicKey, Wallet } from '../../src/wallet';
import { Deposit, Note, WithdrawNote } from '../../src/note';
import { babyjubjub } from '../../src/utils';
import { Transaction } from '../../src/transaction';
import { Prover } from '../../src/prover';
import { config } from '../config.test';
import { artifactsGetter } from '../helper';

chai.use(chaiAsPromised);
const { expect } = chai;

let db: Database;
let merkletree: MerkleTree;
let wallet: Wallet;
let chainID: number;
let ethersWallet: EthersWallet;
let transaction: Transaction;
let deposit: Deposit;
let withdraw: WithdrawNote;
let masterPublicKey: string;
let prover: Prover;

const testMnemonic = config.mnemonic;
const testEncryptionKey = config.encryptionKey;

const token = '0x7f4925cdf66ddf5b88016df1fe915e68eff8f192';
const random = '0x1e686e7506b0f4f21d6991b4cb58d39e77c31ed0577a986750c8dce8804af5b9';
const txid = '0x1097c636f99f179de275635277e458820485039b0a37088a5d657b999f73b59b';
type makeNoteFn = (value?: bigint) => Note;
let makeNote: makeNoteFn;

const keypairs = [
  {
    // Primary 0
    privateKey: '0852ea0ca28847f125cf5c206d8f62d4dc59202477dce90988dc57d5e9b2f144',
    pubkey: '0xc95956104f69131b1c269c30688d3afedd0c3a155d270e862ea4c1f89a603a1b',
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

const getTestData = () => {
  const keypairsPopulated = keypairs.map((key) => ({
    ...key,
    sharedKey: babyjubjub.ecdh(key.privateKey, senderPubKey),
  }));

  const notesPrep = [0];

  const leaves = notesPrep.map((keyIndex) => {
    const note = new Note(
      keypairsPopulated[keyIndex].pubkey,
      random,
      '11000000000000000000000000',
      token,
    );

    return {
      hash: note.hash,
      txid: '0x1097c636f99f179de275635277e458820485039b0a37088a5d657b999f73b59b',
      senderPubKey,
      ciphertext: { ciphertext: note.encrypt(keypairsPopulated[keyIndex].sharedKey) },
      revealKey: ['01', '02'], // TODO
    };
  });

  const notesPrep2 = [0, 1, 0, 0, 0, 0, 1, 0, 0, 1, 0];

  const leaves2 = notesPrep2.map((keyIndex) => {
    const note = new Note(
      keypairsPopulated[keyIndex].pubkey,
      random,
      1000000000000n * BigInt(keyIndex + 1),
      token,
    );

    return {
      hash: note.hash,
      txid: '0x1097c636f99f179de275635277e458820485039b0a37088a5d657b999f73b59b',
      data: note.serialize(keypairsPopulated[keyIndex].privateKey),
    };
  });

  const notesPrep3 = [0, 1, 0];

  const leaves3 = notesPrep3.map((keyIndex) => {
    const note = new Note(keypairsPopulated[keyIndex].pubkey, random, 2166666666667n, token);

    return {
      hash: note.hash,
      txid: '0x1097c636f99f179de275635277e458820485039b0a37088a5d657b999f73b59b',
      data: note.serialize(keypairsPopulated[keyIndex].privateKey),
    };
  });

  const notesPrep4 = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];

  const leaves4 = notesPrep4.map((keyIndex) => {
    const note = new Note(keypairsPopulated[keyIndex].pubkey, random, 343000000000n, token);

    return {
      hash: note.hash,
      txid: '0x1097c636f99f179de275635277e458820485039b0a37088a5d657b999f73b59b',
      data: note.serialize(keypairsPopulated[keyIndex].privateKey),
    };
  });
  return {
    keypairsPopulated,
    leaves,
    leaves2,
    leaves3,
    leaves4,
  };
};

let testData: any;

const depositLeaf = {
  hash: '14308448bcb19ecff96805fe3d00afecf82b18fa6f8297b42cf2aadc23f412e6',
  txid: '0x0543be0699a7eac2b75f23b33d435aacaeb0061f63e336230bcc7559a1852f33',
  data: {
    npk: '0xc24ea33942c0fb9acce5dbada73137ad3257a6f2e1be8f309c1fe9afc5410a',
    token: {
      tokenType: '0',
      tokenAddress: '0x5FbDB2315678afecb367f032d93F642f64180aa3',
      tokenSubID: '0',
    },
    hash: '14308448bcb19ecff96805fe3d00afecf82b18fa6f8297b42cf2aadc23f412e6',
    value: '9138822709a9fc231cba6',
    encryptedRandom: [
      '0xa51425928f4d6be74808a67732a56085e53d58e18b91faed635049462aab883e',
      '0x26e8e14696fe12fe8279764a0d8f22a9703ebc366b53a0cc253aa26c7b9bf884',
    ],
  },
};

// eslint-disable-next-line func-names
describe('Transaction/ERC20', function () {
  this.timeout(120000);
  this.beforeAll(async () => {
    db = new Database(memdown());
    chainID = 1;
    merkletree = new MerkleTree(db, chainID, 'erc20', async () => true);
    wallet = await Wallet.fromMnemonic(db, testEncryptionKey, testMnemonic, 0);
    ethersWallet = EthersWallet.fromMnemonic(testMnemonic);
    prover = new Prover(artifactsGetter);
    masterPublicKey = wallet.masterPublicKey;
    wallet.loadTree(merkletree);
    testData = getTestData();
    makeNote = (value: bigint = 6500000000000n): Note =>
      new Note(masterPublicKey, random, value, token);
    await merkletree.queueLeaves(0, 0, [depositLeaf]);
    // await merkletree.queueLeaves(1, 0, testData.leaves2);
    // await merkletree.queueLeaves(2, 0, testData.leaves3);
    // await merkletree.queueLeaves(3, 0, testData.leaves4);
    // await wallet.scan(1, chainID);
  });

  beforeEach(async () => {
    deposit = new Deposit(masterPublicKey, random, 10n ** 18n, token);
    transaction = new Transaction(token, 1);
  });

  it('Should generate inputs for transaction', async () => {
    // @todo insert leaf of deposit
    transaction.outputs = [makeNote()];

    const inputs = await transaction.generateInputs(wallet, testEncryptionKey);

    expect(inputs.publicInputs.nullifiers.length).to.equal(2);
    expect(inputs.publicInputs.nullifiers[0]).to.equal(
      '15f75defeb0075ee0e898acc70780d245ab1c19b33cfd2b855dd66faee94a5e0',
    );

    transaction.outputs = [makeNote(), makeNote(), makeNote()];

    await expect(
      transaction.generateInputs(wallet, testEncryptionKey),
    ).to.eventually.be.rejectedWith('Too many outputs specified');

    transaction.outputs = [
      new Note(masterPublicKey, random, 6500000000000n, '000925cdf66ddf5b88016df1fe915e68eff8f192'),
    ];

    await expect(
      transaction.generateInputs(wallet, testEncryptionKey),
    ).to.eventually.be.rejectedWith('TokenID mismatch on output 0');

    transaction.outputs = [makeNote(21000000000027360000000000n)];

    await expect(
      transaction.generateInputs(wallet, testEncryptionKey),
    ).to.eventually.be.rejectedWith('Wallet balance too low');

    transaction.outputs = [makeNote(11000000000027360000000000n)];

    await expect(
      transaction.generateInputs(wallet, testEncryptionKey),
    ).to.eventually.be.rejectedWith(
      'Balances need to be consolidated before being able to spend this amount',
    );

    const transaction2 = new Transaction('ff', 1);

    transaction2.withdraw(await ethersWallet.getAddress(), 12n);

    await expect(
      transaction2.generateInputs(wallet, testEncryptionKey),
    ).to.eventually.be.rejectedWith('Wallet balance too low');

    transaction.outputs = [makeNote()];

    transaction.withdraw(await ethersWallet.getAddress(), 2n);

    await expect(
      transaction.generateInputs(wallet, testEncryptionKey),
    ).to.eventually.be.rejectedWith('Withdraw address not set');

    transaction.withdrawAddress = '01';

    expect(
      (await transaction.generateInputs(wallet, testEncryptionKey)).publicInputs.nullifiers.length,
    ).to.equal(2);

    // transaction.setDeposit('00');
    // transaction.setWithdraw('00');

    await expect(
      transaction.generateInputs(wallet, testEncryptionKey),
    ).to.eventually.be.rejectedWith("Withdraw shouldn't be set");
  });

  it('Should create transaction proofs', async () => {
    transaction.outputs = [makeNote()];

    const tx = await transaction.prove(prover, wallet, testEncryptionKey);

    expect(tx.nullifiers.length).to.equal(2);

    transaction.outputs = [makeNote(1715000000000n)];

    transaction.tree = 3;

    const tx2 = await transaction.prove(prover, wallet, testEncryptionKey);

    expect(tx2.nullifiers.length).to.equal(10);
  });

  it('Should create dummy transaction proofs', async () => {
    transaction.outputs = [makeNote()];

    const tx = await transaction.prove(prover, wallet, testEncryptionKey);

    expect(tx.nullifiers.length).to.equal(2);

    transaction.outputs = [makeNote(1715000000000n)];

    transaction.tree = 3;

    const tx2 = await transaction.dummyProve(wallet, testEncryptionKey);

    expect(tx2.nullifiers.length).to.equal(10);
  });

  // it('Generator', async () => {
  //   const dblocal = new Database(memdown());
  //   const merkletreelocal = new MerkleTree(dblocal, 1, 'erc20', async () => true);
  //   const walletlocal = await Wallet.fromMnemonic(dblocal, testEncryptionKey, testMnemonic);
  //   const proverlocal = new Prover(artifactsGetter);

  //   const note = new Note(
  //     '0xc95956104f69131b1c269c30688d3afedd0c3a155d270e862ea4c1f89a603a1b',
  //     '0x1e686e7506b0f4f21d6991b4cb58d39e77c31ed0577a986750c8dce8804af5b9',
  //     new BN('11000000000000000000000000', 10),
  //     '5FbDB2315678afecb367f032d93F642f64180aa3',
  //   );

  //   walletlocal.loadTree(merkletreelocal);

  //   const encryptionKey = babyjubjub.ecdh(
  //     '0852ea0ca28847f125cf5c206d8f62d4dc59202477dce90988dc57d5e9b2f144',
  //     '0xc95956104f69131b1c269c30688d3afedd0c3a155d270e862ea4c1f89a603a1b',
  //   );

  //   await merkletreelocal.queueLeaves(0, 0, [
  //     {
  //       hash: note.hash,
  //       txid: '0x1097c636f99f179de275635277e458820485039b0a37088a5d657b999f73b59b',
  //       senderPubKey: '0xc95956104f69131b1c269c30688d3afedd0c3a155d270e862ea4c1f89a603a1b',
  //       ciphertext: note.encrypt(encryptionKey),
  //     },
  //   ]);
  //   await walletlocal.scan(1);

  //   const transactionlocal = new ERC20Transaction('5FbDB2315678afecb367f032d93F642f64180aa3', 1);

  //   transactionlocal.outputs = [
  //     new Note(
  //       '0xc95956104f69131b1c269c30688d3afedd0c3a155d270e862ea4c1f89a603a1b',
  //       '0x1bcfa32dbb44dc6a26712bc500b6373885b08a7cd73ee433072f1d410aeb4801',
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
