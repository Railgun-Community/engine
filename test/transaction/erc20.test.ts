/* eslint-disable @typescript-eslint/no-unused-vars */
/* globals describe it beforeEach */
import chai, { assert } from 'chai';
import chaiAsPromised from 'chai-as-promised';

import memdown from 'memdown';
import { Wallet as EthersWallet } from '@ethersproject/wallet';
import { hexToBytes } from 'ethereum-cryptography/utils';
import { Signature } from 'circomlib';
import { Database } from '../../src/database';
import { MerkleTree } from '../../src/merkletree';
import { Wallet } from '../../src/wallet';
import { Note } from '../../src/note';
import { bytes, keysUtils } from '../../src/utils';
import { Transaction } from '../../src/transaction';
import { Prover } from '../../src/prover';
import { config } from '../config.test';
import { artifactsGetter, DECIMALS_18 } from '../helper';
import { hashBoundParams } from '../../src/transaction/transaction';
import { formatToByteLength } from '../../src/utils/bytes';
import { AddressData } from '../../src/keyderivation/bech32-encode';
import { getEphemeralKeys, getSharedSymmetricKey, poseidon } from '../../src/utils/keys-utils';
import { TokenType } from '../../src/models/transaction-types';

chai.use(chaiAsPromised);
const { expect } = chai;

let db: Database;
let merkletree: MerkleTree;
let wallet: Wallet;
let chainID: number;
let ethersWallet: EthersWallet;
let transaction: Transaction;
let prover: Prover;
let address: AddressData;

const testMnemonic = config.mnemonic;
const testEncryptionKey = config.encryptionKey;

const token = '0x5FbDB2315678afecb367f032d93F642f64180aa3';
const random = bytes.random(16);
type makeNoteFn = (value?: bigint) => Note;
let makeNote: makeNoteFn;

// const keypairs = [
//   {
//     // Primary 0
//     privateKey: hexToBytes('0852ea0ca28847f125cf5c206d8f62d4dc59202477dce90988dc57d5e9b2f144'),
//     pubkey: hexToBytes('c95956104f69131b1c269c30688d3afedd0c3a155d270e862ea4c1f89a603a1b'),
//     address: 'rgeth1q8y4j4ssfa53xxcuy6wrq6yd8tld6rp6z4wjwr5x96jvr7y6vqapk0tmp0s',
//   },
//   {
//     // Primary 1
//     privateKey: hexToBytes('0d65921bba9cd412064b41cf915266f5d9302e8bcbfd3ed8457ea914edbb01c2'),
//     pubkey: hexToBytes('6dd2398c78ea7662655bbce41224012c4948645ba12fc843f9dbb9a6b9e24005'),
//     address: 'rgeth1q9kaywvv0r48vcn9tw7wgy3yqykyjjrytwsjljzrl8dmnf4eufqq2qdalzf',
//   },
//   {
//     // Primary 5
//     privateKey: hexToBytes('0a84aed056690cf95db7a35a2f79795f3f6656203a05b35047b7cb7b6f4d27c3'),
//     pubkey: hexToBytes('49036a0ebd462c2a7e4311de737a92b6e36bd0c5505c446ec8919dfccc5d448e'),
//     address: 'rgeth1q9ysx6swh4rzc2n7gvgauum6j2mwx67sc4g9c3rwezgemlxvt4zgujlt072',
//   },
//   {
//     // Change 2
//     privateKey: hexToBytes('0ad38aeedddc5a9cbc51007ce04d1800a628cc5aea50c5c8fb4cd23c13941500'),
//     pubkey: hexToBytes('e4fb4c45e08bf87ba679185d03b0d5de4df67b5079226eff9d7e990a30773e07'),
//     address: 'rgeth1q8j0knz9uz9ls7ax0yv96qas6h0ymanm2pujymhln4lfjz3swulqwn5p63t',
//   },
// ];

