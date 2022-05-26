/* globals describe it beforeEach afterEach */
import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { ethers } from 'ethers';
import memdown from 'memdown';
import { RelayAdaptContract } from '../../../src/contracts/relay-adapt';
import { Lepton } from '../../../src';
import { abi as erc20abi } from '../../erc20abi.test';
import { config } from '../../config.test';
import { Wallet } from '../../../src/wallet';
import { artifactsGetter, awaitScan, DECIMALS_18 } from '../../helper';
import { ERC20Deposit } from '../../../src/note/erc20-deposit';
import { bytes } from '../../../src/utils';
import { EventName } from '../../../src/contracts/railgun-proxy';

chai.use(chaiAsPromised);
const { expect } = chai;

let provider: ethers.providers.JsonRpcProvider;
let chainID: number;
let lepton: Lepton;
let etherswallet: ethers.Wallet;
let snapshot: number;
let token: ethers.Contract;
let relayAdaptContract: RelayAdaptContract;
let walletID: string;
let wallet: Wallet;

const testMnemonic = config.mnemonic;
const testEncryptionKey = config.encryptionKey;

const WETH_TOKEN_ADDRESS = config.contracts.weth9;
const RANDOM = bytes.random(16);
const VALUE = BigInt(10000) * DECIMALS_18;

// let testDeposit: (value?: bigint) => Promise<[TransactionReceipt, unknown]>;

describe('Relay Adapt/Index', function test() {
  this.timeout(60000);

  beforeEach(async () => {
    lepton = new Lepton(memdown(), artifactsGetter, undefined);

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
    relayAdaptContract = lepton.relayAdaptContracts[chainID];

    const { privateKey } = ethers.utils.HDNode.fromMnemonic(config.mnemonic).derivePath(
      ethers.utils.defaultPath,
    );
    etherswallet = new ethers.Wallet(privateKey, provider);
    snapshot = await provider.send('evm_snapshot', []);

    token = new ethers.Contract(WETH_TOKEN_ADDRESS, erc20abi, etherswallet);
    const balance = await token.balanceOf(etherswallet.address);
    await token.approve(relayAdaptContract.address, balance);

    walletID = await lepton.createWalletFromMnemonic(testEncryptionKey, testMnemonic, 0);
    wallet = lepton.wallets[walletID];
  });

  // it('[HH] Should return gas estimate number - relay', async function run() {
  //   if (!process.env.RUN_HARDHAT_TESTS) {
  //     this.skip();
  //     return;
  //   }
  //   await testDeposit();

  //   const transactionBatch = new TransactionBatch(WETH_TOKEN_ADDRESS, TokenType.ERC20, chainID);
  //   transactionBatch.addOutput(new Note(wallet2.addressKeys, RANDOM, 300n, WETH_TOKEN_ADDRESS));
  //   const dummyTxs = await transactionBatch.generateDummySerializedTransactions(
  //     wallet,
  //     testEncryptionKey,
  //   );
  //   const call = await relayAdaptContract.transact(dummyTxs);

  //   // @todo Copy from overrides from above when updating this

  //   const random = bytes.random();

  //   const callOverrides: CallOverrides = {
  //     from: '0x000000000000000000000000000000000000dEaD',
  //   };

  //   expect(
  //     (await relayAdaptContract.relay(dummyTxs, random, true, [call], overrides)).gasLimit,
  //   ).to.throw(); // greaterThanOrEqual(0);
  // });

  it.skip('[HH] Should wrap and deposit base token', async function run() {
    if (!process.env.RUN_HARDHAT_TESTS) {
      this.skip();
      return;
    }

    const { masterPublicKey } = wallet;
    const viewingPrivateKey = wallet.getViewingKeyPair().privateKey;

    // Create deposit
    const deposit = new ERC20Deposit(masterPublicKey, RANDOM, VALUE, WETH_TOKEN_ADDRESS);
    const depositInput = deposit.serialize(viewingPrivateKey);

    const depositTx = await relayAdaptContract.depositBaseToken(depositInput);

    const awaiterDeposit = awaitScan(wallet, chainID);

    // Send deposit on chain
    const txResponse = await etherswallet.sendTransaction(depositTx);

    const receiveCommitmentBatch = new Promise((resolve) =>
      relayAdaptContract.contract.once(EventName.GeneratedCommitmentBatch, resolve),
    );

    await Promise.all([txResponse.wait(), receiveCommitmentBatch]);
    await expect(awaiterDeposit).to.be.fulfilled;
  });

  afterEach(async () => {
    if (!process.env.RUN_HARDHAT_TESTS) {
      return;
    }
    lepton.unload();
    await provider.send('evm_revert', [snapshot]);
  });
});
