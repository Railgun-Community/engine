import { Wallet as EthersWallet } from '@ethersproject/wallet';
import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import memdown from 'memdown';
import { groth16 } from 'snarkjs';
import { Commitment, CommitmentType, OutputType } from '../../models/formatted-types';
import { Chain, ChainType } from '../../models/engine-types';
import { randomHex } from '../../utils/bytes';
import { config } from '../../test/config.test';
import { artifactsGetter, DECIMALS_18 } from '../../test/helper.test';
import { Database } from '../../database/database';
import { AddressData } from '../../key-derivation/bech32';
import { MerkleTree } from '../../merkletree/merkletree';
import { TransactNote } from '../../note/transact-note';
import { Prover, Groth16 } from '../../prover/prover';
import { RailgunWallet } from '../../wallet/railgun-wallet';
import { TransactionBatch } from '../transaction-batch';
import { getTokenDataERC20, getTokenDataHash } from '../../note/note-util';

chai.use(chaiAsPromised);
const { expect } = chai;

let db: Database;
let merkletree: MerkleTree;
let wallet: RailgunWallet;
let chain: Chain;
let ethersWallet: EthersWallet;
let transactionBatch: TransactionBatch;
let prover: Prover;
let address: AddressData;

const testMnemonic = config.mnemonic;
const testEncryptionKey = config.encryptionKey;

const tokenAddress = '0x5FbDB2315678afecb367f032d93F642f64180aa3';
const tokenData = getTokenDataERC20(tokenAddress);
const tokenHash = getTokenDataHash(tokenData);
const random = randomHex(16);
type makeNoteFn = (value?: bigint) => Promise<TransactNote>;
let makeNote: makeNoteFn;

const shieldLeaf = (txid: string): Commitment => ({
  commitmentType: CommitmentType.LegacyGeneratedCommitment,
  txid,
  hash: '10c139398677d31020ddf97e0c73239710c956a52a7ea082a1e84815582bfb5f',
  preImage: {
    npk: '1d73bae2faf4ff18e1cd22d22cb9c05bc08878dc8fa4907257ce1a7ad51933f7',
    token: tokenData,
    value: '000000000000021cbfcc6fd98333b5f1', // 9975062344139650872817n
  },
  encryptedRandom: [
    '0x7797f244fc1c60af03f25cbe9a798080b920733cc2de2456af21ee7c9eb1ca0c',
    '0x118beef50353ab8512be871c0473e219',
  ] as [string, string],
  blockNumber: 0,
});

const shieldValue = 9975062344139650872817n;

