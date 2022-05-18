/* eslint-disable @typescript-eslint/no-unused-vars */
/* globals describe it beforeEach */
import { Wallet as EthersWallet } from '@ethersproject/wallet';
import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import memdown from 'memdown';
import { Database } from '../../src/database';
import { AddressData } from '../../src/keyderivation/bech32-encode';
import { MerkleTree } from '../../src/merkletree';
import { Commitment, TokenType } from '../../src/models/formatted-types';
import { Note } from '../../src/note';
import { Prover } from '../../src/prover';
import { TransactionBatch } from '../../src/transaction/transaction-batch';
import { bytes } from '../../src/utils';
import { Wallet } from '../../src/wallet';
import { config } from '../config.test';
import { artifactsGetter, DECIMALS_18 } from '../helper';

chai.use(chaiAsPromised);
const { expect } = chai;

let db: Database;
let merkletree: MerkleTree;
let wallet: Wallet;
let chainID: number;
let ethersWallet: EthersWallet;
let transactionBatch: TransactionBatch;
let prover: Prover;
let address: AddressData;

const testMnemonic = config.mnemonic;
const testEncryptionKey = config.encryptionKey;

const token = '0x5FbDB2315678afecb367f032d93F642f64180aa3';
const random = bytes.random(16);
type makeNoteFn = (value?: bigint) => Note;
let makeNote: makeNoteFn;

const depositLeaf = (txid: string): Commitment => ({
  txid,
  hash: '10c139398677d31020ddf97e0c73239710c956a52a7ea082a1e84815582bfb5f',
  preImage: {
    npk: '1d73bae2faf4ff18e1cd22d22cb9c05bc08878dc8fa4907257ce1a7ad51933f7',
    token: {
      tokenAddress: '0x5fbdb2315678afecb367f032d93f642f64180aa3',
      tokenType: TokenType.ERC20,
      tokenSubID: '0x0000000000000000000000000000000000000000',
    },
    value: '000000000000021cbfcc6fd98333b5f1', // 9975062344139650872817n
  },
  encryptedRandom: [
    '0x7797f244fc1c60af03f25cbe9a798080b920733cc2de2456af21ee7c9eb1ca0c',
    '0x118beef50353ab8512be871c0473e219',
  ] as [string, string],
});

const depositValue = 9975062344139650872817n;

// eslint-disable-next-line func-names
describe('Transaction/Transaction Batch', function () {
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
    makeNote = (value: bigint = 65n * DECIMALS_18): Note => new Note(address, random, value, token);
    merkletree.validateRoot = () => true;
    await merkletree.queueLeaves(0, 0, [depositLeaf('a')]);
    await merkletree.queueLeaves(1, 0, [
      depositLeaf('b'),
      depositLeaf('c'),
      depositLeaf('d'),
      depositLeaf('e'),
      depositLeaf('f'),
    ]);
    await wallet.scanBalances(chainID);
  });

  beforeEach(async () => {
    transactionBatch = new TransactionBatch(token, TokenType.ERC20, 1);
  });

  it('Should create transaction batch with single output', async () => {
    transactionBatch.addOutput(makeNote(depositValue * 6n));
    const txs = await transactionBatch.generateSerializedTransactions(
      prover,
      wallet,
      testEncryptionKey,
    );
    expect(txs.length).to.equal(1);
    expect(txs[0].nullifiers.length).to.equal(1);
    expect(txs[0].commitments.length).to.equal(2);

    transactionBatch.resetOutputs();
    transactionBatch.addOutput(makeNote(depositValue * 6n));
    transactionBatch.addOutput(makeNote(1n));
    await expect(
      transactionBatch.generateSerializedTransactions(prover, wallet, testEncryptionKey),
    ).to.eventually.be.rejectedWith('Wallet balance too low');

    transactionBatch.resetOutputs();
    transactionBatch.addOutput(makeNote(depositValue));
    transactionBatch.addOutput(makeNote(depositValue));
    transactionBatch.addOutput(makeNote(depositValue));
    transactionBatch.addOutput(makeNote(depositValue));
    transactionBatch.addOutput(makeNote(depositValue));
    transactionBatch.addOutput(makeNote(depositValue));
    await expect(
      transactionBatch.generateSerializedTransactions(prover, wallet, testEncryptionKey),
    ).to.eventually.be.rejectedWith('');
  });

  this.afterAll(() => {
    // Clean up database
    wallet.unloadTree(merkletree.chainID);
    db.close();
  });
});
