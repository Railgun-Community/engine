/* globals describe it beforeEach afterEach */
import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';

import BN from 'bn.js';
import { BigNumber, CallOverrides, ethers } from 'ethers';

// @ts-ignore
import artifacts from 'railgun-artifacts';

import memdown from 'memdown';
import { ERC20RailgunContract } from '../../src/contract';
import { ERC20Note } from '../../src/note';
import { ERC20Transaction } from '../../src/transaction/erc20';
import { Artifacts, Circuits } from '../../src/prover';
import { Lepton } from '../../src';

import { abi as erc20abi } from '../erc20abi.test';
import { config } from '../config.test';
import { ScannedEventData } from '../../src/wallet';
import { babyjubjub, bytes } from '../../src/utils';
import { CommitmentEvent, EventName } from '../../src/contract/erc20';
import { hexlify } from '../../src/utils/bytes';
import { Nullifier } from '../../src/merkletree';

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

const testMnemonic = config.mnemonic;
const testEncryptionKey = config.encryptionKey;

async function artifactsGetter(circuit: Circuits): Promise<Artifacts> {
  if (circuit === 'erc20small') {
    return artifacts.small;
  }
  return artifacts.large;
}

const TOKEN_ADDRESS = config.contracts.rail;

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

    lepton = new Lepton(memdown(), artifactsGetter);
    walletID = await lepton.createWalletFromMnemonic(testEncryptionKey, testMnemonic);
    await lepton.loadNetwork(chainID, config.contracts.proxy, provider, 0);
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

  it('[HH] Should return gas estimate number', async function run() {
    if (!process.env.RUN_HARDHAT_TESTS) {
      this.skip();
      return;
    }

    const transaction = new ERC20Transaction(TOKEN_ADDRESS, chainID);
    const dummyTx = await transaction.dummyProve(lepton.wallets[walletID], testEncryptionKey);
    const call = await contract.transact([dummyTx]);

    const random = babyjubjub.random();

    const overrides: CallOverrides = {
      from: '0x0000000000000000000000000000000000000000',
    };

    expect(
      await (
        await contract.relay([dummyTx], random, true, [call], overrides)
      ).gasLimit,
    ).to.greaterThanOrEqual(0);
  });

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

  it('[HH] Should return valid merkle roots', async function run() {
    if (!process.env.RUN_HARDHAT_TESTS) {
      this.skip();
      return;
    }
    expect(
      await contract.validateRoot(
        0,
        '14fceeac99eb8419a2796d1958fc2050d489bf5a3eb170ef16a667060344ba90',
      ),
    ).to.equal(true);
    expect(
      await contract.validateRoot(
        0,
        '09981e69d3ecf345fb3e2e48243889aa4ff906423d6a686005cac572a3a9632d',
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

    const address = (await lepton.wallets[walletID].addresses(chainID))[0];
    const { pubkey } = Lepton.decodeAddress(address);

    const RANDOM = '1e686e7506b0f4f21d6991b4cb58d39e77c31ed0577a986750c8dce8804af5b9';

    // Create deposit
    const deposit = await contract.generateDeposit([
      new ERC20Note(pubkey, RANDOM, new BN('11000000000000000000000000', 10), TOKEN_ADDRESS),
    ]);

    const awaiterScan = () =>
      new Promise((resolve, reject) =>
        lepton.wallets[walletID].once('scanned', ({ chainID: returnedChainID }: ScannedEventData) =>
          returnedChainID === chainID ? resolve(returnedChainID) : reject(),
        ),
      );

    // Send deposit on chain
    const tx = await etherswallet.sendTransaction(deposit);
    const [txResponse] = await Promise.all([tx.wait(), awaiterScan()]);

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

    const randomPubKey = babyjubjub.privateKeyToPubKey(
      babyjubjub.seedToPrivateKey(bytes.random(32)),
    );

    // Create transaction
    const transaction = new ERC20Transaction(TOKEN_ADDRESS, chainID);
    transaction.outputs = [new ERC20Note(randomPubKey, RANDOM, new BN('300', 10), TOKEN_ADDRESS)];

    // Create transact
    const transact = await contract.transact([
      await transaction.prove(lepton.prover, lepton.wallets[walletID], testEncryptionKey),
    ]);

    // Send transact on chain
    const txTransact = await etherswallet.sendTransaction(transact);
    const [txResponseTransact] = await Promise.all([txTransact.wait(), awaiterScan()]);

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

  it('[HH] Should create serialized transactions and parse tree updates', async function run() {
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

    const address = (await lepton.wallets[walletID].addresses(chainID))[0];
    const { pubkey } = Lepton.decodeAddress(address);

    const RANDOM = '1e686e7506b0f4f21d6991b4cb58d39e77c31ed0577a986750c8dce8804af5b9';

    // Create deposit
    const deposit = await contract.generateDeposit([
      new ERC20Note(pubkey, RANDOM, new BN('11000000000000000000000000', 10), TOKEN_ADDRESS),
    ]);

    const awaiterDeposit = new Promise((resolve, reject) =>
      lepton.wallets[walletID].once('scanned', ({ chainID: returnedChainID }: ScannedEventData) =>
        returnedChainID === chainID ? resolve(returnedChainID) : reject(),
      ),
    );

    // Send deposit on chain
    await (await etherswallet.sendTransaction(deposit)).wait();

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
    expect(merkleRootAfterDeposit).to.equal(
      '083e1ef25eee08184efd23a69db656c2ae1be3540c68b363139dce7dbac10ac7',
    );

    const randomPubKey = babyjubjub.privateKeyToPubKey(
      babyjubjub.seedToPrivateKey(bytes.random(32)),
    );

    // Create transaction
    const transaction = new ERC20Transaction(TOKEN_ADDRESS, chainID);
    transaction.outputs = [new ERC20Note(randomPubKey, RANDOM, new BN('300', 10), TOKEN_ADDRESS)];

    // Create transact
    const transact = await contract.transact([
      await transaction.prove(lepton.prover, lepton.wallets[walletID], testEncryptionKey),
    ]);

    // Send transact on chain
    await (await etherswallet.sendTransaction(transact)).wait();

    // Wait for events to fire
    await new Promise((resolve) =>
      contract.contract.once(EventName.EncryptedCommitmentBatch, resolve),
    );

    // Check merkle root changed
    expect(await contract.merkleRoot()).to.not.equal(merkleRootAfterDeposit);

    // Check result
    // @ts-ignore
    expect(result.treeNumber).to.equal(0);
    // @ts-ignore
    expect(result.startPosition).to.equal(1);
    // @ts-ignore
    expect(result.commitments.length).to.equal(3);
  }).timeout(120000);

  afterEach(async () => {
    if (!process.env.RUN_HARDHAT_TESTS) {
      return;
    }
    contract.unload();
    await provider.send('evm_revert', [snapshot]);
  });
});
