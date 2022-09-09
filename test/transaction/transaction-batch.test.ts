/* eslint-disable @typescript-eslint/no-unused-vars */
/* globals describe it beforeEach */
import { Wallet as EthersWallet } from '@ethersproject/wallet';
import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import memdown from 'memdown';
import { groth16 } from 'snarkjs';
import { Database } from '../../src/database';
import { AddressData } from '../../src/keyderivation/bech32-encode';
import { MerkleTree } from '../../src/merkletree';
import { Commitment, TokenType } from '../../src/models/formatted-types';
import { Note } from '../../src/note';
import { Groth16, Prover } from '../../src/prover';
import { TransactionBatch } from '../../src/transaction/transaction-batch';
import { randomHex } from '../../src/utils/bytes';
import { Wallet } from '../../src/wallet/wallet';
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
const random = randomHex(16);
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

describe('Transaction/Transaction Batch', function run() {
  this.timeout(120000);
  this.beforeAll(async () => {
    db = new Database(memdown());
    chainID = 1;
    merkletree = new MerkleTree(db, chainID, 'erc20', async () => true);
    wallet = await Wallet.fromMnemonic(db, testEncryptionKey, testMnemonic, 0);
    ethersWallet = EthersWallet.fromMnemonic(testMnemonic);
    prover = new Prover(artifactsGetter);
    prover.setGroth16(groth16 as Groth16);
    address = wallet.addressKeys;
    wallet.loadTree(merkletree);
    makeNote = (value: bigint = 65n * DECIMALS_18): Note =>
      new Note(address, random, value, token, []);
    merkletree.validateRoot = () => Promise.resolve(true);
    await merkletree.queueLeaves(0, 0, [depositLeaf('a')]);
    await merkletree.queueLeaves(1, 0, [
      depositLeaf('b'),
      depositLeaf('c'),
      depositLeaf('d'),
      depositLeaf('e'),
      depositLeaf('f'),
    ]);
    await wallet.scanBalances(chainID);
    expect((await wallet.getWalletDetails(chainID)).treeScannedHeights).to.deep.equal([1, 5]);
  });

  beforeEach(async () => {
    transactionBatch = new TransactionBatch(token, TokenType.ERC20, 1);
  });

  it('Should validate transaction batch outputs', async () => {
    transactionBatch.addOutput(makeNote(depositValue * 6n));
    const txs = await transactionBatch.generateSerializedTransactions(
      prover,
      wallet,
      testEncryptionKey,
      () => {},
    );
    expect(txs.length).to.equal(4);
    expect(txs.map((tx) => tx.nullifiers.length)).to.deep.equal([1, 2, 2, 1]);
    expect(txs.map((tx) => tx.commitments.length)).to.deep.equal([2, 2, 2, 2]);

    transactionBatch.resetOutputs();
    transactionBatch.addOutput(makeNote(depositValue * 6n));
    transactionBatch.addOutput(makeNote(1n));
    await expect(
      transactionBatch.generateSerializedTransactions(prover, wallet, testEncryptionKey, () => {}),
    ).to.eventually.be.rejectedWith('Wallet balance too low');

    transactionBatch.resetOutputs();
    transactionBatch.addOutput(makeNote(depositValue));
    transactionBatch.addOutput(makeNote(depositValue));
    transactionBatch.addOutput(makeNote(depositValue));
    transactionBatch.addOutput(makeNote(depositValue));
    transactionBatch.addOutput(makeNote(depositValue));
    transactionBatch.addOutput(makeNote(depositValue));
    const txs2 = await transactionBatch.generateSerializedTransactions(
      prover,
      wallet,
      testEncryptionKey,
      () => {},
    );
    expect(txs2.length).to.equal(6);
    expect(txs2.map((tx) => tx.nullifiers.length)).to.deep.equal([1, 1, 1, 1, 1, 1]);
    expect(txs2.map((tx) => tx.commitments.length)).to.deep.equal([2, 2, 2, 2, 2, 2]);

    transactionBatch.resetOutputs();
    transactionBatch.addOutput(makeNote(depositValue + 1n));
    transactionBatch.addOutput(makeNote(depositValue + 1n));
    transactionBatch.addOutput(makeNote(depositValue + 1n));
    transactionBatch.addOutput(makeNote(depositValue + 1n));
    await expect(
      transactionBatch.generateSerializedTransactions(prover, wallet, testEncryptionKey, () => {}),
    ).to.eventually.be.rejectedWith(
      'This transaction requires a complex circuit for multi-sending, which is not supported by RAILGUN at this time. Select a different Relayer fee token or send tokens to a single address to resolve.',
    );
  });

  it('Should validate transaction batch outputs w/ withdraws', async () => {
    transactionBatch.setWithdraw(ethersWallet.address, depositValue * 6n);
    const txs = await transactionBatch.generateSerializedTransactions(
      prover,
      wallet,
      testEncryptionKey,
      () => {},
    );
    expect(txs.length).to.equal(4);
    expect(txs.map((tx) => tx.nullifiers.length)).to.deep.equal([1, 2, 2, 1]);
    expect(txs.map((tx) => tx.commitments.length)).to.deep.equal([2, 2, 2, 2]);
    expect(txs.map((tx) => tx.withdrawPreimage.value)).to.deep.equal([
      depositValue,
      2n * depositValue,
      2n * depositValue,
      depositValue,
    ]);

    transactionBatch.resetOutputs();
    transactionBatch.resetWithdraw();
    transactionBatch.addOutput(makeNote(depositValue * 6n));
    transactionBatch.setWithdraw(ethersWallet.address, depositValue * 1n);
    await expect(
      transactionBatch.generateSerializedTransactions(prover, wallet, testEncryptionKey, () => {}),
    ).to.eventually.be.rejectedWith('Wallet balance too low');

    transactionBatch.resetOutputs();
    transactionBatch.resetWithdraw();
    transactionBatch.addOutput(makeNote(depositValue));
    transactionBatch.addOutput(makeNote(depositValue));
    transactionBatch.addOutput(makeNote(depositValue));
    transactionBatch.addOutput(makeNote(depositValue));
    transactionBatch.addOutput(makeNote(depositValue));
    transactionBatch.setWithdraw(ethersWallet.address, depositValue);
    const txs2 = await transactionBatch.generateSerializedTransactions(
      prover,
      wallet,
      testEncryptionKey,
      () => {},
    );
    expect(txs2.length).to.equal(6);
    expect(txs2.map((tx) => tx.nullifiers.length)).to.deep.equal([1, 1, 1, 1, 1, 1]);
    expect(txs2.map((tx) => tx.commitments.length)).to.deep.equal([2, 2, 2, 2, 2, 2]);
    expect(txs2.map((tx) => tx.withdrawPreimage.value)).to.deep.equal([
      0n,
      0n,
      0n,
      0n,
      0n,
      depositValue,
    ]);

    // TODO: Unhandled case.
    // Fix by using change from one note for the next output note... and so on.
    transactionBatch.resetOutputs();
    transactionBatch.resetWithdraw();
    transactionBatch.addOutput(makeNote(depositValue + 1n));
    transactionBatch.addOutput(makeNote(depositValue + 1n));
    transactionBatch.addOutput(makeNote(depositValue + 1n));
    transactionBatch.setWithdraw(ethersWallet.address, depositValue + 1n);
    await expect(
      transactionBatch.generateSerializedTransactions(prover, wallet, testEncryptionKey, () => {}),
    ).to.eventually.be.rejectedWith(
      'This transaction requires a complex circuit for multi-sending, which is not supported by RAILGUN at this time. Select a different Relayer fee token or send tokens to a single address to resolve.',
    );

    // TODO: Unhandled case: 8x3 circuit.
    // Fix by adding 8x3 circuit, or using change from one note for next output note.
    // Or... fix logic to create a number of 2x2 and 2x3 circuits.
    await merkletree.queueLeaves(1, 0, [depositLeaf('g'), depositLeaf('h')]);
    transactionBatch.resetOutputs();
    transactionBatch.resetWithdraw();
    transactionBatch.addOutput(makeNote(0n));
    transactionBatch.setWithdraw(ethersWallet.address, depositValue * 5n);
    await expect(
      transactionBatch.generateSerializedTransactions(prover, wallet, testEncryptionKey, () => {}),
    ).to.eventually.be.rejectedWith(
      'This transaction requires a complex circuit for multi-sending, which is not supported by RAILGUN at this time. Select a different Relayer fee token or send tokens to a single address to resolve.',
    );
  });

  this.afterAll(() => {
    // Clean up database
    wallet.unloadTree(merkletree.chainID);
    db.close();
  });
});
