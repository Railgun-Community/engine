import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import memdown from 'memdown';
import { groth16 } from 'snarkjs';
import { Wallet } from 'ethers';
import { Commitment, CommitmentType, OutputType } from '../../models/formatted-types';
import { Chain, ChainType } from '../../models/engine-types';
import { randomHex } from '../../utils/bytes';
import { config } from '../../test/config.test';
import {
  DECIMALS_18,
  getEthersWallet,
  mockQuickSync,
  testArtifactsGetter,
} from '../../test/helper.test';
import { Database } from '../../database/database';
import { AddressData } from '../../key-derivation/bech32';
import { MerkleTree } from '../../merkletree/merkletree';
import { TransactNote } from '../../note/transact-note';
import { Prover, Groth16 } from '../../prover/prover';
import { RailgunWallet } from '../../wallet/railgun-wallet';
import { TransactionBatch } from '../transaction-batch';
import { getTokenDataERC20 } from '../../note/note-util';
import { RailgunEngine } from '../../railgun-engine';
import { PollingJsonRpcProvider } from '../../provider/polling-json-rpc-provider';
import { createPollingJsonRpcProviderForListeners } from '../../provider/polling-util';
import { isDefined } from '../../utils/is-defined';

chai.use(chaiAsPromised);
const { expect } = chai;

let db: Database;
let merkletree: MerkleTree;
let wallet: RailgunWallet;
let chain: Chain;
let ethersWallet: Wallet;
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
  timestamp: undefined,
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
    merkletree = await MerkleTree.create(db, chain, async () => true);
    wallet = await RailgunWallet.fromMnemonic(
      db,
      testEncryptionKey,
      testMnemonic,
      0,
      undefined, // creationBlockNumbers
    );
    ethersWallet = getEthersWallet(testMnemonic);

    if (!isDefined(process.env.RUN_HARDHAT_TESTS)) {
      return;
    }

    const engine = new RailgunEngine(
      'Tx Batch Tests',
      memdown(),
      testArtifactsGetter,
      mockQuickSync,
      undefined, // engineDebugger
      undefined, // skipMerkletreeScans
    );

    const provider = new PollingJsonRpcProvider(config.rpc, config.chainId, 500, 1);

    const pollingProvider = await createPollingJsonRpcProviderForListeners(provider);
    await engine.loadNetwork(
      chain,
      config.contracts.proxy,
      config.contracts.relayAdapt,
      provider,
      pollingProvider,
      0,
    );

    prover = engine.prover;
    prover.setSnarkJSGroth16(groth16 as Groth16);
    address = wallet.addressKeys;

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

  it('[HH] Should validate transaction batch outputs', async function test() {
    if (!isDefined(process.env.RUN_HARDHAT_TESTS)) {
      this.skip();
      return;
    }

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

    // Ex: large number of output receivers per circuit
    // The solutions should use change from one note for the next output receiver... and so on.
    transactionBatch.resetOutputs();
    transactionBatch.resetUnshieldData();
    transactionBatch.addOutput(await makeNote(5n * shieldValue + 1n)); // Should use all 6 notes, with a large 'change' output.
    transactionBatch.addOutput(await makeNote(1n)); // Can't add another note, because all are used up.
    const txs4 = await transactionBatch.generateTransactions(
      prover,
      wallet,
      testEncryptionKey,
      () => {},
    );
    expect(txs4.map((tx) => tx.nullifiers.length)).to.deep.equal([1, 5]);
    expect(txs4.map((tx) => tx.commitments.length)).to.deep.equal([1, 3]);
    expect(txs4.map((tx) => tx.unshieldPreimage.value)).to.deep.equal([0n, 0n]);
  });

  it('[HH] Should validate transaction batch outputs w/ unshields', async function test() {
    if (!isDefined(process.env.RUN_HARDHAT_TESTS)) {
      this.skip();
      return;
    }

    transactionBatch.resetOutputs();
    transactionBatch.resetUnshieldData();
    transactionBatch.addOutput(await makeNote(0n));
    await expect(
      transactionBatch.generateTransactions(prover, wallet, testEncryptionKey, () => {}),
    ).to.eventually.be.rejectedWith(
      'Cannot prove transaction with null (zero value) inputs and outputs.',
      'Null input, null output notes should fail.',
    );
    // If this case is ever fixed, we can use these assertions instead:
    // const txs0 = await transactionBatch.generateTransactions(
    //   prover,
    //   wallet,
    //   testEncryptionKey,
    //   () => {},
    // );
    // expect(txs0.length).to.equal(1);
    // expect(txs0.map((tx) => tx.nullifiers.length)).to.deep.equal([1]);
    // expect(txs0.map((tx) => tx.commitments.length)).to.deep.equal([1]);
    // expect(txs0.map((tx) => tx.unshieldPreimage.value)).to.deep.equal([0n]);

    transactionBatch.resetOutputs();
    transactionBatch.resetUnshieldData();
    transactionBatch.addUnshieldData({
      toAddress: ethersWallet.address,
      value: shieldValue * 6n,
      tokenData,
    });
    const txs1 = await transactionBatch.generateTransactions(
      prover,
      wallet,
      testEncryptionKey,
      () => {},
    );
    expect(txs1.length).to.equal(2);
    expect(txs1.map((tx) => tx.nullifiers.length)).to.deep.equal([1, 5]);
    expect(txs1.map((tx) => tx.commitments.length)).to.deep.equal([1, 1]);
    expect(txs1.map((tx) => tx.unshieldPreimage.value)).to.deep.equal([
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

  this.afterAll(async () => {
    if (!isDefined(process.env.RUN_HARDHAT_TESTS)) {
      return;
    }

    // Clean up database
    wallet.unloadMerkletree(merkletree.chain);
    await db.close();
  });
});
