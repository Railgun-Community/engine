/* eslint-disable prefer-template */
import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { BigNumber, ethers, PopulatedTransaction } from 'ethers';
import memdown from 'memdown';
import { groth16 } from 'snarkjs';
import { JsonRpcProvider, TransactionReceipt } from '@ethersproject/providers';
import { bytesToHex } from 'ethereum-cryptography/utils';
import { RelayAdaptHelper } from '../relay-adapt-helper';
import { abi as erc20Abi } from '../../../test/test-erc20-abi.test';
import { abi as erc721Abi } from '../../../test/test-erc721-abi.test';
import { config } from '../../../test/config.test';
import { RailgunWallet } from '../../../wallet/railgun-wallet';
import { awaitMultipleScans, awaitScan, testArtifactsGetter } from '../../../test/helper.test';
import { NFTTokenData, OutputType } from '../../../models/formatted-types';
import { ByteLength, hexToBytes, nToHex, randomHex } from '../../../utils/bytes';
import { ERC20, TestERC721 } from '../../../typechain-types';
import { Groth16 } from '../../../prover/prover';
import { Chain, ChainType } from '../../../models/engine-types';
import { RailgunEngine } from '../../../railgun-engine';
import { RailgunSmartWalletContract } from '../../railgun-smart-wallet/railgun-smart-wallet';
import {
  MINIMUM_RELAY_ADAPT_CROSS_CONTRACT_CALLS_GAS_LIMIT,
  MINIMUM_RELAY_ADAPT_CROSS_CONTRACT_CALLS_MINIMUM_GAS_FOR_CONTRACT,
  RelayAdaptContract,
} from '../relay-adapt';
import { ShieldNoteERC20 } from '../../../note/erc20/shield-note-erc20';
import { TransactNote } from '../../../note/transact-note';
import { UnshieldNoteERC20 } from '../../../note/erc20/unshield-note-erc20';
import { TransactionStruct } from '../../../models';
import { TransactionBatch } from '../../../transaction/transaction-batch';
import { getTokenDataERC20 } from '../../../note/note-util';
import { mintNFTsID01ForTest, shieldNFTForTest } from '../../../test/shared-test.test';
import { UnshieldNoteNFT } from '../../../note';

chai.use(chaiAsPromised);
const { expect } = chai;

let provider: JsonRpcProvider;
let chain: Chain;
let engine: RailgunEngine;
let ethersWallet: ethers.Wallet;
let snapshot: number;
let relayAdaptContract: RelayAdaptContract;
let railgunSmartWalletContract: RailgunSmartWalletContract;
let nft: TestERC721;
let wallet: RailgunWallet;
let wallet2: RailgunWallet;

const testMnemonic = config.mnemonic;
const testEncryptionKey = config.encryptionKey;

const WETH_TOKEN_ADDRESS = config.contracts.weth9;
const SHIELD_RANDOM = randomHex(16);

const wethTokenData = getTokenDataERC20(WETH_TOKEN_ADDRESS);

const DEAD_ADDRESS = '0x000000000000000000000000000000000000dEaD';
const DEPLOYMENT_BLOCK = process.env.DEPLOYMENT_BLOCK ? Number(process.env.DEPLOYMENT_BLOCK) : 0;

let testShieldBaseToken: (value?: bigint) => Promise<[TransactionReceipt, unknown]>;