describe('Transaction/Transaction Batch', function run() {
  this.timeout(120000);
  this.beforeAll(async () => {
    db = new Database(memdown());
    chain = {
      type: ChainType.EVM,
      id: 1,
    };
    merkletree = new MerkleTree(db, chain, async () => true);
    wallet = await RailgunWallet.fromMnemonic(
      db,
      testEncryptionKey,
      testMnemonic,
      0,
      undefined, // creationBlockNumbers
    );
    ethersWallet = EthersWallet.fromMnemonic(testMnemonic);
    prover = new Prover(artifactsGetter);
    prover.setSnarkJSGroth16(groth16 as Groth16);
    address = wallet.addressKeys;
    wallet.loadMerkletree(merkletree);
    makeNote = async (value: bigint = 65n * DECIMALS_18): Promise<TransactNote> => {
      return TransactNote.createTransfer(
        address,
        undefined,
        random,
        value,
        tokenHash,
        wallet.getViewingKeyPair(),
        false, // showSenderAddressToRecipient
        OutputType.Transfer,
        undefined, // memoText
      );
    };
    merkletree.rootValidator = () => Promise.resolve(true);
    await merkletree.queueLeaves(0, 0, [shieldLeaf('a')]);
    await merkletree.queueLeaves(1, 0, [
      shieldLeaf('b'),
      shieldLeaf('c'),
      shieldLeaf('d'),
      shieldLeaf('e'),
      shieldLeaf('f'),
    ]);
    await merkletree.updateTrees();
    await wallet.scanBalances(chain, undefined);
    expect((await wallet.getWalletDetails(chain)).treeScannedHeights).to.deep.equal([1, 5]);
  });

  beforeEach(async () => {
    transactionBatch = new TransactionBatch(chain);
  });

  it('Should validate transaction batch outputs', async () => {
    transactionBatch.addOutput(await makeNote(shieldValue * 6n));
    const txs = await transactionBatch.generateTransactions(
      prover,
      wallet,
      testEncryptionKey,
      () => {},
    );
    expect(txs.length).to.equal(4);
    expect(txs.map((tx) => tx.nullifiers.length)).to.deep.equal([1, 2, 2, 1]);
    expect(txs.map((tx) => tx.commitments.length)).to.deep.equal([2, 2, 2, 2]);

    transactionBatch.resetOutputs();
    transactionBatch.addOutput(await makeNote(shieldValue * 6n));
    transactionBatch.addOutput(await makeNote(1n));
    await expect(
      transactionBatch.generateTransactions(prover, wallet, testEncryptionKey, () => {}),
    ).to.eventually.be.rejectedWith('RAILGUN private token balance too low.');

    transactionBatch.resetOutputs();
    transactionBatch.addOutput(await makeNote(shieldValue));
    transactionBatch.addOutput(await makeNote(shieldValue));
    transactionBatch.addOutput(await makeNote(shieldValue));
    transactionBatch.addOutput(await makeNote(shieldValue));
    transactionBatch.addOutput(await makeNote(shieldValue));
    transactionBatch.addOutput(await makeNote(shieldValue));
    const txs2 = await transactionBatch.generateTransactions(
      prover,
      wallet,
      testEncryptionKey,
      () => {},
    );
    expect(txs2.length).to.equal(6);
    expect(txs2.map((tx) => tx.nullifiers.length)).to.deep.equal([1, 1, 1, 1, 1, 1]);
    expect(txs2.map((tx) => tx.commitments.length)).to.deep.equal([2, 2, 2, 2, 2, 2]);

    transactionBatch.resetOutputs();
    transactionBatch.addOutput(await makeNote(shieldValue + 1n));
    transactionBatch.addOutput(await makeNote(shieldValue + 1n));
    transactionBatch.addOutput(await makeNote(shieldValue + 1n));
    transactionBatch.addOutput(await makeNote(shieldValue + 1n));
    await expect(
      transactionBatch.generateTransactions(prover, wallet, testEncryptionKey, () => {}),
    ).to.eventually.be.rejectedWith(
      'This transaction requires a complex circuit for multi-sending, which is not supported by RAILGUN at this time. Select a different Relayer fee token or send tokens to a single address to resolve.',
    );
  });

  it('Should validate transaction batch outputs w/ unshields', async () => {
    transactionBatch.addUnshieldData({
      toAddress: ethersWallet.address,
      value: shieldValue * 6n,
      tokenData,
      tokenHash,
    });
    const txs = await transactionBatch.generateTransactions(
      prover,
      wallet,
      testEncryptionKey,
      () => {},
    );
    expect(txs.length).to.equal(4);
    expect(txs.map((tx) => tx.nullifiers.length)).to.deep.equal([1, 2, 2, 1]);
    expect(txs.map((tx) => tx.commitments.length)).to.deep.equal([2, 2, 2, 2]);
    expect(txs.map((tx) => tx.unshieldPreimage.value)).to.deep.equal([
      shieldValue,
      2n * shieldValue,
      2n * shieldValue,
      shieldValue,
    ]);

    transactionBatch.resetOutputs();
    transactionBatch.resetUnshieldData();
    transactionBatch.addOutput(await makeNote(shieldValue * 6n));
    transactionBatch.addUnshieldData({
      toAddress: ethersWallet.address,
      value: shieldValue * 1n,
      tokenData,
      tokenHash,
    });
    await expect(
      transactionBatch.generateTransactions(prover, wallet, testEncryptionKey, () => {}),
    ).to.eventually.be.rejectedWith('RAILGUN private token balance too low.');

    transactionBatch.resetOutputs();
    transactionBatch.resetUnshieldData();
    transactionBatch.addOutput(await makeNote(shieldValue));
    transactionBatch.addOutput(await makeNote(shieldValue));
    transactionBatch.addOutput(await makeNote(shieldValue));
    transactionBatch.addOutput(await makeNote(shieldValue));
    transactionBatch.addOutput(await makeNote(shieldValue));
    transactionBatch.addUnshieldData({
      toAddress: ethersWallet.address,
      value: shieldValue,
      tokenData,
      tokenHash,
    });
    const txs2 = await transactionBatch.generateTransactions(
      prover,
      wallet,
      testEncryptionKey,
      () => {},
    );
    expect(txs2.length).to.equal(6);
    expect(txs2.map((tx) => tx.nullifiers.length)).to.deep.equal([1, 1, 1, 1, 1, 1]);
    expect(txs2.map((tx) => tx.commitments.length)).to.deep.equal([2, 2, 2, 2, 2, 2]);
    expect(txs2.map((tx) => tx.unshieldPreimage.value)).to.deep.equal([
      0n,
      0n,
      0n,
      0n,
      0n,
      shieldValue,
    ]);

    // TODO: Unhandled case.
    // Fix by using change from one note for the next output note... and so on.
    transactionBatch.resetOutputs();
    transactionBatch.resetUnshieldData();
    transactionBatch.addOutput(await makeNote(shieldValue + 1n));
    transactionBatch.addOutput(await makeNote(shieldValue + 1n));
    transactionBatch.addOutput(await makeNote(shieldValue + 1n));
    transactionBatch.addUnshieldData({
      toAddress: ethersWallet.address,
      value: shieldValue + 1n,
      tokenData,
      tokenHash,
    });
    await expect(
      transactionBatch.generateTransactions(prover, wallet, testEncryptionKey, () => {}),
    ).to.eventually.be.rejectedWith(
      'This transaction requires a complex circuit for multi-sending, which is not supported by RAILGUN at this time. Select a different Relayer fee token or send tokens to a single address to resolve.',
    );

    // TODO: Unhandled case: 8x3 circuit.
    // Fix by adding 8x3 circuit, or using change from one note for next output note.
    // Or... fix logic to create a number of 2x2 and 2x3 circuits.
    await merkletree.queueLeaves(1, 0, [shieldLeaf('g'), shieldLeaf('h')]);
    await merkletree.updateTrees();
    transactionBatch.resetOutputs();
    transactionBatch.resetUnshieldData();
    transactionBatch.addOutput(await makeNote(0n));
    transactionBatch.addUnshieldData({
      toAddress: ethersWallet.address,
      value: shieldValue * 5n,
      tokenData,
      tokenHash,
    });
    await expect(
      transactionBatch.generateTransactions(prover, wallet, testEncryptionKey, () => {}),
    ).to.eventually.be.rejectedWith(
      'This transaction requires a complex circuit for multi-sending, which is not supported by RAILGUN at this time. Select a different Relayer fee token or send tokens to a single address to resolve.',
    );
  });

  this.afterAll(() => {
    // Clean up database
    wallet.unloadMerkletree(merkletree.chain);
    db.close();
  });
});
