import { Wallet as EthersWallet } from '@ethersproject/wallet';
import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import memdown from 'memdown';
import { groth16 } from 'snarkjs';
import { JsonRpcProvider } from '@ethersproject/providers';
import { Commitment, CommitmentType, OutputType } from '../../models/formatted-types';
import { Chain, ChainType } from '../../models/engine-types';
import { randomHex } from '../../utils/bytes';
import { config } from '../../test/config.test';
import { artifactGetter, DECIMALS_18, mockQuickSync } from '../../test/helper.test';
import { Database } from '../../database/database';
import { AddressData } from '../../key-derivation/bech32';
import { MerkleTree } from '../../merkletree/merkletree';
import { TransactNote } from '../../note/transact-note';
import { Prover, Groth16 } from '../../prover/prover';
import { RailgunWallet } from '../../wallet/railgun-wallet';
import { TransactionBatch } from '../transaction-batch';
import { getTokenDataERC20 } from '../../note/note-util';
import { RailgunEngine } from '../../railgun-engine';
import { CONSOLIDATE_BALANCE_ERROR } from '../../solutions/complex-solutions';

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
const random = randomHex(16);

let makeNote: (value?: bigint) => Promise<TransactNote>;

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
    prover = new Prover(artifactGetter);
    prover.setSnarkJSGroth16(groth16 as Groth16);
    address = wallet.addressKeys;

    const provider = new JsonRpcProvider(config.rpc);
    const engine = new RailgunEngine('Tx Batch Tests', memdown(), artifactGetter, mockQuickSync);
    await engine.loadNetwork(
      chain,
      config.contracts.proxy,
      config.contracts.relayAdapt,
      provider,
      0,
    );
    wallet.loadMerkletree(merkletree);
    makeNote = async (value: bigint = 65n * DECIMALS_18): Promise<TransactNote> => {
      return TransactNote.createTransfer(
        address,
        undefined,
        random,
        value,
        tokenData,
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
    expect(txs.length).to.equal(2);
    expect(txs.map((tx) => tx.nullifiers.length)).to.deep.equal([1, 5]);
    expect(txs.map((tx) => tx.commitments.length)).to.deep.equal([1, 1]);

    transactionBatch.resetOutputs();
    transactionBatch.addOutput(await makeNote(shieldValue * 6n));
    transactionBatch.addOutput(await makeNote(1n));
    await expect(
      transactionBatch.generateTransactions(prover, wallet, testEncryptionKey, () => {}),
    ).to.eventually.be.rejectedWith(
      `RAILGUN private token balance too low for ${tokenAddress.toLowerCase()}.`,
    );

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
    expect(txs2.map((tx) => tx.commitments.length)).to.deep.equal([1, 1, 1, 1, 1, 1]);

    transactionBatch.resetOutputs();
    transactionBatch.addOutput(await makeNote(shieldValue + 1n));
    transactionBatch.addOutput(await makeNote(shieldValue + 1n));
    transactionBatch.addOutput(await makeNote(shieldValue + 1n));
    transactionBatch.addOutput(await makeNote(shieldValue + 1n));
    const txs3 = await transactionBatch.generateTransactions(
      prover,
      wallet,
      testEncryptionKey,
      () => {},
    );
    expect(txs3.length).to.equal(1);
    expect(txs3.map((tx) => tx.nullifiers.length)).to.deep.equal([5]);
    expect(txs3.map((tx) => tx.commitments.length)).to.deep.equal([5]);
    expect(txs3.map((tx) => tx.unshieldPreimage.value)).to.deep.equal([0n]);

    // TODO: Unhandled case for large number of output receivers.
    // Fix by using change from one note for the next output receiver... and so on.
    // Ie. Multiple receivers per circuit
    transactionBatch.resetOutputs();
    transactionBatch.resetUnshieldData();
    transactionBatch.addOutput(await makeNote(5n * shieldValue + 1n)); // Should use all 6 notes, with a large 'change' output.
    transactionBatch.addOutput(await makeNote(1n)); // Can't add another note, because all are used up.
    await expect(
      transactionBatch.generateTransactions(prover, wallet, testEncryptionKey, () => {}),
    ).to.eventually.be.rejectedWith(CONSOLIDATE_BALANCE_ERROR);
  });

  it('Should validate transaction batch outputs w/ unshields', async () => {
    transactionBatch.addUnshieldData({
      toAddress: ethersWallet.address,
      value: shieldValue * 6n,
      tokenData,
    });
    const txs = await transactionBatch.generateTransactions(
      prover,
      wallet,
      testEncryptionKey,
      () => {},
    );
    expect(txs.length).to.equal(2);
    expect(txs.map((tx) => tx.nullifiers.length)).to.deep.equal([1, 5]);
    expect(txs.map((tx) => tx.commitments.length)).to.deep.equal([1, 1]);
    expect(txs.map((tx) => tx.unshieldPreimage.value)).to.deep.equal([
      shieldValue,
      5n * shieldValue,
    ]);

    transactionBatch.resetOutputs();
    transactionBatch.resetUnshieldData();
    transactionBatch.addOutput(await makeNote(shieldValue * 6n));
    transactionBatch.addUnshieldData({
      toAddress: ethersWallet.address,
      value: shieldValue * 1n,
      tokenData,
    });
    await expect(
      transactionBatch.generateTransactions(prover, wallet, testEncryptionKey, () => {}),
    ).to.eventually.be.rejectedWith(
      `RAILGUN private token balance too low for ${tokenAddress.toLowerCase()}.`,
    );

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
    });
    const txs2 = await transactionBatch.generateTransactions(
      prover,
      wallet,
      testEncryptionKey,
      () => {},
    );
    expect(txs2.length).to.equal(6);
    expect(txs2.map((tx) => tx.nullifiers.length)).to.deep.equal([1, 1, 1, 1, 1, 1]);
    expect(txs2.map((tx) => tx.commitments.length)).to.deep.equal([1, 1, 1, 1, 1, 1]);
    expect(txs2.map((tx) => tx.unshieldPreimage.value)).to.deep.equal([
      0n,
      0n,
      0n,
      0n,
      0n,
      shieldValue,
    ]);

    await merkletree.queueLeaves(1, 0, [shieldLeaf('g'), shieldLeaf('h')]);
    await merkletree.updateTrees();
    transactionBatch.resetOutputs();
    transactionBatch.resetUnshieldData();
    transactionBatch.addOutput(await makeNote(0n));
    transactionBatch.addUnshieldData({
      toAddress: ethersWallet.address,
      value: shieldValue * 5n,
      tokenData,
    });
    const txs3 = await transactionBatch.generateTransactions(
      prover,
      wallet,
      testEncryptionKey,
      () => {},
    );
    expect(txs3.length).to.equal(1);
    expect(txs3.map((tx) => tx.nullifiers.length)).to.deep.equal([5]);
    expect(txs3.map((tx) => tx.commitments.length)).to.deep.equal([2]);
    expect(txs3.map((tx) => tx.unshieldPreimage.value)).to.deep.equal([5n * shieldValue]);

    transactionBatch.resetOutputs();
    transactionBatch.resetUnshieldData();
    transactionBatch.addOutput(await makeNote(shieldValue + 1n));
    transactionBatch.addOutput(await makeNote(shieldValue + 1n));
    transactionBatch.addOutput(await makeNote(shieldValue + 1n));
    transactionBatch.addUnshieldData({
      toAddress: ethersWallet.address,
      value: shieldValue + 1n,
      tokenData,
    });
    const txs4 = await transactionBatch.generateTransactions(
      prover,
      wallet,
      testEncryptionKey,
      () => {},
    );
    expect(txs4.length).to.equal(1);
    expect(txs4.map((tx) => tx.nullifiers.length)).to.deep.equal([5]);
    expect(txs4.map((tx) => tx.commitments.length)).to.deep.equal([5]);
    expect(txs4.map((tx) => tx.unshieldPreimage.value)).to.deep.equal([shieldValue + 1n]);
  });

  this.afterAll(() => {
    // Clean up database
    wallet.unloadMerkletree(merkletree.chain);
    db.close();
  });
});
