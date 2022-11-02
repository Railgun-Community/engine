import { Wallet as EthersWallet } from '@ethersproject/wallet';
import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import memdown from 'memdown';
import { groth16 } from 'snarkjs';
import { Commitment, OutputType, TokenType } from '../../models/formatted-types';
import { Chain, ChainType } from '../../models/engine-types';
import { TransactionBatch } from '../transaction-batch';
import { randomHex } from '../../utils/bytes';
import { config } from '../../test/config.test';
import { artifactsGetter, DECIMALS_18 } from '../../test/helper.test';
import { Database } from '../../database/database';
import { AddressData } from '../../key-derivation/bech32';
import { MerkleTree } from '../../merkletree/merkletree';
import { Note } from '../../note/note';
import { Prover, Groth16 } from '../../prover/prover';
import { RailgunWallet } from '../../wallet/railgun-wallet';

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

const token = '0x5FbDB2315678afecb367f032d93F642f64180aa3';
const random = randomHex(16);
type makeNoteFn = (value?: bigint) => Promise<Note>;
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
  blockNumber: 0,
});

const depositValue = 9975062344139650872817n;

describe('Transaction/Transaction Batch', function run() {
  this.timeout(120000);
  this.beforeAll(async () => {
    db = new Database(memdown());
    chain = {
      type: ChainType.EVM,
      id: 1,
    };
    merkletree = new MerkleTree(db, chain, 'erc20', async () => true);
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
    wallet.loadTree(merkletree);
    makeNote = async (value: bigint = 65n * DECIMALS_18): Promise<Note> => {
      const senderBlindingKey = randomHex(15);
      return Note.create(
        address,
        random,
        value,
        token,
        wallet.getViewingKeyPair(),
        senderBlindingKey,
        OutputType.Transfer,
        undefined, // memoText
      );
    };
    merkletree.validateRoot = () => Promise.resolve(true);
    await merkletree.queueLeaves(0, 0, [depositLeaf('a')]);
    await merkletree.queueLeaves(1, 0, [
      depositLeaf('b'),
      depositLeaf('c'),
      depositLeaf('d'),
      depositLeaf('e'),
      depositLeaf('f'),
    ]);
    await merkletree.updateTrees();
    await wallet.scanBalances(chain);
    expect((await wallet.getWalletDetails(chain)).treeScannedHeights).to.deep.equal([1, 5]);
  });

  beforeEach(async () => {
    transactionBatch = new TransactionBatch(token, TokenType.ERC20, chain);
  });

  it('Should validate transaction batch outputs', async () => {
    transactionBatch.addOutput(await makeNote(depositValue * 6n));
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
    transactionBatch.addOutput(await makeNote(depositValue * 6n));
    transactionBatch.addOutput(await makeNote(1n));
    await expect(
      transactionBatch.generateSerializedTransactions(prover, wallet, testEncryptionKey, () => {}),
    ).to.eventually.be.rejectedWith('Wallet balance too low');

    transactionBatch.resetOutputs();
    transactionBatch.addOutput(await makeNote(depositValue));
    transactionBatch.addOutput(await makeNote(depositValue));
    transactionBatch.addOutput(await makeNote(depositValue));
    transactionBatch.addOutput(await makeNote(depositValue));
    transactionBatch.addOutput(await makeNote(depositValue));
    transactionBatch.addOutput(await makeNote(depositValue));
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
    transactionBatch.addOutput(await makeNote(depositValue + 1n));
    transactionBatch.addOutput(await makeNote(depositValue + 1n));
    transactionBatch.addOutput(await makeNote(depositValue + 1n));
    transactionBatch.addOutput(await makeNote(depositValue + 1n));
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
    transactionBatch.addOutput(await makeNote(depositValue * 6n));
    transactionBatch.setWithdraw(ethersWallet.address, depositValue * 1n);
    await expect(
      transactionBatch.generateSerializedTransactions(prover, wallet, testEncryptionKey, () => {}),
    ).to.eventually.be.rejectedWith('Wallet balance too low');

    transactionBatch.resetOutputs();
    transactionBatch.resetWithdraw();
    transactionBatch.addOutput(await makeNote(depositValue));
    transactionBatch.addOutput(await makeNote(depositValue));
    transactionBatch.addOutput(await makeNote(depositValue));
    transactionBatch.addOutput(await makeNote(depositValue));
    transactionBatch.addOutput(await makeNote(depositValue));
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
    transactionBatch.addOutput(await makeNote(depositValue + 1n));
    transactionBatch.addOutput(await makeNote(depositValue + 1n));
    transactionBatch.addOutput(await makeNote(depositValue + 1n));
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
    await merkletree.updateTrees();
    transactionBatch.resetOutputs();
    transactionBatch.resetWithdraw();
    transactionBatch.addOutput(await makeNote(0n));
    transactionBatch.setWithdraw(ethersWallet.address, depositValue * 5n);
    await expect(
      transactionBatch.generateSerializedTransactions(prover, wallet, testEncryptionKey, () => {}),
    ).to.eventually.be.rejectedWith(
      'This transaction requires a complex circuit for multi-sending, which is not supported by RAILGUN at this time. Select a different Relayer fee token or send tokens to a single address to resolve.',
    );
  });

  this.afterAll(() => {
    // Clean up database
    wallet.unloadTree(merkletree.chain);
    db.close();
  });
});
