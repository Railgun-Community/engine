/* globals describe it beforeEach afterEach */
import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { ethers } from 'ethers';
import memdown from 'memdown';
import { groth16 } from 'snarkjs';
import { TransactionReceipt } from '@ethersproject/abstract-provider';
import { RailgunProxyContract, EventName } from '../../../src/contracts/railgun-proxy';
import { Note } from '../../../src/note';
import { Lepton } from '../../../src';
import { abi as erc20abi } from '../../erc20abi.test';
import { config } from '../../config.test';
import { Wallet } from '../../../src/wallet';
import { hexlify } from '../../../src/utils/bytes';
import { artifactsGetter, awaitScan, DECIMALS_18 } from '../../helper';
import { ERC20Deposit } from '../../../src/note/erc20-deposit';
import { CommitmentEvent } from '../../../src/contracts/railgun-proxy/events';
import { bytes } from '../../../src/utils';
import { ERC20WithdrawNote } from '../../../src/note/erc20-withdraw';
import { Nullifier, OutputType, TokenType } from '../../../src/models/formatted-types';
import { TransactionBatch } from '../../../src/transaction/transaction-batch';
import { LeptonEvent } from '../../../src/models/event-types';
import { Memo } from '../../../src/note/memo';

chai.use(chaiAsPromised);
const { expect } = chai;

let provider: ethers.providers.JsonRpcProvider;
let chainID: number;
let lepton: Lepton;
let etherswallet: ethers.Wallet;
let snapshot: number;
let token: ethers.Contract;
let proxyContract: RailgunProxyContract;
let walletID: string;
let walletID2: string;
let wallet: Wallet;
let wallet2: Wallet;

const testMnemonic = config.mnemonic;
const testEncryptionKey = config.encryptionKey;

const TOKEN_ADDRESS = config.contracts.rail;
const RANDOM = bytes.random(16);
const VALUE = BigInt(10000) * DECIMALS_18;

let testDeposit: (value?: bigint) => Promise<[TransactionReceipt, unknown]>;