describe('Relay Adapt', function test() {
  this.timeout(60000);

  beforeEach(async () => {
    engine = new RailgunEngine(
      'TestRelayAdapt',
      memdown(),
      testArtifactsGetter,
      undefined, // quickSync
      undefined, // engineDebugger
      undefined, // skipMerkletreeScans
    );

    engine.prover.setSnarkJSGroth16(groth16 as Groth16);

    wallet = await engine.createWalletFromMnemonic(testEncryptionKey, testMnemonic, 0);
    wallet2 = await engine.createWalletFromMnemonic(testEncryptionKey, testMnemonic, 1);

    if (!process.env.RUN_HARDHAT_TESTS) {
      return;
    }

    provider = new JsonRpcProvider(config.rpc);
    chain = {
      type: ChainType.EVM,
      id: (await provider.getNetwork()).chainId,
    };
    await engine.loadNetwork(
      chain,
      config.contracts.proxy,
      config.contracts.relayAdapt,
      provider,
      DEPLOYMENT_BLOCK,
    );
    await engine.scanHistory(chain);
    railgunSmartWalletContract = engine.railgunSmartWalletContracts[chain.type][chain.id];
    relayAdaptContract = engine.relayAdaptContracts[chain.type][chain.id];

    const { privateKey } = ethers.utils.HDNode.fromMnemonic(testMnemonic).derivePath(
      ethers.utils.defaultPath,
    );
    ethersWallet = new ethers.Wallet(privateKey, provider);
    snapshot = (await provider.send('evm_snapshot', [])) as number;

    nft = new ethers.Contract(config.contracts.testERC721, erc721Abi, ethersWallet) as TestERC721;

    testShieldBaseToken = async (
      value: bigint = 10000n,
    ): Promise<[TransactionReceipt, unknown]> => {
      // Create shield
      const shield = new ShieldNoteERC20(
        wallet.masterPublicKey,
        SHIELD_RANDOM,
        value,
        WETH_TOKEN_ADDRESS,
      );
      const shieldPrivateKey = hexToBytes(randomHex(32));
      const shieldRequest = await shield.serialize(
        shieldPrivateKey,
        wallet.getViewingKeyPair().pubkey,
      );

      const shieldTx = await relayAdaptContract.populateShieldBaseToken(shieldRequest);

      // Send shield on chain
      const awaiterShield = awaitScan(wallet, chain);
      const tx = await ethersWallet.sendTransaction(shieldTx);
      return Promise.all([tx.wait(), awaiterShield]);
    };
  });

  it('[HH] Should wrap and shield base token', async function run() {
    if (!process.env.RUN_HARDHAT_TESTS) {
      this.skip();
      return;
    }

    const { masterPublicKey } = wallet;

    // Create shield
    const shield = new ShieldNoteERC20(masterPublicKey, SHIELD_RANDOM, 10000n, WETH_TOKEN_ADDRESS);
    const shieldPrivateKey = hexToBytes(randomHex(32));
    const shieldRequest = await shield.serialize(
      shieldPrivateKey,
      wallet.getViewingKeyPair().pubkey,
    );

    const shieldTx = await relayAdaptContract.populateShieldBaseToken(shieldRequest);

    const awaiterShield = awaitScan(wallet, chain);

    // Send shield on chain
    const txResponse = await ethersWallet.sendTransaction(shieldTx);

    const receiveShieldEvent = new Promise((resolve) =>
      railgunSmartWalletContract.contract.once(
        railgunSmartWalletContract.contract.filters.Shield(),
        resolve,
      ),
    );

    await Promise.all([txResponse.wait(), receiveShieldEvent]);
    await expect(awaiterShield).to.be.fulfilled;

    expect(await wallet.getBalance(chain, WETH_TOKEN_ADDRESS)).to.equal(9975n);
  });

  it('[HH] Should return gas estimate for unshield base token', async function run() {
    if (!process.env.RUN_HARDHAT_TESTS) {
      this.skip();
      return;
    }

    await testShieldBaseToken(100000000n);
    expect(await wallet.getBalance(chain, WETH_TOKEN_ADDRESS)).to.equal(99750000n);

    const transactionBatch = new TransactionBatch(chain);

    const relayerFee = TransactNote.createTransfer(
      wallet2.addressKeys,
      wallet.addressKeys,
      randomHex(16),
      1000n,
      wethTokenData,
      wallet.getViewingKeyPair(),
      false, // showSenderAddressToRecipient
      OutputType.RelayerFee,
      undefined, // memoText
    );
    transactionBatch.addOutput(relayerFee); // Simulate Relayer fee output.

    const unshieldValue = 99000000n;

    const unshieldNote = new UnshieldNoteERC20(
      relayAdaptContract.address,
      unshieldValue,
      WETH_TOKEN_ADDRESS,
    );
    transactionBatch.addUnshieldData(unshieldNote.unshieldData);

    const dummyTransactions = await transactionBatch.generateDummyTransactions(
      engine.prover,
      wallet,
      testEncryptionKey,
    );

    const random = '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcd';

    const relayTransactionGasEstimate = await relayAdaptContract.populateUnshieldBaseToken(
      dummyTransactions,
      ethersWallet.address,
      random,
    );

    relayTransactionGasEstimate.from = DEAD_ADDRESS;

    const gasEstimate = await provider.estimateGas(relayTransactionGasEstimate);
    expect(gasEstimate.toNumber()).to.be.greaterThan(0);
  });

  it('[HH] Should execute relay adapt transaction for unshield base token', async function run() {
    if (!process.env.RUN_HARDHAT_TESTS) {
      this.skip();
      return;
    }

    await testShieldBaseToken();
    expect(await wallet.getBalance(chain, WETH_TOKEN_ADDRESS)).to.equal(9975n);

    // 1. Generate transaction batch to unshield necessary amount, and pay Relayer.
    const transactionBatch = new TransactionBatch(chain);
    const relayerFee = TransactNote.createTransfer(
      wallet2.addressKeys,
      wallet.addressKeys,
      randomHex(16),
      100n,
      wethTokenData,
      wallet.getViewingKeyPair(),
      false, // showSenderAddressToRecipient
      OutputType.RelayerFee,
      undefined, // memoText
    );
    transactionBatch.addOutput(relayerFee); // Simulate Relayer fee output.

    const unshieldValue = 300n;

    const unshieldNote = new UnshieldNoteERC20(
      relayAdaptContract.address,
      unshieldValue,
      WETH_TOKEN_ADDRESS,
    );
    transactionBatch.addUnshieldData(unshieldNote.unshieldData);

    // 2. Create dummy transactions from batch.
    const dummyTransactions = await transactionBatch.generateDummyTransactions(
      engine.prover,
      wallet,
      testEncryptionKey,
    );

    // 3. Generate relay adapt params from dummy transactions.
    const random = '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcd';
    const relayAdaptParams = await relayAdaptContract.getRelayAdaptParamsUnshieldBaseToken(
      dummyTransactions,
      ethersWallet.address,
      random,
    );
    expect(relayAdaptParams).to.equal(
      '0xa54346cdc981dd16bf95990bd28264a2e498e8db8be602b9611b999df51f3cf1',
    );

    // 4. Create real transactions with relay adapt params.
    transactionBatch.setAdaptID({
      contract: relayAdaptContract.address,
      parameters: relayAdaptParams,
    });
    const transactions = await transactionBatch.generateTransactions(
      engine.prover,
      wallet,
      testEncryptionKey,
      () => {},
    );
    transactions.forEach((transaction) => {
      expect(transaction.boundParams.adaptContract).to.equal(relayAdaptContract.address);
      expect(transaction.boundParams.adaptParams).to.equal(relayAdaptParams);
    });

    // const preEthBalance = await ethersWallet.getBalance();

    // 5: Generate final relay transaction for unshield base token.
    const relayTransaction = await relayAdaptContract.populateUnshieldBaseToken(
      transactions,
      ethersWallet.address,
      random,
    );

    // 6: Send relay transaction.
    const txResponse = await ethersWallet.sendTransaction(relayTransaction);

    const receiveTransactEvent = new Promise((resolve) =>
      railgunSmartWalletContract.contract.once(
        railgunSmartWalletContract.contract.filters.Transact(),
        resolve,
      ),
    );
    const receiveUnshieldEvent = new Promise((resolve) =>
      railgunSmartWalletContract.contract.once(
        railgunSmartWalletContract.contract.filters.Unshield(),
        resolve,
      ),
    );

    const awaiterScan = awaitMultipleScans(wallet, chain, 2);

    const [txReceipt] = await Promise.all([
      txResponse.wait(),
      receiveTransactEvent,
      receiveUnshieldEvent,
    ]);
    await expect(awaiterScan).to.be.fulfilled; // Unshield

    expect(await wallet.getBalance(chain, WETH_TOKEN_ADDRESS)).to.equal(
      BigInt(9975 /* original */ - 100 /* relayer fee */ - 300 /* unshield amount */),
    );

    const callResultError = RelayAdaptContract.getRelayAdaptCallError(txReceipt.logs);
    expect(callResultError).to.equal(undefined);

    // TODO: Fix this assertion. How much gas is used?
    // const postEthBalance = await ethersWallet.getBalance();
    // expect(preEthBalance.toBigInt() - txReceipt.gasUsed.toBigInt() + 300n).to.equal(
    //   postEthBalance.toBigInt(),
    // );
  });

  it('[HH] Should execute relay adapt transaction for NFT transaction', async function run() {
    if (!process.env.RUN_HARDHAT_TESTS) {
      this.skip();
      return;
    }

    // Shield WETH for Relayer fee.
    await testShieldBaseToken();
    expect(await wallet.getBalance(chain, WETH_TOKEN_ADDRESS)).to.equal(9975n);

    // Mint NFTs with tokenIDs 0 and 1 into public balance.
    await mintNFTsID01ForTest(nft, ethersWallet);

    // Approve shield
    const approval = await nft.approve(railgunSmartWalletContract.address, 1);
    await approval.wait();

    // Create shield
    const shield = await shieldNFTForTest(
      wallet,
      ethersWallet,
      railgunSmartWalletContract,
      chain,
      randomHex(16),
      nft.address,
      '1',
    );

    const nftBalanceAfterShield = await nft.balanceOf(railgunSmartWalletContract.address);
    expect(nftBalanceAfterShield.toHexString()).to.equal('0x01');

    const nftTokenData = shield.tokenData as NFTTokenData;

    // 1. Generate transaction batch to unshield necessary amount, and pay Relayer.
    const transactionBatch = new TransactionBatch(chain);
    const relayerFee = TransactNote.createTransfer(
      wallet2.addressKeys,
      wallet.addressKeys,
      randomHex(16),
      300n,
      wethTokenData,
      wallet.getViewingKeyPair(),
      false, // showSenderAddressToRecipient
      OutputType.RelayerFee,
      undefined, // memoText
    );
    transactionBatch.addOutput(relayerFee); // Simulate Relayer fee output.

    const unshieldNote = new UnshieldNoteNFT(
      relayAdaptContract.address,
      shield.tokenData as NFTTokenData,
    );
    transactionBatch.addUnshieldData(unshieldNote.unshieldData);

    // 2. Create dummy transactions from batch.
    const dummyTransactions = await transactionBatch.generateDummyTransactions(
      engine.prover,
      wallet,
      testEncryptionKey,
    );

    // 3. Create the cross contract calls.
    // Do nothing for now.
    // TODO: Add an NFT interaction via cross contract call.
    const crossContractCalls: PopulatedTransaction[] = [];

    // 4. Create shield inputs.
    const shieldRandom = '0x10203040506070809000102030405060';
    const relayShieldInputs = await RelayAdaptHelper.generateRelayShieldRequests(
      wallet,
      shieldRandom,
      [],
      [nftTokenData], // shieldNFTsTokenData
    );

    // 5. Generate relay adapt params from dummy transactions.
    const random = '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcd';
    const relayAdaptParams = await relayAdaptContract.getRelayAdaptParamsCrossContractCalls(
      dummyTransactions,
      crossContractCalls,
      relayShieldInputs,
      random,
    );

    // 6. Get gas estimate from dummy txs.
    const populatedTransactionGasEstimate = await relayAdaptContract.populateCrossContractCalls(
      dummyTransactions,
      crossContractCalls,
      relayShieldInputs,
      random,
    );
    populatedTransactionGasEstimate.from = DEAD_ADDRESS;
    const gasEstimate = await provider.estimateGas(populatedTransactionGasEstimate);
    expect(gasEstimate.toNumber()).to.be.greaterThan(
      MINIMUM_RELAY_ADAPT_CROSS_CONTRACT_CALLS_MINIMUM_GAS_FOR_CONTRACT.toNumber(),
    );
    expect(gasEstimate.toNumber()).to.be.lessThan(
      MINIMUM_RELAY_ADAPT_CROSS_CONTRACT_CALLS_GAS_LIMIT.toNumber(),
    );

    // 7. Create real transactions with relay adapt params.
    transactionBatch.setAdaptID({
      contract: relayAdaptContract.address,
      parameters: relayAdaptParams,
    });
    const transactions = await transactionBatch.generateTransactions(
      engine.prover,
      wallet,
      testEncryptionKey,
      () => {},
    );
    transactions.forEach((transaction) => {
      expect(transaction.boundParams.adaptContract).to.equal(relayAdaptContract.address);
      expect(transaction.boundParams.adaptParams).to.equal(relayAdaptParams);
    });

    // 8. Generate real relay transaction for cross contract call.
    const relayTransaction = await relayAdaptContract.populateCrossContractCalls(
      transactions,
      crossContractCalls,
      relayShieldInputs,
      random,
    );
    const gasEstimateFinal = await provider.estimateGas(relayTransaction);
    expect(gasEstimate.sub(gasEstimateFinal).abs().toNumber()).to.be.below(
      12000,
      'Gas difference from estimate (dummy) to final transaction should be less than 12000',
    );

    // 9: Send relay transaction.
    const txResponse = await ethersWallet.sendTransaction(relayTransaction);

    const receiveTransactEvent = new Promise((resolve) =>
      railgunSmartWalletContract.contract.once(
        railgunSmartWalletContract.contract.filters.Transact(),
        resolve,
      ),
    );
    const receiveUnshieldEvent = new Promise((resolve) =>
      railgunSmartWalletContract.contract.once(
        railgunSmartWalletContract.contract.filters.Unshield(),
        resolve,
      ),
    );

    const awaiterScan = awaitScan(wallet, chain);

    const [txReceipt] = await Promise.all([
      txResponse.wait(),
      receiveTransactEvent,
      receiveUnshieldEvent,
    ]);
    await expect(awaiterScan).to.be.fulfilled; // Unshield

    const callResultError = RelayAdaptContract.getRelayAdaptCallError(txReceipt.logs);
    expect(callResultError).to.equal(undefined);

    const nftBalanceAfterReshield = await nft.balanceOf(railgunSmartWalletContract.address);
    expect(nftBalanceAfterReshield.toHexString()).to.equal('0x01');
  });

  it('[HH] Should shield all leftover WETH in relay adapt contract', async function run() {
    if (!process.env.RUN_HARDHAT_TESTS) {
      this.skip();
      return;
    }

    await testShieldBaseToken();
    expect(await wallet.getBalance(chain, WETH_TOKEN_ADDRESS)).to.equal(9975n);

    // 1. Generate transaction batch to unshield necessary amount, and pay Relayer.
    const transactionBatch = new TransactionBatch(chain);
    const unshieldNote = new UnshieldNoteERC20(
      relayAdaptContract.address,
      1000n,
      WETH_TOKEN_ADDRESS,
    );
    transactionBatch.addUnshieldData(unshieldNote.unshieldData);

    const serializedTxs = await transactionBatch.generateTransactions(
      engine.prover,
      wallet,
      testEncryptionKey,
      () => {},
    );
    const transact = await railgunSmartWalletContract.transact(serializedTxs);

    // Unshield to relay adapt.
    const txTransact = await ethersWallet.sendTransaction(transact);
    await Promise.all([txTransact.wait(), awaitScan(wallet, chain)]);

    const wethTokenContract = new ethers.Contract(
      WETH_TOKEN_ADDRESS,
      erc20Abi,
      ethersWallet,
    ) as ERC20;

    let relayAdaptAddressBalance: BigNumber = await wethTokenContract.balanceOf(
      relayAdaptContract.address,
    );
    expect(relayAdaptAddressBalance.toBigInt()).to.equal(998n);

    // Value 0n doesn't matter - all WETH should be shielded anyway.
    await testShieldBaseToken(0n);

    relayAdaptAddressBalance = await wethTokenContract.balanceOf(relayAdaptContract.address);
    expect(relayAdaptAddressBalance.toBigInt()).to.equal(0n);
  });

  it('[HH] Should execute relay adapt transaction for cross contract call', async function run() {
    if (!process.env.RUN_HARDHAT_TESTS) {
      this.skip();
      return;
    }

    await testShieldBaseToken();
    expect(await wallet.getBalance(chain, WETH_TOKEN_ADDRESS)).to.equal(9975n);

    // 1. Generate transaction batch to unshield necessary amount, and pay Relayer.
    const transactionBatch = new TransactionBatch(chain);
    const relayerFee = TransactNote.createTransfer(
      wallet2.addressKeys,
      wallet.addressKeys,
      randomHex(16),
      300n,
      wethTokenData,
      wallet.getViewingKeyPair(),
      false, // showSenderAddressToRecipient
      OutputType.RelayerFee,
      undefined, // memoText
    );
    transactionBatch.addOutput(relayerFee); // Simulate Relayer fee output.
    const unshieldNote = new UnshieldNoteERC20(
      relayAdaptContract.address,
      1000n,
      WETH_TOKEN_ADDRESS,
    );
    transactionBatch.addUnshieldData(unshieldNote.unshieldData);

    // 2. Create dummy transactions from batch.
    const dummyTransactions = await transactionBatch.generateDummyTransactions(
      engine.prover,
      wallet,
      testEncryptionKey,
    );

    // 3. Create the cross contract call.
    // Cross contract call: send 990n WETH tokens to Dead address.
    const wethTokenContract = new ethers.Contract(
      WETH_TOKEN_ADDRESS,
      erc20Abi,
      ethersWallet,
    ) as ERC20;
    const sendToAddress = DEAD_ADDRESS;
    const sendAmount = 990n;
    const crossContractCalls: PopulatedTransaction[] = [
      await wethTokenContract.populateTransaction.transfer(sendToAddress, sendAmount),
    ];

    // 4. Create shield inputs.
    const shieldRandom = '0x10203040506070809000102030405060';
    const shieldERC20Addresses: string[] = [WETH_TOKEN_ADDRESS];
    const relayShieldInputs = await RelayAdaptHelper.generateRelayShieldRequests(
      wallet,
      shieldRandom,
      shieldERC20Addresses,
      [], // shieldNFTsTokenData
    );

    // 5. Generate relay adapt params from dummy transactions.
    const random = randomHex(31);
    const relayAdaptParams = await relayAdaptContract.getRelayAdaptParamsCrossContractCalls(
      dummyTransactions,
      crossContractCalls,
      relayShieldInputs,
      random,
    );

    // 6. Get gas estimate from dummy txs.
    const populatedTransactionGasEstimate = await relayAdaptContract.populateCrossContractCalls(
      dummyTransactions,
      crossContractCalls,
      relayShieldInputs,
      random,
    );
    populatedTransactionGasEstimate.from = DEAD_ADDRESS;
    const gasEstimate = await provider.estimateGas(populatedTransactionGasEstimate);
    expect(gasEstimate.toNumber()).to.be.greaterThan(
      MINIMUM_RELAY_ADAPT_CROSS_CONTRACT_CALLS_MINIMUM_GAS_FOR_CONTRACT.toNumber(),
    );
    expect(gasEstimate.toNumber()).to.be.lessThan(
      MINIMUM_RELAY_ADAPT_CROSS_CONTRACT_CALLS_GAS_LIMIT.toNumber(),
    );

    // 7. Create real transactions with relay adapt params.
    transactionBatch.setAdaptID({
      contract: relayAdaptContract.address,
      parameters: relayAdaptParams,
    });
    const transactions = await transactionBatch.generateTransactions(
      engine.prover,
      wallet,
      testEncryptionKey,
      () => {},
    );
    transactions.forEach((transaction) => {
      expect(transaction.boundParams.adaptContract).to.equal(relayAdaptContract.address);
      expect(transaction.boundParams.adaptParams).to.equal(relayAdaptParams);
    });

    // 8. Generate real relay transaction for cross contract call.
    const relayTransaction = await relayAdaptContract.populateCrossContractCalls(
      transactions,
      crossContractCalls,
      relayShieldInputs,
      random,
    );
    const gasEstimateFinal = await provider.estimateGas(relayTransaction);

    expect(gasEstimate.sub(gasEstimateFinal).abs().toNumber()).to.be.below(
      10000,
      'Gas difference from estimate (dummy) to final transaction should be less than 10000',
    );

    // Add 20% to gasEstimate for gasLimit.
    relayTransaction.gasLimit = gasEstimate.mul(120).div(100);

    // 9. Send transaction.
    const txResponse = await ethersWallet.sendTransaction(relayTransaction);

    const receiveTransactEvent = new Promise((resolve) =>
      railgunSmartWalletContract.contract.once(
        railgunSmartWalletContract.contract.filters.Transact(),
        resolve,
      ),
    );

    // Perform scans: Unshield and Shield
    const scansAwaiter = awaitMultipleScans(wallet, chain, 2);

    const [txReceipt] = await Promise.all([txResponse.wait(), receiveTransactEvent]);
    await expect(scansAwaiter).to.be.fulfilled;

    // Dead address should have 990n WETH.
    const sendAddressBalance: BigNumber = await wethTokenContract.balanceOf(sendToAddress);
    expect(sendAddressBalance.toBigInt()).to.equal(sendAmount);

    const relayAdaptAddressBalance: BigNumber = await wethTokenContract.balanceOf(
      relayAdaptContract.address,
    );
    expect(relayAdaptAddressBalance.toBigInt()).to.equal(0n);

    const callResultError = RelayAdaptContract.getRelayAdaptCallError(txReceipt.logs);
    expect(callResultError).to.equal(undefined);

    const expectedPrivateWethBalance = BigInt(
      9975 /* original shield */ -
        300 /* relayer fee */ -
        1000 /* unshield */ +
        8 /* re-shield (1000 unshield amount - 2 unshield fee - 990 send amount - 0 re-shield fee) */,
    );
    const expectedTotalPrivateWethBalance = expectedPrivateWethBalance + 300n; // Add relayer fee.

    const proxyWethBalance = (
      await wethTokenContract.balanceOf(railgunSmartWalletContract.address)
    ).toBigInt();
    expect(proxyWethBalance).to.equal(expectedTotalPrivateWethBalance);

    const privateWalletBalance = await wallet.getBalance(chain, WETH_TOKEN_ADDRESS);
    expect(privateWalletBalance).to.equal(expectedPrivateWethBalance);
  });

  it('[HH] Should revert send, but keep fees for failing cross contract call', async function run() {
    if (!process.env.RUN_HARDHAT_TESTS) {
      this.skip();
      return;
    }

    await testShieldBaseToken(100000n);
    expect(await wallet.getBalance(chain, WETH_TOKEN_ADDRESS)).to.equal(99750n);

    // 1. Generate transaction batch to unshield necessary amount, and pay Relayer.
    const transactionBatch = new TransactionBatch(chain);
    const relayerFee = TransactNote.createTransfer(
      wallet2.addressKeys,
      wallet.addressKeys,
      randomHex(16),
      300n,
      wethTokenData,
      wallet.getViewingKeyPair(),
      false, // showSenderAddressToRecipient
      OutputType.RelayerFee,
      undefined, // memoText
    );
    transactionBatch.addOutput(relayerFee); // Simulate Relayer fee output.
    const unshieldNote = new UnshieldNoteERC20(
      relayAdaptContract.address,
      10000n,
      WETH_TOKEN_ADDRESS,
    );
    transactionBatch.addUnshieldData(unshieldNote.unshieldData);

    // 2. Create dummy transactions from batch.
    const dummyTransactions = await transactionBatch.generateDummyTransactions(
      engine.prover,
      wallet,
      testEncryptionKey,
    );

    // 3. Create the cross contract call.
    // Cross contract call: send 1 WETH token to Dead address.
    const wethTokenContract = new ethers.Contract(
      WETH_TOKEN_ADDRESS,
      erc20Abi,
      ethersWallet,
    ) as ERC20;
    const sendToAddress = DEAD_ADDRESS;
    const sendAmount = 20000n; // More than is available (after 0.25% unshield fee).
    const crossContractCalls: PopulatedTransaction[] = [
      await wethTokenContract.populateTransaction.transfer(sendToAddress, sendAmount),
    ];

    // 4. Create shield inputs.
    const shieldRandom = '10203040506070809000102030405060';
    const shieldERC20Addresses: string[] = [WETH_TOKEN_ADDRESS];
    const relayShieldInputs = await RelayAdaptHelper.generateRelayShieldRequests(
      wallet,
      shieldRandom,
      shieldERC20Addresses,
      [], // shieldNFTsTokenData
    );

    // 5. Generate relay adapt params from dummy transactions.
    const random = randomHex(31);
    const relayAdaptParams = await relayAdaptContract.getRelayAdaptParamsCrossContractCalls(
      dummyTransactions,
      crossContractCalls,
      relayShieldInputs,
      random,
    );

    // 6. Get gas estimate from dummy txs.
    const populatedTransactionGasEstimate = await relayAdaptContract.populateCrossContractCalls(
      dummyTransactions,
      crossContractCalls,
      relayShieldInputs,
      random,
    );
    populatedTransactionGasEstimate.from = DEAD_ADDRESS;
    const gasEstimate = await provider.estimateGas(populatedTransactionGasEstimate);
    expect(gasEstimate.toNumber()).to.be.greaterThan(
      MINIMUM_RELAY_ADAPT_CROSS_CONTRACT_CALLS_MINIMUM_GAS_FOR_CONTRACT.toNumber(),
    );
    expect(gasEstimate.toNumber()).to.be.lessThan(
      MINIMUM_RELAY_ADAPT_CROSS_CONTRACT_CALLS_GAS_LIMIT.toNumber(),
    );

    // 7. Create real transactions with relay adapt params.
    transactionBatch.setAdaptID({
      contract: relayAdaptContract.address,
      parameters: relayAdaptParams,
    });
    const transactions = await transactionBatch.generateTransactions(
      engine.prover,
      wallet,
      testEncryptionKey,
      () => {},
    );
    transactions.forEach((transaction) => {
      expect(transaction.boundParams.adaptContract).to.equal(relayAdaptContract.address);
      expect(transaction.boundParams.adaptParams).to.equal(relayAdaptParams);
    });

    // 8. Generate real relay transaction for cross contract call.
    const relayTransaction = await relayAdaptContract.populateCrossContractCalls(
      transactions,
      crossContractCalls,
      relayShieldInputs,
      random,
    );

    // Add 20% to gasEstimate for gasLimit.
    relayTransaction.gasLimit = gasEstimate.mul(120).div(100);

    // 9. Send transaction.
    const txResponse = await ethersWallet.sendTransaction(relayTransaction);

    const receiveTransactEvent = new Promise((resolve) =>
      railgunSmartWalletContract.contract.once(
        railgunSmartWalletContract.contract.filters.Transact(),
        resolve,
      ),
    );
    const receiveUnshieldEvent = new Promise((resolve) =>
      railgunSmartWalletContract.contract.once(
        railgunSmartWalletContract.contract.filters.Unshield(),
        resolve,
      ),
    );

    // Perform scans: Unshield and Shield
    const scansAwaiter = awaitMultipleScans(wallet, chain, 2);

    const [txReceipt] = await Promise.all([
      txResponse.wait(),
      receiveTransactEvent,
      receiveUnshieldEvent,
    ]);
    await expect(scansAwaiter).to.be.fulfilled;

    // Dead address should have 0 WETH.
    const sendAddressBalance: BigNumber = await wethTokenContract.balanceOf(sendToAddress);
    expect(sendAddressBalance.toBigInt()).to.equal(0n);

    const relayAdaptAddressBalance: BigNumber = await wethTokenContract.balanceOf(
      relayAdaptContract.address,
    );
    expect(relayAdaptAddressBalance.toBigInt()).to.equal(0n);

    const callResultError = RelayAdaptContract.getRelayAdaptCallError(txReceipt.logs);
    expect(callResultError).to.equal('Unknown Relay Adapt error.');

    const expectedPrivateWethBalance = BigInt(
      99750 /* original */ -
        300 /* relayer fee */ -
        10000 /* unshield amount */ -
        0 /* failed cross contract send: no change */ +
        9975 /* re-shield amount */ -
        24 /* shield fee */,
    );
    const expectedTotalPrivateWethBalance = expectedPrivateWethBalance + 300n; // Add relayer fee.

    const proxyWethBalance = (
      await wethTokenContract.balanceOf(railgunSmartWalletContract.address)
    ).toBigInt();
    const privateWalletBalance = await wallet.getBalance(chain, WETH_TOKEN_ADDRESS);

    expect(proxyWethBalance).to.equal(expectedTotalPrivateWethBalance);
    expect(privateWalletBalance).to.equal(expectedPrivateWethBalance);
  });

  it('[HH] Should revert send for failing re-shield', async function run() {
    if (!process.env.RUN_HARDHAT_TESTS) {
      this.skip();
      return;
    }

    await testShieldBaseToken(100000n);
    expect(await wallet.getBalance(chain, WETH_TOKEN_ADDRESS)).to.equal(99750n);

    // 1. Generate transaction batch to unshield necessary amount, and pay Relayer.
    const transactionBatch = new TransactionBatch(chain);
    const relayerFee = TransactNote.createTransfer(
      wallet2.addressKeys,
      wallet.addressKeys,
      randomHex(16),
      300n,
      wethTokenData,
      wallet.getViewingKeyPair(),
      false, // showSenderAddressToRecipient
      OutputType.RelayerFee,
      undefined, // memoText
    );
    transactionBatch.addOutput(relayerFee); // Simulate Relayer fee output.
    const unshieldNote = new UnshieldNoteERC20(
      relayAdaptContract.address,
      10000n,
      WETH_TOKEN_ADDRESS,
    );
    transactionBatch.addUnshieldData(unshieldNote.unshieldData);

    // 2. Create dummy transactions from batch.
    const dummyTransactions = await transactionBatch.generateDummyTransactions(
      engine.prover,
      wallet,
      testEncryptionKey,
    );

    // 3. Create the cross contract call.
    // Cross contract call: send 1 WETH token to Dead address.
    const wethTokenContract = new ethers.Contract(
      WETH_TOKEN_ADDRESS,
      erc20Abi,
      ethersWallet,
    ) as ERC20;
    const sendToAddress = DEAD_ADDRESS;
    const sendAmount = 20000n; // More than is available (after 0.25% unshield fee).
    const crossContractCalls: PopulatedTransaction[] = [
      await wethTokenContract.populateTransaction.transfer(sendToAddress, sendAmount),
    ];

    // 4. Create shield inputs.
    const shieldRandom = '10203040506070809000102030405060';
    const shieldERC20Addresses: string[] = [WETH_TOKEN_ADDRESS];
    const relayShieldInputs = await RelayAdaptHelper.generateRelayShieldRequests(
      wallet,
      shieldRandom,
      shieldERC20Addresses,
      [], // shieldNFTsTokenData
    );

    // 5. Generate relay adapt params from dummy transactions.
    const random = randomHex(31);
    const relayAdaptParams = await relayAdaptContract.getRelayAdaptParamsCrossContractCalls(
      dummyTransactions,
      crossContractCalls,
      relayShieldInputs,
      random,
    );

    // 6. Get gas estimate from dummy txs.
    const populatedTransactionGasEstimate = await relayAdaptContract.populateCrossContractCalls(
      dummyTransactions,
      crossContractCalls,
      relayShieldInputs,
      random,
    );
    populatedTransactionGasEstimate.from = DEAD_ADDRESS;
    const gasEstimate = await provider.estimateGas(populatedTransactionGasEstimate);
    expect(gasEstimate.toNumber()).to.be.greaterThan(
      MINIMUM_RELAY_ADAPT_CROSS_CONTRACT_CALLS_MINIMUM_GAS_FOR_CONTRACT.toNumber(),
    );
    expect(gasEstimate.toNumber()).to.be.lessThan(
      MINIMUM_RELAY_ADAPT_CROSS_CONTRACT_CALLS_GAS_LIMIT.toNumber(),
    );

    // 7. Create real transactions with relay adapt params.
    transactionBatch.setAdaptID({
      contract: relayAdaptContract.address,
      parameters: relayAdaptParams,
    });
    const transactions = await transactionBatch.generateTransactions(
      engine.prover,
      wallet,
      testEncryptionKey,
      () => {},
    );
    transactions.forEach((transaction) => {
      expect(transaction.boundParams.adaptContract).to.equal(relayAdaptContract.address);
      expect(transaction.boundParams.adaptParams).to.equal(relayAdaptParams);
    });

    // 8. Generate real relay transaction for cross contract call.
    const relayTransaction = await relayAdaptContract.populateCrossContractCalls(
      transactions,
      crossContractCalls,
      relayShieldInputs,
      random,
    );

    const gasEstimateFinal = await provider.estimateGas(relayTransaction);

    // Gas estimate is currently an underestimate (which is a bug).
    // Set gas limit to this value, which should revert inside the smart contract.
    relayTransaction.gasLimit = gasEstimateFinal.mul(101).div(100);

    // 9. Send transaction.
    const txResponse = await ethersWallet.sendTransaction(relayTransaction);

    const receiveTransactEvent = new Promise((resolve) =>
      railgunSmartWalletContract.contract.once(
        railgunSmartWalletContract.contract.filters.Transact(),
        resolve,
      ),
    );

    // Perform scans: Unshield and Shield
    const scansAwaiter = awaitMultipleScans(wallet, chain, 2);

    const [txReceipt] = await Promise.all([txResponse.wait(), receiveTransactEvent]);
    await expect(scansAwaiter).to.be.fulfilled;

    // Dead address should have 0 WETH.
    const sendAddressBalance: BigNumber = await wethTokenContract.balanceOf(sendToAddress);
    expect(sendAddressBalance.toBigInt()).to.equal(0n);

    const relayAdaptAddressBalance: BigNumber = await wethTokenContract.balanceOf(
      relayAdaptContract.address,
    );
    expect(relayAdaptAddressBalance.toBigInt()).to.equal(0n);

    const callResultError = RelayAdaptContract.getRelayAdaptCallError(txReceipt.logs);
    expect(callResultError).to.equal('Unknown Relay Adapt error.');

    // TODO: These are the incorrect assertions, if the tx is fully reverted. This requires a callbacks upgrade to contract.
    // For now, it is partially reverted. Unshield/shield fees are still charged.
    // This caps the loss of funds at 0.5% + Relayer fee.

    const expectedProxyBalance = BigInt(
      99750 /* original */ - 25 /* unshield fee */ - 24 /* re-shield fee */,
    );
    const expectedWalletBalance = BigInt(expectedProxyBalance - 300n /* relayer fee */);

    const treasuryBalance: BigNumber = await wethTokenContract.balanceOf(
      config.contracts.treasuryProxy,
    );
    expect(treasuryBalance.toBigInt()).to.equal(299n);

    const proxyWethBalance = (
      await wethTokenContract.balanceOf(railgunSmartWalletContract.address)
    ).toBigInt();
    const privateWalletBalance = await wallet.getBalance(chain, WETH_TOKEN_ADDRESS);

    expect(proxyWethBalance).to.equal(expectedProxyBalance);
    expect(privateWalletBalance).to.equal(expectedWalletBalance);

    //
    // These are the correct assertions....
    //

    // const expectedPrivateWethBalance = BigInt(99750 /* original */);

    // const treasuryBalance: BigNumber = await wethTokenContract.balanceOf(config.contracts.treasuryProxy);
    // expect(treasuryBalance.toBigInt()).to.equal(250n);

    // const proxyWethBalance = (await wethTokenContract.balanceOf(railgunSmartWalletContract.address)).toBigInt();
    // const privateWalletBalance = await wallet.getBalance(chain, WETH_TOKEN_ADDRESS);

    // expect(proxyWethBalance).to.equal(expectedPrivateWethBalance);
    // expect(privateWalletBalance).to.equal(expectedPrivateWethBalance);
  });

  it('Should generate relay shield notes and inputs', async () => {
    const shieldERC20Addresses: string[] = [
      config.contracts.weth9.toLowerCase(),
      config.contracts.rail.toLowerCase(),
    ];

    const random = '10203040506070809000102030405060';
    const relayShieldInputs = await RelayAdaptHelper.generateRelayShieldRequests(
      wallet,
      random,
      shieldERC20Addresses,
      [], // shieldNFTsTokenData
    );

    expect(relayShieldInputs.length).to.equal(2);
    expect(
      relayShieldInputs.map((shieldInput) => shieldInput.preimage.token.tokenAddress),
    ).to.deep.equal(shieldERC20Addresses);
    relayShieldInputs.forEach((relayShieldInput) => {
      expect(relayShieldInput.preimage.npk).to.equal(
        nToHex(
          3348140451435708797167073859596593490034226162440317170509481065740328487080n,
          ByteLength.UINT_256,
          true,
        ),
      );
      expect(relayShieldInput.preimage.token.tokenType).to.equal(0);
    });
  });

  it.skip('Should parse relay adapt error messages - legacy', async () => {
    const polygonProvider = new JsonRpcProvider('https://polygon-rpc.com');
    const txReceipt: TransactionReceipt = await polygonProvider.getTransactionReceipt(
      '0x56c3b9bfb573e6f49f21b8e09282edd01a93bbb965b1f4debbf7316ea3d878dd',
    );
    expect(RelayAdaptContract.getRelayAdaptCallError(txReceipt.logs)).to.equal(
      'Unknown Relay Adapt error.',
    );

    const txReceipt2: TransactionReceipt = await polygonProvider.getTransactionReceipt(
      '0xeeaf0c55b4c34516402ce1c0d1eb4e3d2664b11204f2fc9988ec57ae7a1220ff',
    );
    expect(RelayAdaptContract.getRelayAdaptCallError(txReceipt2.logs)).to.equal(
      'ERC20: transfer amount exceeds allowance',
    );
  });

  it('Should calculate relay adapt params', () => {
    const nullifiers = [
      new Uint8Array([
        42, 178, 205, 78, 49, 222, 35, 76, 140, 83, 19, 50, 218, 74, 38, 161, 4, 32, 213, 247, 186,
        238, 81, 137, 50, 61, 32, 21, 178, 16, 168, 32,
      ]),
      new Uint8Array([
        5, 228, 162, 212, 44, 195, 165, 245, 46, 252, 85, 67, 78, 165, 80, 86, 216, 220, 217, 118,
        198, 92, 41, 84, 51, 159, 175, 75, 194, 103, 163, 115,
      ]),
    ].map((n) => '0x' + bytesToHex(n));

    const random = bytesToHex(
      new Uint8Array([
        134, 114, 120, 89, 227, 254, 124, 13, 129, 226, 125, 250, 250, 240, 217, 194, 183, 180, 136,
        153, 29, 44, 89, 196, 146, 178, 37, 250, 159, 195, 7,
      ]),
    );

    const relayAdaptParams = RelayAdaptHelper.getRelayAdaptParams(
      [{ nullifiers } as unknown as TransactionStruct],
      random,
      false,
      [
        {
          to: '0x8f86403A4DE0BB5791fa46B8e795C547942fE4Cf',
          data:
            '0x' +
            bytesToHex(
              new Uint8Array([
                210, 140, 37, 212, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
                0, 0, 0, 0, 0, 0, 0, 0, 0, 32, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
                0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 104, 105, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
                0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
              ]),
            ),
          value: BigNumber.from(0n),
        },
      ],
      BigNumber.from(10000000n),
    );

    const expectedParamsHex =
      '0x' +
      bytesToHex(
        new Uint8Array([
          53, 54, 66, 65, 188, 134, 60, 165, 0, 101, 8, 125, 85, 49, 151, 206, 203, 156, 192, 199,
          6, 178, 94, 150, 14, 31, 101, 68, 83, 251, 241, 35,
        ]),
      );

    expect(relayAdaptParams).to.equal(expectedParamsHex);
  });

  afterEach(async () => {
    if (!process.env.RUN_HARDHAT_TESTS) {
      return;
    }
    engine.unload();
    await provider.send('evm_revert', [snapshot]);
  });
});
