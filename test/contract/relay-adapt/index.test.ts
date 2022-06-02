/* globals describe it beforeEach afterEach */
import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { BigNumber, ethers, PopulatedTransaction } from 'ethers';
import memdown from 'memdown';
import { TransactionReceipt } from '@ethersproject/abstract-provider';
import { RelayAdaptContract } from '../../../src/contracts/relay-adapt';
import { RelayAdaptHelper } from '../../../src/contracts/relay-adapt/relay-adapt-helper';
import { Lepton } from '../../../src';
import { abi as erc20abi } from '../../erc20abi.test';
import { config } from '../../config.test';
import { Wallet } from '../../../src/wallet';
import { artifactsGetter, awaitScan } from '../../helper';
import { ERC20Deposit } from '../../../src/note/erc20-deposit';
import { bytes } from '../../../src/utils';
import { EventName, RailgunProxyContract } from '../../../src/contracts/railgun-proxy';
import { TransactionBatch } from '../../../src/transaction/transaction-batch';
import { TokenType } from '../../../src/models/formatted-types';
import { ERC20WithdrawNote, Note } from '../../../src/note';
import { ByteLength, nToHex } from '../../../src/utils/bytes';

chai.use(chaiAsPromised);
const { expect } = chai;

let provider: ethers.providers.JsonRpcProvider;
let chainID: number;
let lepton: Lepton;
let etherswallet: ethers.Wallet;
let snapshot: number;
let relayAdaptContract: RelayAdaptContract;
let proxyContract: RailgunProxyContract;
let walletID: string;
let wallet: Wallet;
let walletID2: string;
let wallet2: Wallet;

const testMnemonic = config.mnemonic;
const testEncryptionKey = config.encryptionKey;

const WETH_TOKEN_ADDRESS = config.contracts.weth9;
const RANDOM = bytes.random(16);

const DEAD_ADDRESS = '0x000000000000000000000000000000000000dEaD';

let testDepositBaseToken: (value?: bigint) => Promise<[TransactionReceipt, unknown]>;

