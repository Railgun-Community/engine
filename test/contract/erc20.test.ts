/* globals describe it beforeEach afterEach */
import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';

import { CallOverrides, ethers } from 'ethers';

import memdown from 'memdown';
import { ERC20RailgunContract } from '../../src/contract';
import { Note, WithdrawNote } from '../../src/note';
import { Transaction } from '../../src/transaction';
import { Lepton } from '../../src';

import { abi as erc20abi } from '../erc20abi.test';
import { config } from '../config.test';
import { ScannedEventData, Wallet } from '../../src/wallet';
import { babyjubjub } from '../../src/utils';
import { hexlify } from '../../src/utils/bytes';
import { Nullifier } from '../../src/merkletree';
import { artifactsGetter, awaitScan, DECIMALS } from '../helper';
import { Deposit } from '../../src/note/deposit';
import { CommitmentEvent } from '../../src/contract/erc20/events';
import { EventName } from '../../src/contract/erc20';

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
let wallet: Wallet;

const testMnemonic = config.mnemonic;
const testEncryptionKey = config.encryptionKey;

const TOKEN_ADDRESS = config.contracts.rail;
const RANDOM = '0x1e686e7506b0f4f21d6991b4cb58d39e';
const VALUE = 10000n * DECIMALS;

let testDeposit: (value?: bigint) => Promise<[ethers.providers.TransactionReceipt, unknown]>;

