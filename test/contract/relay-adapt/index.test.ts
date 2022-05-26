/* globals describe it beforeEach afterEach */
import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { ethers } from 'ethers';
import memdown from 'memdown';
import { TransactionReceipt } from '@ethersproject/abstract-provider';
import { RelayAdaptContract } from '../../../src/contracts/relay-adapt';
import { Lepton } from '../../../src';
import { abi as erc20abi } from '../../erc20abi.test';
import { config } from '../../config.test';
import { Wallet } from '../../../src/wallet';
import { artifactsGetter, awaitScan, DECIMALS_18 } from '../../helper';
import { ERC20Deposit } from '../../../src/note/erc20-deposit';
import { bytes } from '../../../src/utils';
import { EventName, RailgunProxyContract } from '../../../src/contracts/railgun-proxy';
import { TransactionBatch } from '../../../src/transaction/transaction-batch';
import { TokenType } from '../../../src/models/formatted-types';
import { ERC20WithdrawNote } from '../../../src/note';

chai.use(chaiAsPromised);
const { expect } = chai;

let provider: ethers.providers.JsonRpcProvider;
let chainID: number;
let lepton: Lepton;
let etherswallet: ethers.Wallet;
let snapshot: number;
let token: ethers.Contract;
let relayAdaptContract: RelayAdaptContract;
let proxyContract: RailgunProxyContract;
let walletID: string;
let wallet: Wallet;

const testMnemonic = config.mnemonic;
const testEncryptionKey = config.encryptionKey;

const WETH_TOKEN_ADDRESS = config.contracts.weth9;
const RANDOM = bytes.random(16);
const VALUE = BigInt(10000) * DECIMALS_18;

let testDepositBaseToken: (value?: bigint) => Promise<[TransactionReceipt, unknown]>;

describe('Relay Adapt/Index', function test() {
  this.timeout(60000);

  beforeEach(async () => {
    lepton = new Lepton(memdown(), artifactsGetter, undefined);

    walletID = await lepton.createWalletFromMnemonic(testEncryptionKey, testMnemonic, 0);
    wallet = lepton.wallets[walletID];

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
    relayAdaptContract = lepton.relayAdaptContracts[chainID];

    const { privateKey } = ethers.utils.HDNode.fromMnemonic(testMnemonic).derivePath(
      ethers.utils.defaultPath,
    );
    etherswallet = new ethers.Wallet(privateKey, provider);
    snapshot = await provider.send('evm_snapshot', []);

    token = new ethers.Contract(WETH_TOKEN_ADDRESS, erc20abi, etherswallet);
    const balance = await token.balanceOf(etherswallet.address);
    await token.approve(relayAdaptContract.address, balance);

    testDepositBaseToken = async (
      value: bigint = BigInt(110000) * DECIMALS_18,
    ): Promise<[TransactionReceipt, unknown]> => {
      // Create deposit
      const deposit = new ERC20Deposit(wallet.masterPublicKey, RANDOM, value, WETH_TOKEN_ADDRESS);
      const depositInput = deposit.serialize(wallet.getViewingKeyPair().privateKey);

      const depositTx = await relayAdaptContract.depositBaseToken(depositInput);

      // Send deposit on chain
      const tx = await etherswallet.sendTransaction(depositTx);
      return Promise.all([tx.wait(), awaitScan(wallet, chainID)]);
    };
  });

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
      proxyContract.contract.once(EventName.GeneratedCommitmentBatch, resolve),
    );

    await Promise.all([txResponse.wait(), receiveCommitmentBatch]);
    await expect(awaiterDeposit).to.be.fulfilled;
  });

  // it.skip('[HH] Should return gas estimate for dummy relay transaction', async function run() {
  //   if (!process.env.RUN_HARDHAT_TESTS) {
  //     this.skip();
  //     return;
  //   }

  //   await testDepositBaseToken();

  //   const transactionBatch = new TransactionBatch(WETH_TOKEN_ADDRESS, TokenType.ERC20, chainID);
  //   transactionBatch.setWithdraw(etherswallet.address, 300n);

  //   const serializedTransactions = await transactionBatch.generateDummySerializedTransactions(
  //     wallet,
  //     testEncryptionKey,
  //   );

  //   tx.from = '0x000000000000000000000000000000000000dEaD';

  //   expect((await provider.estimateGas(tx)).toNumber()).to.be.greaterThanOrEqual(0);
  // });

  it.skip('Should create and set relay adapt params for withdraw base token', async () => {
    await testDepositBaseToken();

    const transactionBatch = new TransactionBatch(WETH_TOKEN_ADDRESS, TokenType.ERC20, chainID);
    const withdrawNote = new ERC20WithdrawNote(etherswallet.address, 300n, WETH_TOKEN_ADDRESS);
    transactionBatch.setWithdraw(withdrawNote.withdrawAddress, withdrawNote.value);

    const serializedTransactions = await transactionBatch.generateDummySerializedTransactions(
      wallet,
      testEncryptionKey,
    );

    const random = '0x1234567890abcdef';

    const relayAdaptParams = await relayAdaptContract.getRelayAdaptParamsWithdrawBaseToken(
      serializedTransactions,
      withdrawNote,
      random,
    );

    expect(relayAdaptParams).to.deep.equal({});
  });

  it('Should generate relay deposit notes and inputs', () => {
    const depositTokens: string[] = [config.contracts.weth9, config.contracts.rail];

    const random = '10203040506070809000102030405060';

    const relayDeposits = RelayAdaptContract.generateRelayDeposits(
      wallet.masterPublicKey,
      random,
      depositTokens,
    );

    expect(relayDeposits.length).to.equal(2);
    relayDeposits.forEach((relayDeposit) => {
      expect(relayDeposit.notePublicKey).to.equal(
        3348140451435708797167073859596593490034226162440317170509481065740328487080n,
      );
      expect(relayDeposit.tokenType).to.equal('0x0000000000000000000000000000000000000000');
    });

    const viewingPrivateKey = wallet.getViewingKeyPair().privateKey;
    const relayDepositInputs = RelayAdaptContract.generateRelayDepositInputs(
      viewingPrivateKey,
      relayDeposits,
    );

    expect(relayDepositInputs.length).to.equal(2);
    expect(
      relayDepositInputs.map((depositInput) => depositInput.preImage.token.tokenAddress),
    ).to.deep.equal(depositTokens);
  });

  afterEach(async () => {
    if (!process.env.RUN_HARDHAT_TESTS) {
      return;
    }
    lepton.unload();
    await provider.send('evm_revert', [snapshot]);
  });
});