const depositLeaf = {
  hash: '10c139398677d31020ddf97e0c73239710c956a52a7ea082a1e84815582bfb5f',
  txid: '0xc97a2d06ceb87f81752bd58310e4aca822ae18a747e4dde752020e0b308a3aee',
  preImage: {
    npk: '1d73bae2faf4ff18e1cd22d22cb9c05bc08878dc8fa4907257ce1a7ad51933f7',
    token: {
      tokenAddress: '0x5fbdb2315678afecb367f032d93f642f64180aa3',
      tokenType: TokenType.ERC20,
      tokenSubID: '0x0000000000000000000000000000000000000000',
    },
    value: '000000000000021cbfcc6fd98333b5f1',
  },
  encryptedRandom: [
    '0x7797f244fc1c60af03f25cbe9a798080b920733cc2de2456af21ee7c9eb1ca0c',
    '0x118beef50353ab8512be871c0473e219',
  ] as [string, string],
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
    address = wallet.addressKeys;
    wallet.loadTree(merkletree);
    // testData = getTestData();
    makeNote = (value: bigint = 65n * DECIMALS_18): Note => new Note(address, random, value, token);
    merkletree.validateRoot = () => true;
    await merkletree.queueLeaves(0, 0, [depositLeaf]); // start with a deposit
    await wallet.scan(chainID);
    // await merkletree.queueLeaves(1, 0, testData.leaves2);
    // await merkletree.queueLeaves(2, 0, testData.leaves3);
    // await merkletree.queueLeaves(3, 0, testData.leaves4);
    // await wallet.scan(1, chainID);
  });

  beforeEach(async () => {
    // deposit = new ERC20Deposit(masterPublicKey, random, DECIMALS_18, token);
    transaction = new Transaction(token, TokenType.ERC20, 1);
  });

  it('Should hash bound parameters', async () => {
    const params = {
      treeNumber: BigInt(0),
      withdraw: BigInt(0),
      adaptContract: formatToByteLength('00', 20, true),
      adaptParams: formatToByteLength('00', 32, true), //
      commitmentCiphertext: [
        {
          ciphertext: [0n, BigInt(0), BigInt(0), BigInt(0)],
          ephemeralKeys: [0n, BigInt(0)],
          memo: [],
        },
      ],
    };
    const hashed = hashBoundParams(params);
    assert.typeOf(hashed, 'bigint');
  });

  it('Should generate ciphertext decryptable by sender and recipient', async () => {
    const wallet2 = await Wallet.fromMnemonic(db, testEncryptionKey, testMnemonic, 1);
    const note = new Note(wallet2.addressKeys, random, 100n, token);

    const sender = wallet.getViewingKeyPair();
    const receiver = wallet2.getViewingKeyPair();

    assert.isTrue(note.viewingPublicKey === receiver.pubkey);
    const ephemeralKeys = await getEphemeralKeys(sender.pubkey, note.viewingPublicKey);

    const senderShared = await getSharedSymmetricKey(sender.privateKey, ephemeralKeys[1]);
    const receiverShared = await getSharedSymmetricKey(receiver.privateKey, ephemeralKeys[0]);

    const encryptedNote = note.encrypt(senderShared);

    const senderDecrypted = Note.decrypt(encryptedNote, senderShared);
    expect(senderDecrypted.hash).to.equal(note.hash);
    const receiverDecrypted = Note.decrypt(encryptedNote, receiverShared);
    expect(receiverDecrypted.hash).to.equal(note.hash);
  });

  it('Should generate a valid signature for transaction', async () => {
    transaction.outputs = [makeNote()];

    const { inputs, publicInputs } = await transaction.generateInputs(wallet, testEncryptionKey);
    const { signature } = inputs;
    const { privateKey, pubkey } = await wallet.getSpendingKeyPair(testEncryptionKey);
    const msg = poseidon(Object.values(publicInputs).flatMap((x) => x));
    const sig: Signature = { R8: [signature[0], signature[1]], S: signature[2] };

    assert.isTrue(keysUtils.verifyEDDSA(msg, sig, pubkey));

    expect(sig).to.deep.equal(keysUtils.signEDDSA(privateKey, msg));
  });

  it('Should generate inputs for transaction', async () => {
    transaction.outputs = [makeNote()];

    const { publicInputs } = await transaction.generateInputs(wallet, testEncryptionKey);
    const { nullifiers, commitmentsOut } = publicInputs;
    expect(nullifiers.length).to.equal(1);
    expect(commitmentsOut.length).to.equal(2);

    transaction.outputs = [makeNote(), makeNote(), makeNote(), makeNote()];

    await expect(
      transaction.generateInputs(wallet, testEncryptionKey),
    ).to.eventually.be.rejectedWith('Too many outputs specified');

    transaction.outputs = [
      new Note(address, random, 6500000000000n, '000925cdf66ddf5b88016df1fe915e68eff8f192'),
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
    ).to.eventually.be.rejectedWith('Wallet balance too low');

    const transaction2 = new Transaction('ff', TokenType.ERC20, 1);

    transaction2.withdraw(await ethersWallet.getAddress(), 12n);

    await expect(
      transaction2.generateInputs(wallet, testEncryptionKey),
    ).to.eventually.be.rejectedWith(`Failed to find balances for ${transaction2.token}`);

    transaction.outputs = [makeNote()];

    transaction.withdraw(await ethersWallet.getAddress(), 2n, '01');

    expect(
      (await transaction.generateInputs(wallet, testEncryptionKey)).publicInputs.nullifiers.length,
    ).to.equal(1);

    // transaction.setDeposit('00');
    // transaction.setWithdraw('00');

    /*
    await expect(
      transaction.generateInputs(wallet, testEncryptionKey),
    ).to.eventually.be.rejectedWith("Withdraw shouldn't be set");
    */
  });

  it('Should create transaction proofs', async () => {
    transaction.outputs = [makeNote(1n)];
    const tx = await transaction.prove(prover, wallet, testEncryptionKey);
    expect(tx.nullifiers.length).to.equal(1);
    expect(tx.commitments.length).to.equal(2);

    transaction.outputs = [makeNote(1715000000000n)];

    // transaction.tree = 3;

    const tx2 = await transaction.prove(prover, wallet, testEncryptionKey);

    expect(tx2.nullifiers.length).to.equal(1);
  });

  it('Should create dummy transaction proofs', async () => {
    transaction.outputs = [makeNote()];
    const tx = await transaction.prove(prover, wallet, testEncryptionKey);
    expect(tx.nullifiers.length).to.equal(1);
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
