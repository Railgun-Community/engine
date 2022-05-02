/* globals describe it beforeEach afterEach */
import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { CallOverrides, ethers } from 'ethers';
import memdown from 'memdown';
import { TransactionReceipt } from '@ethersproject/abstract-provider';
import { ERC20RailgunContract } from '../../src/contract';
import { Note } from '../../src/note';
import { Transaction } from '../../src/transaction';
import { Lepton } from '../../src';
import { abi as erc20abi } from '../erc20abi.test';
import { config } from '../config.test';
import { Wallet } from '../../src/wallet';
import { hexlify } from '../../src/utils/bytes';
import { artifactsGetter, awaitScan, DECIMALS_18 } from '../helper';
import { ERC20Deposit } from '../../src/note/erc20-deposit';
import { CommitmentEvent } from '../../src/contract/erc20/events';
import { EventName } from '../../src/contract/erc20';
import { bytes } from '../../src/utils';
import { Nullifier, TokenType } from '../../src/models/transaction-types';
import { ERC20WithdrawNote } from '../../src/note/erc20-withdraw';

chai.use(chaiAsPromised);
const { expect } = chai;

let provider: ethers.providers.JsonRpcProvider;
let chainID: number;
let lepton: Lepton;
let etherswallet: ethers.Wallet;
let snapshot: number;
let token: ethers.Contract;
let contract: ERC20RailgunContract;
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
describe('Contract/Index', function () {
  this.timeout(60000);

  beforeEach(async () => {
    lepton = new Lepton(memdown(), artifactsGetter, undefined);

    if (!process.env.RUN_HARDHAT_TESTS) {
      return;
    }

    provider = new ethers.providers.JsonRpcProvider(config.rpc);
    chainID = (await provider.getNetwork()).chainId;
    await lepton.loadNetwork(chainID, config.contracts.proxy, provider, 0);
    contract = lepton.contracts[chainID];

    const { privateKey } = ethers.utils.HDNode.fromMnemonic(config.mnemonic).derivePath(
      ethers.utils.defaultPath,
    );
    etherswallet = new ethers.Wallet(privateKey, provider);
    snapshot = await provider.send('evm_snapshot', []);

    token = new ethers.Contract(TOKEN_ADDRESS, erc20abi, etherswallet);
    const balance = await token.balanceOf(etherswallet.address);
    await token.approve(contract.address, balance);

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
      const { preImage, encryptedRandom } = deposit.serialize(
        wallet.getViewingKeyPair().privateKey,
      );

      const depositTx = await contract.generateDeposit([preImage], [encryptedRandom]);

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

    expect(await contract.merkleRoot()).to.equal(
      '14fceeac99eb8419a2796d1958fc2050d489bf5a3eb170ef16a667060344ba90',
    );
  });

  it('[HH] Should return gas estimate for dummy transaction', async function run() {
    if (!process.env.RUN_HARDHAT_TESTS) {
      this.skip();
      return;
    }
    await testDeposit();

    const transaction = new Transaction(TOKEN_ADDRESS, TokenType.ERC20, chainID);
    transaction.outputs = [new Note(wallet2.addressKeys, RANDOM, 300n, TOKEN_ADDRESS)];
    const dummyTx = await transaction.dummyProve(wallet, testEncryptionKey);

    const tx = await contract.transact([dummyTx]);

    tx.from = '0x000000000000000000000000000000000000dEaD';

    expect((await provider.estimateGas(tx)).toNumber()).to.be.greaterThanOrEqual(0);
  });

  it.skip('[HH] Should return gas estimate number - relay', async function run() {
    if (!process.env.RUN_HARDHAT_TESTS) {
      this.skip();
      return;
    }
    await testDeposit();

    const transaction = new Transaction(TOKEN_ADDRESS, TokenType.ERC20, chainID);
    transaction.outputs = [new Note(wallet2.addressKeys, RANDOM, 300n, TOKEN_ADDRESS)];
    const dummyTx = await transaction.dummyProve(wallet, testEncryptionKey);
    const call = await contract.transact([dummyTx]);

    // @todo Copy from overrides from above when updating this

    const random = bytes.random();

    const overrides: CallOverrides = {
      from: '0x000000000000000000000000000000000000dEaD',
    };

    expect((await contract.relay([dummyTx], random, true, [call], overrides)).gasLimit).to.throw(); // greaterThanOrEqual(0);
  });

  /*
  it('[HH] Should return deposit weth amount', async function run() {
    if (!process.env.RUN_HARDHAT_TESTS) {
      this.skip();
      return;
    }

    const amount = BigNumber.from(1);
    const wethAddress = '0x0a180A76e4466bF68A7F86fB029BEd3cCcFaAac5';

    const randomPubKey1 = babyjubjub.privateKeyToPubKey(
      babyjubjub.seedToPrivateKey(bytes.random(32)),
    );

    expect(
      await (
        await contract.depositEth(amount, wethAddress, randomPubKey1)
      ).value,
    ).to.greaterThanOrEqual(1);
  });
  */

  it('[HH] Should return valid merkle roots', async function run() {
    if (!process.env.RUN_HARDHAT_TESTS) {
      this.skip();
      return;
    }
    expect(
      await contract.validateRoot(
        0,
        '0x14fceeac99eb8419a2796d1958fc2050d489bf5a3eb170ef16a667060344ba90',
      ),
    ).to.equal(true);
    expect(
      await contract.validateRoot(
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
    const fees = await contract.fees();
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
    contract.treeUpdates(eventsListener, nullifiersListener);

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

    await contract.getHistoricalEvents(
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

    const transaction = new Transaction(TOKEN_ADDRESS, TokenType.ERC20, chainID);
    transaction.outputs = [new Note(wallet2.addressKeys, RANDOM, 300n, TOKEN_ADDRESS)];
    transaction.withdraw(etherswallet.address, 100n);
    const serializedTx = await transaction.prove(lepton.prover, wallet, testEncryptionKey);

    const transact = await contract.transact([serializedTx]);

    // Send transact on chain
    const txTransact = await etherswallet.sendTransaction(transact);
    const [txResponseTransact] = await Promise.all([txTransact.wait(), awaitScan(wallet, chainID)]);

    // Event should have been scanned by automatic contract events:

    // @ts-ignore
    expect(resultEvent.txid).to.equal(hexlify(txResponseTransact.transactionHash));
    // @ts-ignore
    expect(resultNullifiers[0].txid).to.equal(hexlify(txResponseTransact.transactionHash));

    resultEvent = undefined;
    resultNullifiers = [];

    await contract.getHistoricalEvents(
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
    await lepton.scanHistory(chainID);
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
    const contractHash = await contract.hashCommitment(withdraw.preImage);

    expect(hexlify(contractHash)).to.equal(withdraw.hashHex);
  });

  it('[HH] Should deposit', async function run() {
    if (!process.env.RUN_HARDHAT_TESTS) {
      this.skip();
      return;
    }

    let result: CommitmentEvent;
    contract.treeUpdates(
      async (commitmentEvent: CommitmentEvent) => {
        result = commitmentEvent;
      },
      async () => {},
    );
    const merkleRootBefore = await contract.merkleRoot();

    const { masterPublicKey } = wallet;
    const viewingPrivateKey = wallet.getViewingKeyPair().privateKey;

    // Create deposit
    const deposit = new ERC20Deposit(masterPublicKey, RANDOM, VALUE, TOKEN_ADDRESS);
    const { preImage, encryptedRandom } = deposit.serialize(viewingPrivateKey);

    const depositTx = await contract.generateDeposit([preImage], [encryptedRandom]);

    const awaiterDeposit = awaitScan(wallet, chainID);

    // Send deposit on chain
    await (await etherswallet.sendTransaction(depositTx)).wait();

    // Wait for events to fire
    await new Promise((resolve) =>
      contract.contract.once(EventName.GeneratedCommitmentBatch, resolve),
    );

    await expect(awaiterDeposit).to.be.fulfilled;

    // Check result
    // @ts-ignore
    expect(result.treeNumber).to.equal(0);
    // @ts-ignore
    expect(result.startPosition).to.equal(0);
    // @ts-ignore
    expect(result.commitments.length).to.equal(1);

    const merkleRootAfterDeposit = await contract.merkleRoot();

    // Check merkle root changed
    expect(merkleRootAfterDeposit).not.to.equal(merkleRootBefore);
  });

  it('[HH] Should create serialized transactions and parse tree updates', async function run() {
    if (!process.env.RUN_HARDHAT_TESTS) {
      this.skip();
      return;
    }

    await testDeposit(1000n);
    const merkleRootAfterDeposit = await contract.merkleRoot();

    let result: CommitmentEvent;
    contract.treeUpdates(
      async (commitmentEvent: CommitmentEvent) => {
        result = commitmentEvent;
      },
      async () => {},
    );
    // Create transaction
    const transaction = new Transaction(TOKEN_ADDRESS, TokenType.ERC20, chainID);
    transaction.outputs = [new Note(wallet.addressKeys, RANDOM, 300n, TOKEN_ADDRESS)];
    transaction.withdraw(etherswallet.address, 100n);

    // Create transact
    const transact = await contract.transact([
      await transaction.prove(lepton.prover, wallet, testEncryptionKey),
    ]);

    // Send transact on chain
    await (await etherswallet.sendTransaction(transact)).wait();

    // Wait for events to fire
    await new Promise((resolve) => contract.contract.once(EventName.CommitmentBatch, resolve));

    // Check merkle root changed
    const merkleRootAfterTransact = await contract.merkleRoot();
    expect(merkleRootAfterTransact).to.not.equal(merkleRootAfterDeposit);

    // Check result
    // @ts-ignore
    expect(result.treeNumber).to.equal(0);
    // @ts-ignore
    expect(result.startPosition).to.equal(1);
    // @ts-ignore
    expect(result.commitments.length).to.equal(2);
  }).timeout(120000);

  afterEach(async () => {
    if (!process.env.RUN_HARDHAT_TESTS) {
      return;
    }
    lepton.unload();
    await provider.send('evm_revert', [snapshot]);
  });
});