// eslint-disable-next-line func-names
describe('Railgun Proxy/Index', function () {
  this.timeout(60000);

  beforeEach(async () => {
    lepton = new Lepton(memdown(), artifactsGetter, undefined);
    lepton.prover.setGroth16(groth16);

    if (!process.env.RUN_HARDHAT_TESTS) {
      return;
    }

    provider = new ethers.providers.JsonRpcProvider(config.rpc);
    chainID = (await provider.getNetwork()).chainId;
    await lepton.loadNetwork(
      chainID,
      config.contracts.proxy,
      config.contracts.relayAdapt,
      provider,
      0,
    );
    proxyContract = lepton.proxyContracts[chainID];

    const { privateKey } = ethers.utils.HDNode.fromMnemonic(config.mnemonic).derivePath(
      ethers.utils.defaultPath,
    );
    etherswallet = new ethers.Wallet(privateKey, provider);
    snapshot = await provider.send('evm_snapshot', []);

    token = new ethers.Contract(TOKEN_ADDRESS, erc20abi, etherswallet);
    const balance = await token.balanceOf(etherswallet.address);
    await token.approve(proxyContract.address, balance);

    walletID = await lepton.createWalletFromMnemonic(testEncryptionKey, testMnemonic, 0);
    walletID2 = await lepton.createWalletFromMnemonic(testEncryptionKey, testMnemonic, 1);
    wallet = lepton.wallets[walletID];
    wallet2 = lepton.wallets[walletID2];

    // fn to create deposit tx for tests
    // tx should be complete and balances updated after await
    testDeposit = async (
      value: bigint = BigInt(110000) * DECIMALS_18,
    ): Promise<[TransactionReceipt, unknown]> => {
      // Create deposit
      const deposit = new ERC20Deposit(wallet.masterPublicKey, RANDOM, value, TOKEN_ADDRESS);
      const depositInput = deposit.serialize(wallet.getViewingKeyPair().privateKey);

      const depositTx = await proxyContract.generateDeposit([depositInput]);

      // Send deposit on chain
      const tx = await etherswallet.sendTransaction(depositTx);
      return Promise.all([tx.wait(), awaitScan(wallet, chainID)]);
    };
  });

  it('[HH] Should retrieve merkle root from contract', async function run() {
    if (!process.env.RUN_HARDHAT_TESTS) {
      this.skip();
      return;
    }

    expect(await proxyContract.merkleRoot()).to.equal(
      '14fceeac99eb8419a2796d1958fc2050d489bf5a3eb170ef16a667060344ba90',
    );
  });

  it('[HH] Should return gas estimate for dummy transaction', async function run() {
    if (!process.env.RUN_HARDHAT_TESTS) {
      this.skip();
      return;
    }
    await testDeposit();

    const transactionBatch = new TransactionBatch(TOKEN_ADDRESS, TokenType.ERC20, chainID);

    const memoField = Memo.createMemoField(
      {
        outputType: OutputType.Transfer,
      },
      wallet2.getViewingKeyPair().privateKey,
    );
    transactionBatch.addOutput(
      new Note(wallet2.addressKeys, RANDOM, 300n, TOKEN_ADDRESS, memoField),
    );
    const tx = await proxyContract.transact(
      await transactionBatch.generateDummySerializedTransactions(
        lepton.prover,
        wallet,
        testEncryptionKey,
      ),
    );

    tx.from = '0x000000000000000000000000000000000000dEaD';

    expect((await provider.estimateGas(tx)).toNumber()).to.be.greaterThanOrEqual(0);
  });

  it('[HH] Should return valid merkle roots', async function run() {
    if (!process.env.RUN_HARDHAT_TESTS) {
      this.skip();
      return;
    }
    expect(
      await proxyContract.validateRoot(
        0,
        '0x14fceeac99eb8419a2796d1958fc2050d489bf5a3eb170ef16a667060344ba90',
      ),
    ).to.equal(true);
    expect(
      await proxyContract.validateRoot(
        0,
        '0x09981e69d3ecf345fb3e2e48243889aa4ff906423d6a686005cac572a3a9632d',
      ),
    ).to.equal(false);
  });

  it('[HH] Should return fees', async function run() {
    if (!process.env.RUN_HARDHAT_TESTS) {
      this.skip();
      return;
    }
    const fees = await proxyContract.fees();
    expect(fees).to.be.an('object');
    expect(fees.deposit).to.be.a('string');
    expect(fees.withdraw).to.be.a('string');
    expect(fees.nft).to.be.a('string');
  });

  it('[HH] Should find deposit and transact as historical events and nullifiers', async function run() {
    if (!process.env.RUN_HARDHAT_TESTS) {
      this.skip();
      return;
    }

    let resultEvent: CommitmentEvent;
    const eventsListener = async (commitmentEvent: CommitmentEvent) => {
      resultEvent = commitmentEvent;
    };
    let resultNullifiers: Nullifier[] = [];
    const nullifiersListener = async (nullifiers: Nullifier[]) => {
      resultNullifiers.push(...nullifiers);
    };

    let startingBlock = await provider.getBlockNumber();

    // Add a secondary listener.
    proxyContract.treeUpdates(eventsListener, nullifiersListener);

    // Subscribe to Nullified event
    const resultNullifiers2: Nullifier[] = [];
    const nullifiersListener2 = (nullifiers: Nullifier[]) => {
      resultNullifiers2.push(...nullifiers);
    };
    proxyContract.on(LeptonEvent.ContractNullifierReceived, nullifiersListener2);

    const [txResponse] = await testDeposit();

    // Listeners should have been updated automatically by contract events.

    // @ts-ignore
    expect(resultEvent).to.be.an('object', 'No event in history for deposit');
    // @ts-ignore
    expect(resultEvent.txid).to.equal(hexlify(txResponse.transactionHash));
    // @ts-ignore
    expect(resultNullifiers.length).to.equal(0);

    resultEvent = undefined;
    resultNullifiers = [];

    await proxyContract.getHistoricalEvents(
      startingBlock,
      eventsListener,
      nullifiersListener,
      async () => {},
    );

    // Listeners should have been updated by historical event scan.

    // @ts-ignore
    expect(resultEvent).to.be.an('object', 'No event in history for deposit');
    // @ts-ignore
    expect(resultEvent.txid).to.equal(hexlify(txResponse.transactionHash));
    // @ts-ignore
    expect(resultNullifiers.length).to.equal(0);

    startingBlock = await provider.getBlockNumber();

    const transactionBatch = new TransactionBatch(TOKEN_ADDRESS, TokenType.ERC20, chainID);

    const memoField = Memo.createMemoField(
      {
        outputType: OutputType.RelayerFee,
      },
      wallet2.getViewingKeyPair().privateKey,
    );
    transactionBatch.addOutput(
      new Note(wallet2.addressKeys, RANDOM, 300n, TOKEN_ADDRESS, memoField),
    );
    transactionBatch.setWithdraw(etherswallet.address, 100n);
    const serializedTxs = await transactionBatch.generateSerializedTransactions(
      lepton.prover,
      wallet,
      testEncryptionKey,
    );
    const transact = await proxyContract.transact(serializedTxs);

    // Send transact on chain
    const txTransact = await etherswallet.sendTransaction(transact);
    const [txResponseTransact] = await Promise.all([txTransact.wait(), awaitScan(wallet, chainID)]);

    // Event should have been scanned by automatic contract events:

    // @ts-ignore
    expect(resultEvent.txid).to.equal(hexlify(txResponseTransact.transactionHash));
    // @ts-ignore
    expect(resultNullifiers[0].txid).to.equal(hexlify(txResponseTransact.transactionHash));
    expect(resultNullifiers2[0].txid).to.equal(hexlify(txResponseTransact.transactionHash));

    resultEvent = undefined;
    resultNullifiers = [];

    await proxyContract.getHistoricalEvents(
      startingBlock,
      eventsListener,
      nullifiersListener,
      async () => {},
    );

    // Event should have been scanned by historical event scan.

    // @ts-ignore
    expect(resultEvent.txid).to.equal(hexlify(txResponseTransact.transactionHash));
    // @ts-ignore
    expect(resultNullifiers.length).to.equal(1);
  }).timeout(120000);

  it('[HH] Should scan and rescan history for events', async function run() {
    if (!process.env.RUN_HARDHAT_TESTS) {
      this.skip();
      return;
    }

    await testDeposit();

    const tree = 0;

    expect(await lepton.merkletree[chainID].erc20.getTreeLength(tree)).to.equal(1);
    let historyScanCompletedForChainID;
    const historyScanListener = (data) => {
      historyScanCompletedForChainID = data.chainID;
    };
    lepton.on(LeptonEvent.MerkletreeHistoryScanComplete, historyScanListener);
    await lepton.scanHistory(chainID);
    expect(historyScanCompletedForChainID).to.equal(chainID);
    expect(await lepton.getStartScanningBlock(chainID)).to.be.above(0);

    await lepton.clearSyncedMerkletreeLeaves(chainID);
    expect(await lepton.merkletree[chainID].erc20.getTreeLength(tree)).to.equal(0);
    expect(await lepton.getStartScanningBlock(chainID)).to.equal(0);

    await lepton.fullRescanMerkletreesAndWallets(chainID);
    expect(await lepton.merkletree[chainID].erc20.getTreeLength(tree)).to.equal(1);
  });

  it('[HH] Should get note hashes', async function run() {
    if (!process.env.RUN_HARDHAT_TESTS) {
      this.skip();
      return;
    }
    const withdraw = new ERC20WithdrawNote(etherswallet.address, 100n, token.address);
    const contractHash = await proxyContract.hashCommitment(withdraw.preImage);

    expect(hexlify(contractHash)).to.equal(withdraw.hashHex);
  });

  it('[HH] Should deposit', async function run() {
    if (!process.env.RUN_HARDHAT_TESTS) {
      this.skip();
      return;
    }

    let result: CommitmentEvent;
    proxyContract.treeUpdates(
      async (commitmentEvent: CommitmentEvent) => {
        result = commitmentEvent;
      },
      async () => {},
    );
    const merkleRootBefore = await proxyContract.merkleRoot();

    const { masterPublicKey } = wallet;
    const viewingPrivateKey = wallet.getViewingKeyPair().privateKey;

    // Create deposit
    const deposit = new ERC20Deposit(masterPublicKey, RANDOM, VALUE, TOKEN_ADDRESS);
    const depositInput = deposit.serialize(viewingPrivateKey);

    const depositTx = await proxyContract.generateDeposit([depositInput]);

    const awaiterDeposit = awaitScan(wallet, chainID);

    // Send deposit on chain
    await (await etherswallet.sendTransaction(depositTx)).wait();

    // Wait for events to fire
    await new Promise((resolve) =>
      proxyContract.contract.once(EventName.GeneratedCommitmentBatch, resolve),
    );

    await expect(awaiterDeposit).to.be.fulfilled;

    // Check result
    // @ts-ignore
    expect(result.treeNumber).to.equal(0);
    // @ts-ignore
    expect(result.startPosition).to.equal(0);
    // @ts-ignore
    expect(result.commitments.length).to.equal(1);

    const merkleRootAfterDeposit = await proxyContract.merkleRoot();

    // Check merkle root changed
    expect(merkleRootAfterDeposit).not.to.equal(merkleRootBefore);
  });

  it('[HH] Should create serialized transactions and parse tree updates', async function run() {
    if (!process.env.RUN_HARDHAT_TESTS) {
      this.skip();
      return;
    }

    await testDeposit(1000n);
    const merkleRootAfterDeposit = await proxyContract.merkleRoot();

    let result: CommitmentEvent;
    proxyContract.treeUpdates(
      async (commitmentEvent: CommitmentEvent) => {
        result = commitmentEvent;
      },
      async () => {},
    );
    // Create transaction
    const transactionBatch = new TransactionBatch(TOKEN_ADDRESS, TokenType.ERC20, chainID);

    const memoField = Memo.createMemoField(
      {
        outputType: OutputType.RelayerFee,
      },
      wallet.getViewingKeyPair().privateKey,
    );
    transactionBatch.addOutput(
      new Note(wallet.addressKeys, RANDOM, 300n, TOKEN_ADDRESS, memoField),
    );
    transactionBatch.setWithdraw(etherswallet.address, 100n);

    // Create transact
    const transact = await proxyContract.transact(
      await transactionBatch.generateSerializedTransactions(
        lepton.prover,
        wallet,
        testEncryptionKey,
      ),
    );

    // Send transact on chain
    await (await etherswallet.sendTransaction(transact)).wait();

    // Wait for events to fire
    await new Promise((resolve) => proxyContract.contract.once(EventName.CommitmentBatch, resolve));

    // Check merkle root changed
    const merkleRootAfterTransact = await proxyContract.merkleRoot();
    expect(merkleRootAfterTransact).to.not.equal(merkleRootAfterDeposit);

    // Check result
    // @ts-ignore
    expect(result.treeNumber).to.equal(0);
    // @ts-ignore
    expect(result.startPosition).to.equal(1);
    // @ts-ignore
    expect(result.commitments.length).to.equal(2);
    // @ts-ignore
    expect(result.commitments[0].ciphertext.memo.length).to.equal(1);
    // @ts-ignore
    expect(result.commitments[1].ciphertext.memo.length).to.equal(1);
    expect(
      Memo.decryptNoteExtraData(
        // @ts-ignore
        result.commitments[0].ciphertext.memo,
        wallet.getViewingKeyPair().privateKey,
      ),
    ).to.deep.equal({
      outputType: OutputType.RelayerFee,
    });
    expect(
      Memo.decryptNoteExtraData(
        // @ts-ignore
        result.commitments[1].ciphertext.memo,
        wallet.getViewingKeyPair().privateKey,
      ),
    ).to.deep.equal({
      outputType: OutputType.Change,
    });
  }).timeout(120000);

  afterEach(async () => {
    if (!process.env.RUN_HARDHAT_TESTS) {
      return;
    }
    lepton.unload();
    await provider.send('evm_revert', [snapshot]);
  });
});