describe('Relay Adapt/Index', function test() {
  this.timeout(60000);

  beforeEach(async () => {
    lepton = new Lepton(memdown(), artifactsGetter, undefined);

    walletID = await lepton.createWalletFromMnemonic(testEncryptionKey, testMnemonic, 0);
    wallet = lepton.wallets[walletID];
    walletID2 = await lepton.createWalletFromMnemonic(testEncryptionKey, testMnemonic, 1);
    wallet2 = lepton.wallets[walletID2];

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

    testDepositBaseToken = async (
      value: bigint = 10000n,
    ): Promise<[TransactionReceipt, unknown]> => {
      // Create deposit
      const deposit = new ERC20Deposit(wallet.masterPublicKey, RANDOM, value, WETH_TOKEN_ADDRESS);
      const viewingPrivateKey = wallet.getViewingKeyPair().privateKey;
      const depositInput = deposit.serialize(viewingPrivateKey);

      const depositTx = await relayAdaptContract.populateDepositBaseToken(depositInput);

      // Send deposit on chain
      const tx = await etherswallet.sendTransaction(depositTx);
      return Promise.all([tx.wait(), awaitScan(wallet, chainID)]);
    };
  });

  it('[HH] Should wrap and deposit base token', async function run() {
    if (!process.env.RUN_HARDHAT_TESTS) {
      this.skip();
      return;
    }

    const { masterPublicKey } = wallet;
    const viewingPrivateKey = wallet.getViewingKeyPair().privateKey;

    // Create deposit
    const deposit = new ERC20Deposit(masterPublicKey, RANDOM, 10000n, WETH_TOKEN_ADDRESS);
    const depositInput = deposit.serialize(viewingPrivateKey);

    const depositTx = await relayAdaptContract.populateDepositBaseToken(depositInput);

    const awaiterDeposit = awaitScan(wallet, chainID);

    // Send deposit on chain
    const txResponse = await etherswallet.sendTransaction(depositTx);

    const receiveCommitmentBatch = new Promise((resolve) =>
      proxyContract.contract.once(EventName.GeneratedCommitmentBatch, resolve),
    );

    await Promise.all([txResponse.wait(), receiveCommitmentBatch]);
    await expect(awaiterDeposit).to.be.fulfilled;

    expect(await wallet.getBalance(chainID, WETH_TOKEN_ADDRESS)).to.equal(9975n);
  });

  it('[HH] Should return gas estimate for withdraw base token', async function run() {
    if (!process.env.RUN_HARDHAT_TESTS) {
      this.skip();
      return;
    }

    await testDepositBaseToken();
    expect(await wallet.getBalance(chainID, WETH_TOKEN_ADDRESS)).to.equal(9975n);

    const transactionBatch = new TransactionBatch(WETH_TOKEN_ADDRESS, TokenType.ERC20, chainID);
    const relayerFee = new Note(wallet.addressKeys, bytes.random(16), 100n, WETH_TOKEN_ADDRESS);
    transactionBatch.addOutput(relayerFee); // Simulate Relayer fee output.

    const withdrawNote = new ERC20WithdrawNote(
      relayAdaptContract.address,
      300n,
      WETH_TOKEN_ADDRESS,
    );
    transactionBatch.setWithdraw(relayAdaptContract.address, withdrawNote.value);

    const dummyTransactions = await transactionBatch.generateDummySerializedTransactions(
      wallet,
      testEncryptionKey,
    );

    const random = '0x1234567890abcdef';

    const relayTransaction = await relayAdaptContract.populateWithdrawBaseToken(
      dummyTransactions,
      etherswallet.address,
      random,
    );

    relayTransaction.from = DEAD_ADDRESS;

    const gasEstimate = await provider.estimateGas(relayTransaction);
    expect(gasEstimate.toNumber()).to.be.greaterThan(0);
  });

  it.skip('[HH] Should execute relay adapt transaction for withdraw base token', async function run() {
    if (!process.env.RUN_HARDHAT_TESTS) {
      this.skip();
      return;
    }

    await testDepositBaseToken();
    expect(await wallet.getBalance(chainID, WETH_TOKEN_ADDRESS)).to.equal(9975n);

    // 1. Generate transaction batch to withdraw necessary amount, and pay Relayer.
    const transactionBatch = new TransactionBatch(WETH_TOKEN_ADDRESS, TokenType.ERC20, chainID);
    const relayerFee = new Note(wallet2.addressKeys, bytes.random(16), 100n, WETH_TOKEN_ADDRESS);
    transactionBatch.addOutput(relayerFee); // Simulate Relayer fee output.
    const withdrawNote = new ERC20WithdrawNote(
      relayAdaptContract.address,
      300n,
      WETH_TOKEN_ADDRESS,
    );
    transactionBatch.setWithdraw(relayAdaptContract.address, withdrawNote.value);

    // 2. Create dummy transactions from batch.
    const dummyTransactions = await transactionBatch.generateDummySerializedTransactions(
      wallet,
      testEncryptionKey,
    );

    // 3. Generate relay adapt params from dummy transactions.
    const random = '0x1234567890abcdef';
    const relayAdaptParams = await relayAdaptContract.getRelayAdaptParamsWithdrawBaseToken(
      dummyTransactions,
      etherswallet.address,
      random,
    );
    expect(relayAdaptParams).to.equal(
      '0xcb149c2bcbac51233445696c67bf4d3eddecfefa41ea709ee496374414eba74c',
    );

    // 4. Create real transactions with relay adapt params.
    transactionBatch.setAdaptID({
      contract: relayAdaptContract.address,
      parameters: relayAdaptParams,
    });
    const transactions = await transactionBatch.generateSerializedTransactions(
      lepton.prover,
      wallet,
      testEncryptionKey,
    );
    transactions.forEach((transaction) => {
      expect(transaction.boundParams.adaptContract).to.equal(relayAdaptContract.address);
      expect(transaction.boundParams.adaptParams).to.equal(relayAdaptParams);
    });

    const preEthBalance = await etherswallet.getBalance();

    // 5: Generate final relay transaction for withdraw base token.
    const relayTransaction = await relayAdaptContract.populateWithdrawBaseToken(
      transactions,
      etherswallet.address,
      random,
    );

    const awaiterWithdraw = awaitScan(wallet, chainID);

    // 6: Send relay transaction.
    const txResponse = await etherswallet.sendTransaction(relayTransaction);

    const receiveCommitmentBatch = new Promise((resolve) =>
      proxyContract.contract.once(EventName.CommitmentBatch, resolve),
    );

    const [txReceipt] = await Promise.all([txResponse.wait(), receiveCommitmentBatch]);
    await expect(awaiterWithdraw).to.be.fulfilled;

    expect(await wallet.getBalance(chainID, WETH_TOKEN_ADDRESS)).to.equal(
      BigInt(9975 /* original */ - 100 /* relayer fee */ - 300 /* withdraw amount */),
    );

    const callResultError = relayAdaptContract.getCallResultError(txReceipt);
    expect(callResultError).to.equal(undefined);

    const postEthBalance = await etherswallet.getBalance();
    expect(preEthBalance.toBigInt() - txReceipt.gasUsed.toBigInt() + 300n).to.equal(
      postEthBalance.toBigInt(),
    );
  });

  it.only('[HH] Should deposit all leftover WETH in relay adapt contract', async function run() {
    if (!process.env.RUN_HARDHAT_TESTS) {
      this.skip();
      return;
    }

    await testDepositBaseToken();
    expect(await wallet.getBalance(chainID, WETH_TOKEN_ADDRESS)).to.equal(9975n);

    // 1. Generate transaction batch to withdraw necessary amount, and pay Relayer.
    const transactionBatch = new TransactionBatch(WETH_TOKEN_ADDRESS, TokenType.ERC20, chainID);
    // const relayerFee = new Note(wallet2.addressKeys, bytes.random(16), 300n, WETH_TOKEN_ADDRESS);
    // transactionBatch.addOutput(relayerFee); // Simulate Relayer fee output.
    const withdrawNote = new ERC20WithdrawNote(
      relayAdaptContract.address,
      1000n,
      WETH_TOKEN_ADDRESS,
    );
    transactionBatch.setWithdraw(relayAdaptContract.address, withdrawNote.value);

    const serializedTxs = await transactionBatch.generateSerializedTransactions(
      lepton.prover,
      wallet,
      testEncryptionKey,
    );
    const transact = await proxyContract.transact(serializedTxs);

    // Withdraw to relay adapt.
    const txTransact = await etherswallet.sendTransaction(transact);
    await Promise.all([txTransact.wait(), awaitScan(wallet, chainID)]);

    const wethTokenContract = new ethers.Contract(WETH_TOKEN_ADDRESS, erc20abi, etherswallet);

    let relayAdaptAddressBalance: BigNumber = await wethTokenContract.balanceOf(
      relayAdaptContract.address,
    );
    expect(relayAdaptAddressBalance.toBigInt()).to.equal(998n);

    // Value 0n doesn't matter - all WETH should be deposited anyway.
    await testDepositBaseToken(0n);

    relayAdaptAddressBalance = await wethTokenContract.balanceOf(relayAdaptContract.address);
    expect(relayAdaptAddressBalance.toBigInt()).to.equal(0n);
  });

  it('[HH] Should execute relay adapt transaction for cross contract call', async function run() {
    if (!process.env.RUN_HARDHAT_TESTS) {
      this.skip();
      return;
    }

    await testDepositBaseToken();
    expect(await wallet.getBalance(chainID, WETH_TOKEN_ADDRESS)).to.equal(9975n);

    // 1. Generate transaction batch to withdraw necessary amount, and pay Relayer.
    const transactionBatch = new TransactionBatch(WETH_TOKEN_ADDRESS, TokenType.ERC20, chainID);
    // const relayerFee = new Note(wallet2.addressKeys, bytes.random(16), 300n, WETH_TOKEN_ADDRESS);
    // transactionBatch.addOutput(relayerFee); // Simulate Relayer fee output.
    const withdrawNote = new ERC20WithdrawNote(
      relayAdaptContract.address,
      1000n,
      WETH_TOKEN_ADDRESS,
    );
    transactionBatch.setWithdraw(relayAdaptContract.address, withdrawNote.value);

    // 2. Create dummy transactions from batch.
    const dummyTransactions = await transactionBatch.generateDummySerializedTransactions(
      wallet,
      testEncryptionKey,
    );

    // 3. Create the cross contract call.
    // Cross contract call: send 990n WETH tokens to Dead address.
    const wethTokenContract = new ethers.Contract(WETH_TOKEN_ADDRESS, erc20abi, etherswallet);
    const sendToAddress = DEAD_ADDRESS;
    const sendAmount = 990n;
    const crossContractCalls: PopulatedTransaction[] = [
      await wethTokenContract.populateTransaction.transfer(sendToAddress, sendAmount),
    ];

    // 4. Create deposit inputs.
    const depositRandom = '0x10203040506070809000102030405060';
    const depositTokens: string[] = [WETH_TOKEN_ADDRESS];
    const relayDepositInputs = RelayAdaptHelper.generateRelayDepositInputs(
      wallet,
      depositRandom,
      depositTokens,
    );

    // 5. Generate relay adapt params from dummy transactions.
    const random = '0x102030405060708090AABBCCDDEEFF00';
    const relayAdaptParams = await relayAdaptContract.getRelayAdaptParamsCrossContractCalls(
      dummyTransactions,
      crossContractCalls,
      relayDepositInputs,
      random,
    );
    // expect(relayAdaptParams).to.equal(
    //   '0x03ffbf8550f79cd10f590a693c806e836fba9fc9d6487a442324a9f6a20f8fbb',
    // );

    // 6. Create real transactions with relay adapt params.
    transactionBatch.setAdaptID({
      contract: relayAdaptContract.address,
      parameters: relayAdaptParams,
    });
    const transactions = await transactionBatch.generateSerializedTransactions(
      lepton.prover,
      wallet,
      testEncryptionKey,
    );
    transactions.forEach((transaction) => {
      expect(transaction.boundParams.adaptContract).to.equal(relayAdaptContract.address);
      expect(transaction.boundParams.adaptParams).to.equal(relayAdaptParams);
    });

    // 7. Generate real relay transaction for cross contract call.
    const relayTransaction = await relayAdaptContract.populateCrossContractCalls(
      transactions,
      crossContractCalls,
      relayDepositInputs,
      random,
    );

    const awaiterWithdraw = awaitScan(wallet, chainID);

    // 8. Send transaction.
    const txResponse = await etherswallet.sendTransaction(relayTransaction);

    const receiveCommitmentBatch = new Promise((resolve) =>
      proxyContract.contract.once(EventName.CommitmentBatch, resolve),
    );

    const [txReceipt] = await Promise.all([txResponse.wait(), receiveCommitmentBatch]);
    await expect(awaiterWithdraw).to.be.fulfilled;

    // Dead address should have 990n WETH.
    const sendAddressBalance: BigNumber = await wethTokenContract.balanceOf(sendToAddress);
    expect(sendAddressBalance.toBigInt()).to.equal(sendAmount);

    const relayAdaptAddressBalance: BigNumber = await wethTokenContract.balanceOf(
      relayAdaptContract.address,
    );
    expect(relayAdaptAddressBalance.toBigInt()).to.equal(0n);

    // TODO: Fix this assertion.
    const callResultError = relayAdaptContract.getCallResultError(txReceipt);
    expect(callResultError).to.equal(undefined);

    // TODO: Fix this assertion.
    expect(await wallet.getBalance(chainID, WETH_TOKEN_ADDRESS)).to.equal(
      BigInt(
        9975 /* original deposit */ -
          300 /* relayer fee */ -
          1000 /* withdraw */ +
          8 /* re-deposit (1000 withdraw amount - 2 withdraw fee - 990 send amount - 0 re-deposit fee) */,
      ),
    );
  });

  it.skip('[HH] Should revert send for failing cross contract call', async function run() {
    if (!process.env.RUN_HARDHAT_TESTS) {
      this.skip();
      return;
    }

    await testDepositBaseToken(100000n);
    expect(await wallet.getBalance(chainID, WETH_TOKEN_ADDRESS)).to.equal(99750n);

    // 1. Generate transaction batch to withdraw necessary amount, and pay Relayer.
    const transactionBatch = new TransactionBatch(WETH_TOKEN_ADDRESS, TokenType.ERC20, chainID);
    const relayerFee = new Note(wallet2.addressKeys, bytes.random(16), 300n, WETH_TOKEN_ADDRESS);
    transactionBatch.addOutput(relayerFee); // Simulate Relayer fee output.
    const withdrawNote = new ERC20WithdrawNote(
      relayAdaptContract.address,
      10000n,
      WETH_TOKEN_ADDRESS,
    );
    transactionBatch.setWithdraw(relayAdaptContract.address, withdrawNote.value);

    // 2. Create dummy transactions from batch.
    const dummyTransactions = await transactionBatch.generateDummySerializedTransactions(
      wallet,
      testEncryptionKey,
    );

    // 3. Create the cross contract call.
    // Cross contract call: send 1 WETH token to Dead address.
    const wethTokenContract = new ethers.Contract(WETH_TOKEN_ADDRESS, erc20abi, etherswallet);
    const sendToAddress = DEAD_ADDRESS;
    const sendAmount = 20000n; // More than is available (after 0.25% withdraw fee).
    const crossContractCalls: PopulatedTransaction[] = [
      await wethTokenContract.populateTransaction.transfer(sendToAddress, sendAmount),
    ];

    // 4. Create deposit inputs.
    const depositRandom = '10203040506070809000102030405060';
    const depositTokens: string[] = [WETH_TOKEN_ADDRESS];
    const relayDepositInputs = RelayAdaptHelper.generateRelayDepositInputs(
      wallet,
      depositRandom,
      depositTokens,
    );

    // 5. Generate relay adapt params from dummy transactions.
    const random = '0x1234567890abcdef';
    const relayAdaptParams = await relayAdaptContract.getRelayAdaptParamsCrossContractCalls(
      dummyTransactions,
      crossContractCalls,
      relayDepositInputs,
      random,
    );
    // expect(relayAdaptParams).to.deep.equal('');

    // 6. Create real transactions with relay adapt params.
    transactionBatch.setAdaptID({
      contract: relayAdaptContract.address,
      parameters: relayAdaptParams,
    });
    const transactions = await transactionBatch.generateSerializedTransactions(
      lepton.prover,
      wallet,
      testEncryptionKey,
    );
    transactions.forEach((transaction) => {
      expect(transaction.boundParams.adaptContract).to.equal(relayAdaptContract.address);
      expect(transaction.boundParams.adaptParams).to.equal(relayAdaptParams);
    });

    // 7. Generate real relay transaction for cross contract call.
    const relayTransaction = await relayAdaptContract.populateCrossContractCalls(
      transactions,
      crossContractCalls,
      relayDepositInputs,
      random,
    );

    const awaiterWithdraw = awaitScan(wallet, chainID);

    // 8. Send transaction.
    const txResponse = await etherswallet.sendTransaction(relayTransaction);

    const receiveCommitmentBatch = new Promise((resolve) =>
      proxyContract.contract.once(EventName.CommitmentBatch, resolve),
    );

    const [txReceipt] = await Promise.all([txResponse.wait(), receiveCommitmentBatch]);
    await expect(awaiterWithdraw).to.be.fulfilled;

    // Dead address should have 0 WETH.
    const sendAddressBalance: BigNumber = await wethTokenContract.balanceOf(sendToAddress);
    expect(sendAddressBalance.toBigInt()).to.equal(0n);

    const relayAdaptAddressBalance: BigNumber = await wethTokenContract.balanceOf(
      relayAdaptContract.address,
    );
    expect(relayAdaptAddressBalance.toBigInt()).to.equal(0n);

    const callResultError = relayAdaptContract.getCallResultError(txReceipt);
    expect(callResultError).to.equal('Unknown Relay Adapt error.');

    expect(await wallet.getBalance(chainID, WETH_TOKEN_ADDRESS)).to.equal(
      BigInt(
        99750 /* original */ -
          300 /* relayer fee */ -
          10000 /* withdraw amount */ -
          0 /* failed cross contract send: no change */ +
          9750 /* re-deposit amount */ -
          24 /* deposit fee */,
      ),
    );
  });

  it('Should generate relay deposit notes and inputs', () => {
    const depositTokens: string[] = [config.contracts.weth9, config.contracts.rail];

    const random = '10203040506070809000102030405060';
    const relayDepositInputs = RelayAdaptHelper.generateRelayDepositInputs(
      wallet,
      random,
      depositTokens,
    );

    expect(relayDepositInputs.length).to.equal(2);
    expect(
      relayDepositInputs.map((depositInput) => depositInput.preImage.token.tokenAddress),
    ).to.deep.equal(depositTokens);
    relayDepositInputs.forEach((relayDepositInput) => {
      expect(relayDepositInput.preImage.npk).to.equal(
        nToHex(
          3348140451435708797167073859596593490034226162440317170509481065740328487080n,
          ByteLength.UINT_256,
          true,
        ),
      );
      expect(relayDepositInput.preImage.token.tokenType).to.equal(
        '0x0000000000000000000000000000000000000000',
      );
    });
  });

  afterEach(async () => {
    if (!process.env.RUN_HARDHAT_TESTS) {
      return;
    }
    lepton.unload();
    await provider.send('evm_revert', [snapshot]);
  });
});