// eslint-disable-next-line func-names
describe('Contract/Index', function () {
  this.timeout(60000);

  beforeEach(async () => {
    if (!process.env.RUN_HARDHAT_TESTS) {
      return;
    }

    provider = new ethers.providers.JsonRpcProvider(config.rpc);
    chainID = (await provider.getNetwork()).chainId;
    contract = new ERC20RailgunContract(config.contracts.proxy, provider);

    const { privateKey } = ethers.utils.HDNode.fromMnemonic(config.mnemonic).derivePath(
      ethers.utils.defaultPath,
    );
    etherswallet = new ethers.Wallet(privateKey, provider);
    snapshot = await provider.send('evm_snapshot', []);

    token = new ethers.Contract(TOKEN_ADDRESS, erc20abi, etherswallet);
    const balance = await token.balanceOf(etherswallet.address);
    await token.approve(contract.address, balance);

    lepton = new Lepton(memdown(), artifactsGetter, undefined, console);
    walletID = await lepton.createWalletFromMnemonic(testEncryptionKey, testMnemonic);
    await lepton.loadNetwork(chainID, config.contracts.proxy, provider, 0);
    wallet = lepton.wallets[walletID];

    // fn to create deposit tx for tests
    // tx should be complete and balances updated after await
    testDeposit = async (
      value: bigint = 10000n * DECIMALS,
    ): Promise<[ethers.providers.TransactionReceipt, unknown]> => {
      // Create deposit
      const deposit = new Deposit(wallet.addressKeys.masterPublicKey, RANDOM, value, TOKEN_ADDRESS);
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

  it.skip('[HH] Should return gas estimate number - relay', async function run() {
    if (!process.env.RUN_HARDHAT_TESTS) {
      this.skip();
      return;
    }
    await testDeposit();

    const transaction = new Transaction(TOKEN_ADDRESS, chainID);
    const dummyTx = await transaction.dummyProve(wallet, testEncryptionKey);
    const call = await contract.transact([dummyTx]);

    const random = babyjubjub.random();

    const overrides: CallOverrides = {
      from: '0x0000000000000000000000000000000000000000',
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

    let startingBlock = await provider.getBlockNumber();

    const [txResponse] = await testDeposit();
    let resultEvent: CommitmentEvent;
    const eventsListener = async (commitmentEvent: CommitmentEvent) => {
      resultEvent = commitmentEvent;
    };
    const resultNullifiers: Nullifier[] = [];
    const nullifiersListener = async (nullifiers: Nullifier[]) => {
      resultNullifiers.push(...nullifiers);
    };

    await contract.getHistoricalEvents(
      startingBlock,
      eventsListener,
      nullifiersListener,
      async () => {},
    );

    // @ts-ignore
    expect(resultEvent).to.be.an('object', 'No event in history for deposit');
    // @ts-ignore
    expect(resultEvent.txid).to.equal(hexlify(txResponse.transactionHash));
    // @ts-ignore
    expect(resultNullifiers.length).to.equal(0);

    startingBlock = await provider.getBlockNumber();

    // Create transaction
    const transaction = new Transaction(TOKEN_ADDRESS, chainID, 0);
    transaction.outputs = [new Note(wallet.addressKeys, RANDOM, 300n, TOKEN_ADDRESS)];

    // Create transact
    const transact = await contract.transact([
      await transaction.prove(lepton.prover, wallet, testEncryptionKey),
    ]);

    // Send transact on chain
    const txTransact = await etherswallet.sendTransaction(transact);
    const [txResponseTransact] = await Promise.all([txTransact.wait(), awaitScan(wallet, chainID)]);

    await contract.getHistoricalEvents(
      startingBlock,
      eventsListener,
      nullifiersListener,
      async () => {},
    );

    // @ts-ignore
    expect(resultEvent.txid).to.equal(hexlify(txResponseTransact.transactionHash));
    // @ts-ignore
    expect(resultNullifiers.length).to.equal(2);
  }).timeout(120000);

  it('Should get note hashes', async function run() {
    if (!process.env.RUN_HARDHAT_TESTS) {
      this.skip();
      return;
    }
    const withdraw = new WithdrawNote(etherswallet.address, 100n, token.address);
    const contractHash = await contract.hashCommitment(withdraw.preImage);

    expect(hexlify(contractHash)).to.equal(withdraw.hash);
  });

  it('[HH] Should create serialized transactions and parse tree updates', async function run() {
    if (!process.env.RUN_HARDHAT_TESTS) {
      this.skip();
      return;
    }

    // TODO-balances

    // const { log } = console;

    let result: CommitmentEvent;
    contract.treeUpdates(
      async (commitmentEvent: CommitmentEvent) => {
        result = commitmentEvent;
        // log(result);
      },
      async () => {},
    );

    const merkleRootBefore = await contract.merkleRoot();

    const address = await wallet.getAddress(chainID);
    const { masterPublicKey } = Lepton.decodeAddress(address);
    const viewingPrivateKey = wallet.getNullifyingKey();

    // Create deposit
    const deposit = new Deposit(masterPublicKey, RANDOM, VALUE, TOKEN_ADDRESS);
    const { preImage, encryptedRandom } = deposit.serialize(viewingPrivateKey);

    const depositTx = await contract.generateDeposit([preImage], [encryptedRandom]);

    const awaiterDeposit = new Promise((resolve, reject) =>
      wallet.once('scanned', ({ chainID: returnedChainID }: ScannedEventData) =>
        returnedChainID === chainID ? resolve(returnedChainID) : reject(),
      ),
    );

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

    // Create transaction
    const transaction = new Transaction(TOKEN_ADDRESS, chainID);
    transaction.outputs = [new Note(wallet.addressKeys, RANDOM, 300n, TOKEN_ADDRESS)];

    // Create transact
    const transact = await contract.transact([
      await transaction.prove(lepton.prover, wallet, testEncryptionKey),
    ]);

    // Send transact on chain
    await (await etherswallet.sendTransaction(transact)).wait();

    // Wait for events to fire
    await new Promise((resolve) => contract.contract.once(EventName.CommitmentBatch, resolve));

    // Check merkle root changed
    expect(await contract.merkleRoot()).to.not.equal(merkleRootAfterDeposit);

    // Check result
    // @ts-ignore
    expect(result.treeNumber).to.equal(0);
    // @ts-ignore
    expect(result.startPosition).to.equal(1);
    // @ts-ignore
    expect(result.commitments.length).to.equal(3);
  }).timeout(40000);

  afterEach(async () => {
    if (!process.env.RUN_HARDHAT_TESTS) {
      return;
    }
    contract.unload();
    await provider.send('evm_revert', [snapshot]);
  });
});
