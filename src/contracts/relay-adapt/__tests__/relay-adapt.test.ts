/* eslint-disable prefer-template */
import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import memdown from 'memdown';
import { groth16 } from 'snarkjs';
import { bytesToHex } from 'ethereum-cryptography/utils';
import {
  Contract,
  ContractTransaction,
  FallbackProvider,
  JsonRpcProvider,
  TransactionReceipt,
  Wallet,
} from 'ethers';
import { RelayAdaptHelper } from '../relay-adapt-helper';
import { abi as erc20Abi } from '../../../test/test-erc20-abi.test';
import { abi as erc721Abi } from '../../../test/test-erc721-abi.test';
import { config } from '../../../test/config.test';
import { RailgunWallet } from '../../../wallet/railgun-wallet';
import {
  awaitMultipleScans,
  awaitRailgunSmartWalletEvent,
  awaitRailgunSmartWalletShield,
  awaitRailgunSmartWalletTransact,
  awaitRailgunSmartWalletUnshield,
  awaitScan,
  getEthersWallet,
  mockGetLatestValidatedRailgunTxid,
  mockQuickSyncEvents,
  mockQuickSyncRailgunTransactions,
  mockRailgunTxidMerklerootValidator,
  sendTransactionWithLatestNonce,
  testArtifactsGetter,
} from '../../../test/helper.test';
import {
  NFTTokenData,
  OutputType,
  RelayAdaptShieldERC20Recipient,
} from '../../../models/formatted-types';
import { ByteLength, hexToBytes, nToHex, randomHex } from '../../../utils/bytes';
import { SnarkJSGroth16 } from '../../../prover/prover';
import { Chain, ChainType } from '../../../models/engine-types';
import { RailgunEngine } from '../../../railgun-engine';
import { RailgunSmartWalletContract } from '../../railgun-smart-wallet/railgun-smart-wallet';
import {
  MINIMUM_RELAY_ADAPT_CROSS_CONTRACT_CALLS_GAS_LIMIT,
  RelayAdaptContract,
} from '../relay-adapt';
import { ShieldNoteERC20 } from '../../../note/erc20/shield-note-erc20';
import { TransactNote } from '../../../note/transact-note';
import { UnshieldNoteERC20 } from '../../../note/erc20/unshield-note-erc20';
import { TXIDVersion, TransactionStruct } from '../../../models';
import { TransactionBatch } from '../../../transaction/transaction-batch';
import { getTokenDataERC20 } from '../../../note/note-util';
import { mintNFTsID01ForTest, shieldNFTForTest } from '../../../test/shared-test.test';
import { UnshieldNoteNFT } from '../../../note';
import FormattedRelayAdaptErrorLogs from './json/formatted-relay-adapt-error-logs.json';
import { TestERC721 } from '../../../test/abi/typechain/TestERC721';
import { TestERC20 } from '../../../test/abi/typechain/TestERC20';
import { PollingJsonRpcProvider } from '../../../provider/polling-json-rpc-provider';
import { promiseTimeout } from '../../../utils';
import { createPollingJsonRpcProviderForListeners } from '../../../provider/polling-util';
import { isDefined } from '../../../utils/is-defined';

chai.use(chaiAsPromised);
const { expect } = chai;

let provider: JsonRpcProvider;
let chain: Chain;
let engine: RailgunEngine;
let ethersWallet: Wallet;
let snapshot: number;
let relayAdaptContract: RelayAdaptContract;
let railgunSmartWalletContract: RailgunSmartWalletContract;
let nft: TestERC721;
let wallet: RailgunWallet;
let wallet2: RailgunWallet;

const txidVersion = TXIDVersion.V2_PoseidonMerkle;

const testMnemonic = config.mnemonic;
const testEncryptionKey = config.encryptionKey;

const WETH_TOKEN_ADDRESS = config.contracts.weth9;
const SHIELD_RANDOM = randomHex(16);

const NFT_ADDRESS = config.contracts.testERC721;

const wethTokenData = getTokenDataERC20(WETH_TOKEN_ADDRESS);

const DEAD_ADDRESS = '0x000000000000000000000000000000000000dEaD';
const DEPLOYMENT_BLOCKS = {
  [TXIDVersion.V2_PoseidonMerkle]: isDefined(process.env.DEPLOYMENT_BLOCK)
    ? Number(process.env.DEPLOYMENT_BLOCK)
    : 0,
};

let testShieldBaseToken: (value?: bigint) => Promise<TransactionReceipt | null>;

describe('relay-adapt', function test() {
  this.timeout(45000);

  beforeEach(async () => {
    engine = RailgunEngine.initForWallet(
      'TestRelayAdapt',
      memdown(),
      testArtifactsGetter,
      mockQuickSyncEvents,
      mockQuickSyncRailgunTransactions,
      mockRailgunTxidMerklerootValidator,
      mockGetLatestValidatedRailgunTxid,
      undefined, // engineDebugger
      undefined, // skipMerkletreeScans
    );

    engine.prover.setSnarkJSGroth16(groth16 as SnarkJSGroth16);

    wallet = await engine.createWalletFromMnemonic(testEncryptionKey, testMnemonic, 0);
    wallet2 = await engine.createWalletFromMnemonic(testEncryptionKey, testMnemonic, 1);

    if (!isDefined(process.env.RUN_HARDHAT_TESTS)) {
      return;
    }

    provider = new PollingJsonRpcProvider(config.rpc, config.chainId, 500, 1);
    const fallbackProvider = new FallbackProvider([{ provider, weight: 2 }]);

    chain = {
      type: ChainType.EVM,
      id: Number((await provider.getNetwork()).chainId),
    };
    const pollingProvider = await createPollingJsonRpcProviderForListeners(fallbackProvider);
    await engine.loadNetwork(
      chain,
      config.contracts.proxy,
      config.contracts.relayAdapt,
      fallbackProvider,
      pollingProvider,
      DEPLOYMENT_BLOCKS,
      undefined,
    );
    await engine.scanHistory(chain);
    railgunSmartWalletContract = engine.railgunSmartWalletContracts[chain.type][chain.id];
    relayAdaptContract = engine.relayAdaptContracts[chain.type][chain.id];

    ethersWallet = getEthersWallet(config.mnemonic, fallbackProvider);
    snapshot = (await provider.send('evm_snapshot', [])) as number;

    nft = new Contract(NFT_ADDRESS, erc721Abi, ethersWallet) as unknown as TestERC721;

    testShieldBaseToken = async (value: bigint = 10000n): Promise<TransactionReceipt | null> => {
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
      const tx = await sendTransactionWithLatestNonce(ethersWallet, shieldTx);

      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const [_, txReceipt] = await Promise.all([
        awaitRailgunSmartWalletEvent(
          railgunSmartWalletContract,
          railgunSmartWalletContract.contract.filters.Shield(),
        ),
        tx.wait(),
        promiseTimeout(
          awaitScan(wallet, chain),
          20000,
          'Timed out shielding base token for relay adapt test setup',
        ),
      ]);
      return txReceipt;
    };
  });

  it('[HH] Should wrap and shield base token', async function run() {
    if (!isDefined(process.env.RUN_HARDHAT_TESTS)) {
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

    // Send shield on chain
    const txResponse = await sendTransactionWithLatestNonce(ethersWallet, shieldTx);

    await Promise.all([
      awaitRailgunSmartWalletShield(railgunSmartWalletContract),
      txResponse.wait(),
      promiseTimeout(awaitScan(wallet, chain), 15000),
    ]);

    expect(await wallet.getBalanceERC20(txidVersion, chain, WETH_TOKEN_ADDRESS)).to.equal(9975n);
  });

  it('[HH] Should return gas estimate for unshield base token', async function run() {
    if (!isDefined(process.env.RUN_HARDHAT_TESTS)) {
      this.skip();
      return;
    }

    await testShieldBaseToken(100000000n);
    expect(await wallet.getBalanceERC20(txidVersion, chain, WETH_TOKEN_ADDRESS)).to.equal(
      99750000n,
    );

    const transactionBatch = new TransactionBatch(chain);

    const relayerFee = TransactNote.createTransfer(
      wallet2.addressKeys,
      wallet.addressKeys,
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
      txidVersion,
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
    expect(Number(gasEstimate)).to.be.greaterThan(0);
  });

  it('[HH] Should execute relay adapt transaction for unshield base token', async function run() {
    if (!isDefined(process.env.RUN_HARDHAT_TESTS)) {
      this.skip();
      return;
    }

    await testShieldBaseToken();
    expect(await wallet.getBalanceERC20(txidVersion, chain, WETH_TOKEN_ADDRESS)).to.equal(9975n);

    // 1. Generate transaction batch to unshield necessary amount, and pay Relayer.
    const transactionBatch = new TransactionBatch(chain);
    const relayerFee = TransactNote.createTransfer(
      wallet2.addressKeys,
      wallet.addressKeys,
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
      txidVersion,
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
      txidVersion,
      testEncryptionKey,
      () => {},
    );
    transactions.forEach((transaction) => {
      expect(transaction.boundParams.adaptContract).to.equal(relayAdaptContract.address);
      expect(transaction.boundParams.adaptParams).to.equal(relayAdaptParams);
    });

    // const preEthBalance = await ethersWallet.getBalanceERC20(txidVersion, );

    // 5: Generate final relay transaction for unshield base token.
    const relayTransaction = await relayAdaptContract.populateUnshieldBaseToken(
      transactions,
      ethersWallet.address,
      random,
    );

    // 6: Send relay transaction.
    const txResponse = await sendTransactionWithLatestNonce(ethersWallet, relayTransaction);

    const awaiterScan = awaitMultipleScans(wallet, chain, 2);

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const [_t, _u, txReceipt] = await Promise.all([
      awaitRailgunSmartWalletTransact(railgunSmartWalletContract),
      awaitRailgunSmartWalletUnshield(railgunSmartWalletContract),
      txResponse.wait(),
      awaiterScan,
    ]);
    if (txReceipt == null) {
      throw new Error('No transaction receipt for relay transaction');
    }

    expect(await wallet.getBalanceERC20(txidVersion, chain, WETH_TOKEN_ADDRESS)).to.equal(
      BigInt(9975 /* original */ - 100 /* relayer fee */ - 300 /* unshield amount */),
    );

    const callResultError = RelayAdaptContract.getRelayAdaptCallError(txReceipt.logs);
    expect(callResultError).to.equal(undefined);

    // TODO: Fix this test assertion. How much gas is used?
    // const postEthBalance = await ethersWallet.getBalanceERC20(txidVersion, );
    // expect(preEthBalance - txReceipt.gasUsed + 300n).to.equal(
    //   postEthBalance,
    // );
  });

  it('[HH] Should execute relay adapt transaction for NFT transaction', async function run() {
    if (!isDefined(process.env.RUN_HARDHAT_TESTS)) {
      this.skip();
      return;
    }

    // Shield WETH for Relayer fee.
    await testShieldBaseToken();
    expect(await wallet.getBalanceERC20(txidVersion, chain, WETH_TOKEN_ADDRESS)).to.equal(9975n);

    // Mint NFTs with tokenIDs 0 and 1 into public balance.
    await mintNFTsID01ForTest(nft, ethersWallet);

    // Approve NFT for shield.
    const approval = await nft.approve.populateTransaction(railgunSmartWalletContract.address, 1);
    const approvalTxResponse = await sendTransactionWithLatestNonce(ethersWallet, approval);
    await approvalTxResponse.wait();

    // Create shield
    const shield = await shieldNFTForTest(
      wallet,
      ethersWallet,
      railgunSmartWalletContract,
      chain,
      randomHex(16),
      NFT_ADDRESS,
      '1',
    );

    const nftBalanceAfterShield = await nft.balanceOf(railgunSmartWalletContract.address);
    expect(nftBalanceAfterShield).to.equal(1n);

    const nftTokenData = shield.tokenData as NFTTokenData;

    // 1. Generate transaction batch to unshield necessary amount, and pay Relayer.
    const transactionBatch = new TransactionBatch(chain);
    const relayerFee = TransactNote.createTransfer(
      wallet2.addressKeys,
      wallet.addressKeys,
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
      txidVersion,
      testEncryptionKey,
    );

    // 3. Create the cross contract calls.
    // Do nothing for now.
    // TODO: Add a test NFT interaction via cross contract call.
    const crossContractCalls: ContractTransaction[] = [];

    // 4. Create shield inputs.
    const shieldRandom = '0x10203040506070809000102030405060';
    const relayShieldInputs = await RelayAdaptHelper.generateRelayShieldRequests(
      shieldRandom,
      [],
      [{ nftTokenData, recipientAddress: wallet.getAddress() }], // shieldNFTRecipients
    );

    // 6. Get gas estimate from dummy txs.
    const gasEstimateRandom = randomHex(31);
    const populatedTransactionGasEstimate = await relayAdaptContract.populateCrossContractCalls(
      dummyTransactions,
      crossContractCalls,
      relayShieldInputs,
      gasEstimateRandom,
      false, // isGasEstimate
      true, // isRelayerTransaction
    );
    populatedTransactionGasEstimate.from = DEAD_ADDRESS;
    const gasEstimate = await RelayAdaptContract.estimateGasWithErrorHandler(
      provider,
      populatedTransactionGasEstimate,
    );
    expect(Number(gasEstimate)).to.be.greaterThan(
      Number(
        RelayAdaptContract.getMinimumGasLimitForContract(
          MINIMUM_RELAY_ADAPT_CROSS_CONTRACT_CALLS_GAS_LIMIT,
        ),
      ),
    );
    expect(Number(gasEstimate)).to.be.lessThan(
      Number(MINIMUM_RELAY_ADAPT_CROSS_CONTRACT_CALLS_GAS_LIMIT),
    );

    // 7. Create real transactions with relay adapt params.

    const random = '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcd';
    const relayAdaptParams = await relayAdaptContract.getRelayAdaptParamsCrossContractCalls(
      dummyTransactions,
      crossContractCalls,
      relayShieldInputs,
      random,
      true, // isRelayerTransaction
    );
    transactionBatch.setAdaptID({
      contract: relayAdaptContract.address,
      parameters: relayAdaptParams,
    });
    const transactions = await transactionBatch.generateTransactions(
      engine.prover,
      wallet,
      txidVersion,
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
      false, // isGasEstimate
      true, // isRelayerTransaction
    );
    const gasEstimateFinal = await provider.estimateGas(relayTransaction);
    expect(Math.abs(Number(gasEstimate - gasEstimateFinal))).to.be.below(
      15000,
      'Gas difference from estimate (dummy) to final transaction should be less than 15000',
    );

    // 9: Send relay transaction.
    const txResponse = await sendTransactionWithLatestNonce(ethersWallet, relayTransaction);

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const [_t, _u, txReceipt] = await Promise.all([
      awaitRailgunSmartWalletTransact(railgunSmartWalletContract),
      awaitRailgunSmartWalletUnshield(railgunSmartWalletContract),
      txResponse.wait(),
      promiseTimeout(awaitScan(wallet, chain), 10000, 'Timed out waiting for scan'),
    ]);
    if (txReceipt == null) {
      throw new Error('No transaction receipt for relay transaction');
    }

    const callResultError = RelayAdaptContract.getRelayAdaptCallError(txReceipt.logs);
    expect(callResultError).to.equal(undefined);

    const nftBalanceAfterReshield = await nft.balanceOf(railgunSmartWalletContract.address);
    expect(nftBalanceAfterReshield).to.equal(1n);
  }).timeout(60000);

  it('[HH] Should shield all leftover WETH in relay adapt contract', async function run() {
    if (!isDefined(process.env.RUN_HARDHAT_TESTS)) {
      this.skip();
      return;
    }

    await testShieldBaseToken();
    expect(await wallet.getBalanceERC20(txidVersion, chain, WETH_TOKEN_ADDRESS)).to.equal(9975n);

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
      txidVersion,
      testEncryptionKey,
      () => {},
    );
    const transact = await railgunSmartWalletContract.transact(serializedTxs);

    // Unshield to relay adapt.
    const txTransact = await sendTransactionWithLatestNonce(ethersWallet, transact);

    await Promise.all([
      awaitRailgunSmartWalletTransact(railgunSmartWalletContract),
      awaitRailgunSmartWalletUnshield(railgunSmartWalletContract),
      awaitMultipleScans(wallet, chain, 2),
      txTransact.wait(),
    ]);

    const wethTokenContract = new Contract(
      WETH_TOKEN_ADDRESS,
      erc20Abi,
      ethersWallet,
    ) as unknown as TestERC20;

    let relayAdaptAddressBalance: bigint = await wethTokenContract.balanceOf(
      relayAdaptContract.address,
    );
    expect(relayAdaptAddressBalance).to.equal(998n);

    // 9975 - 1000
    expect(await wallet.getBalanceERC20(txidVersion, chain, WETH_TOKEN_ADDRESS)).to.equal(8975n);

    // Value 0n doesn't matter - all WETH remaining in Relay Adapt will be shielded.
    await testShieldBaseToken(0n);

    relayAdaptAddressBalance = await wethTokenContract.balanceOf(relayAdaptContract.address);
    expect(relayAdaptAddressBalance).to.equal(0n);

    // 9975 - 1000 + 998 - 2 (fee)
    expect(await wallet.getBalanceERC20(txidVersion, chain, WETH_TOKEN_ADDRESS)).to.equal(9971n);
  });

  it('[HH] Should execute relay adapt transaction for cross contract call', async function run() {
    if (!isDefined(process.env.RUN_HARDHAT_TESTS)) {
      this.skip();
      return;
    }

    await testShieldBaseToken();
    expect(await wallet.getBalanceERC20(txidVersion, chain, WETH_TOKEN_ADDRESS)).to.equal(9975n);

    // 1. Generate transaction batch to unshield necessary amount, and pay Relayer.
    const transactionBatch = new TransactionBatch(chain);
    const relayerFee = TransactNote.createTransfer(
      wallet2.addressKeys,
      wallet.addressKeys,
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
      txidVersion,
      testEncryptionKey,
    );

    // 3. Create the cross contract call.
    // Cross contract call: send 990n WETH tokens to Dead address.
    const wethTokenContract = new Contract(
      WETH_TOKEN_ADDRESS,
      erc20Abi,
      ethersWallet,
    ) as unknown as TestERC20;
    const sendToAddress = DEAD_ADDRESS;
    const sendAmount = 990n;
    const crossContractCalls: ContractTransaction[] = [
      await wethTokenContract.transfer.populateTransaction(sendToAddress, sendAmount),
    ];

    // 4. Create shield inputs.
    const shieldRandom = '0x10203040506070809000102030405060';
    const shieldERC20Addresses: RelayAdaptShieldERC20Recipient[] = [
      { tokenAddress: WETH_TOKEN_ADDRESS, recipientAddress: wallet.getAddress() },
    ];
    const relayShieldInputs = await RelayAdaptHelper.generateRelayShieldRequests(
      shieldRandom,
      shieldERC20Addresses,
      [], // shieldNFTRecipients
    );

    // 5. Get gas estimate from dummy txs.
    const randomGasEstimate = randomHex(31);
    const populatedTransactionGasEstimate = await relayAdaptContract.populateCrossContractCalls(
      dummyTransactions,
      crossContractCalls,
      relayShieldInputs,
      randomGasEstimate,
      true, // isGasEstimate
      true, // isRelayerTransaction
    );
    populatedTransactionGasEstimate.from = DEAD_ADDRESS;
    const gasEstimate = await RelayAdaptContract.estimateGasWithErrorHandler(
      provider,
      populatedTransactionGasEstimate,
    );
    expect(Number(gasEstimate)).to.be.greaterThan(
      Number(
        RelayAdaptContract.getMinimumGasLimitForContract(
          MINIMUM_RELAY_ADAPT_CROSS_CONTRACT_CALLS_GAS_LIMIT,
        ),
      ),
    );
    expect(Number(gasEstimate)).to.be.lessThan(
      Number(MINIMUM_RELAY_ADAPT_CROSS_CONTRACT_CALLS_GAS_LIMIT),
    );

    // 6. Create real transactions with relay adapt params.
    const random = randomHex(31);
    const relayAdaptParams = await relayAdaptContract.getRelayAdaptParamsCrossContractCalls(
      dummyTransactions,
      crossContractCalls,
      relayShieldInputs,
      random,
      true, // isRelayerTransaction
    );
    transactionBatch.setAdaptID({
      contract: relayAdaptContract.address,
      parameters: relayAdaptParams,
    });
    const transactions = await transactionBatch.generateTransactions(
      engine.prover,
      wallet,
      txidVersion,
      testEncryptionKey,
      () => {},
    );
    transactions.forEach((transaction) => {
      expect(transaction.boundParams.adaptContract).to.equal(relayAdaptContract.address);
      expect(transaction.boundParams.adaptParams).to.equal(relayAdaptParams);
    });

    // 7. Generate real relay transaction for cross contract call.
    const relayTransaction = await relayAdaptContract.populateCrossContractCalls(
      transactions,
      crossContractCalls,
      relayShieldInputs,
      random,
      false, // isGasEstimate
      true, // isRelayerTransaction
    );
    const gasEstimateFinal = await provider.estimateGas(relayTransaction);

    expect(Math.abs(Number(gasEstimate - gasEstimateFinal))).to.be.below(
      10000,
      'Gas difference from estimate (dummy) to final transaction should be less than 10000',
    );

    // Add 20% to gasEstimate for gasLimit.
    relayTransaction.gasLimit = (gasEstimate * 120n) / 100n;

    // 8. Send transaction.
    const txResponse = await sendTransactionWithLatestNonce(ethersWallet, relayTransaction);

    // Perform scans: Unshield and Shield
    const scansAwaiter = awaitMultipleScans(wallet, chain, 3);

    const [txReceipt] = await Promise.all([
      txResponse.wait(),
      awaitRailgunSmartWalletTransact(railgunSmartWalletContract),
    ]);
    if (txReceipt == null) {
      throw new Error('No transaction receipt for relay transaction');
    }

    await expect(scansAwaiter).to.be.fulfilled;

    // Dead address should have 990n WETH.
    const sendAddressBalance: bigint = await wethTokenContract.balanceOf(sendToAddress);
    expect(sendAddressBalance).to.equal(sendAmount);

    const relayAdaptAddressBalance: bigint = await wethTokenContract.balanceOf(
      relayAdaptContract.address,
    );
    expect(relayAdaptAddressBalance).to.equal(0n);

    const callResultError = RelayAdaptContract.getRelayAdaptCallError(txReceipt.logs);
    expect(callResultError).to.equal(undefined);

    const expectedPrivateWethBalance = BigInt(
      9975 /* original shield */ -
        300 /* relayer fee */ -
        1000 /* unshield */ +
        8 /* re-shield (1000 unshield amount - 2 unshield fee - 990 send amount - 0 re-shield fee) */,
    );
    const expectedTotalPrivateWethBalance = expectedPrivateWethBalance + 300n; // Add relayer fee.

    const proxyWethBalance = await wethTokenContract.balanceOf(railgunSmartWalletContract.address);
    expect(proxyWethBalance).to.equal(expectedTotalPrivateWethBalance);

    const privateWalletBalance = await wallet.getBalanceERC20(
      txidVersion,
      chain,
      WETH_TOKEN_ADDRESS,
    );
    expect(privateWalletBalance).to.equal(expectedPrivateWethBalance);
  });

  it('[HH] Should revert send, but keep fees for failing cross contract call', async function run() {
    if (!isDefined(process.env.RUN_HARDHAT_TESTS)) {
      this.skip();
      return;
    }

    await testShieldBaseToken(100000n);
    expect(await wallet.getBalanceERC20(txidVersion, chain, WETH_TOKEN_ADDRESS)).to.equal(99750n);

    // 1. Generate transaction batch to unshield necessary amount, and pay Relayer.
    const transactionBatch = new TransactionBatch(chain);
    const relayerFee = TransactNote.createTransfer(
      wallet2.addressKeys,
      wallet.addressKeys,
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
      txidVersion,
      testEncryptionKey,
    );

    // 3. Create the cross contract call.
    // Cross contract call: send 1 WETH token to Dead address.
    const wethTokenContract = new Contract(
      WETH_TOKEN_ADDRESS,
      erc20Abi,
      ethersWallet,
    ) as unknown as TestERC20;
    const sendToAddress = DEAD_ADDRESS;
    const sendAmount = 20000n; // More than is available (after 0.25% unshield fee).
    const crossContractCalls: ContractTransaction[] = [
      await wethTokenContract.transfer.populateTransaction(sendToAddress, sendAmount),
    ];

    // 4. Create shield inputs.
    const shieldRandom = '10203040506070809000102030405060';
    const shieldERC20Addresses: RelayAdaptShieldERC20Recipient[] = [
      { tokenAddress: WETH_TOKEN_ADDRESS, recipientAddress: wallet.getAddress() },
    ];
    const relayShieldInputs = await RelayAdaptHelper.generateRelayShieldRequests(
      shieldRandom,
      shieldERC20Addresses,
      [], // shieldNFTRecipients
    );

    // 5. Get gas estimate from dummy txs. (Expect revert).
    const gasEstimateRandom = randomHex(31);
    const populatedTransactionGasEstimate = await relayAdaptContract.populateCrossContractCalls(
      dummyTransactions,
      crossContractCalls,
      relayShieldInputs,
      gasEstimateRandom,
      true, // isGasEstimate
      true, // isRelayerTransaction
    );
    populatedTransactionGasEstimate.from = DEAD_ADDRESS;
    await expect(
      RelayAdaptContract.estimateGasWithErrorHandler(provider, populatedTransactionGasEstimate),
    ).to.be.rejectedWith(
      `RelayAdapt multicall failed at index 0 with 'execution reverted (unknown custom error)': Unknown Relay Adapt error.`,
    );

    // 6. Create real transactions with relay adapt params.
    const random = randomHex(31);
    const relayAdaptParams = await relayAdaptContract.getRelayAdaptParamsCrossContractCalls(
      dummyTransactions,
      crossContractCalls,
      relayShieldInputs,
      random,
      true, // isRelayerTransaction
    );
    transactionBatch.setAdaptID({
      contract: relayAdaptContract.address,
      parameters: relayAdaptParams,
    });
    const transactions = await transactionBatch.generateTransactions(
      engine.prover,
      wallet,
      txidVersion,
      testEncryptionKey,
      () => {},
    );
    transactions.forEach((transaction) => {
      expect(transaction.boundParams.adaptContract).to.equal(relayAdaptContract.address);
      expect(transaction.boundParams.adaptParams).to.equal(relayAdaptParams);
    });

    // 7. Generate real relay transaction for cross contract call.
    const relayTransaction = await relayAdaptContract.populateCrossContractCalls(
      transactions,
      crossContractCalls,
      relayShieldInputs,
      random,
      false, // isGasEstimate
      true, // isRelayerTransaction
    );

    // Set high gas limit.
    relayTransaction.gasLimit = BigInt('25000000');

    // 8. Send transaction.
    const txResponse = await sendTransactionWithLatestNonce(ethersWallet, relayTransaction);

    // Perform scans: Unshield and Shield
    const scansAwaiter = awaitMultipleScans(wallet, chain, 3);

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const [_t, _u, txReceipt] = await Promise.all([
      awaitRailgunSmartWalletTransact(railgunSmartWalletContract),
      awaitRailgunSmartWalletUnshield(railgunSmartWalletContract),
      txResponse.wait(),
    ]);
    if (txReceipt == null) {
      throw new Error('No transaction receipt for relay transaction');
    }

    await expect(scansAwaiter).to.be.fulfilled;

    // Dead address should have 0 WETH.
    const sendAddressBalance: bigint = await wethTokenContract.balanceOf(sendToAddress);
    expect(sendAddressBalance).to.equal(0n);

    const relayAdaptAddressBalance: bigint = await wethTokenContract.balanceOf(
      relayAdaptContract.address,
    );
    expect(relayAdaptAddressBalance).to.equal(0n);

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

    const proxyWethBalance = await wethTokenContract.balanceOf(railgunSmartWalletContract.address);
    const privateWalletBalance = await wallet.getBalanceERC20(
      txidVersion,
      chain,
      WETH_TOKEN_ADDRESS,
    );

    expect(proxyWethBalance).to.equal(expectedTotalPrivateWethBalance);
    expect(privateWalletBalance).to.equal(expectedPrivateWethBalance);
  });

  it('[HH] Should revert send for failing re-shield', async function run() {
    if (!isDefined(process.env.RUN_HARDHAT_TESTS)) {
      this.skip();
      return;
    }

    await testShieldBaseToken(100000n);
    expect(await wallet.getBalanceERC20(txidVersion, chain, WETH_TOKEN_ADDRESS)).to.equal(99750n);

    // 1. Generate transaction batch to unshield necessary amount, and pay Relayer.
    const transactionBatch = new TransactionBatch(chain);
    const relayerFee = TransactNote.createTransfer(
      wallet2.addressKeys,
      wallet.addressKeys,
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
      txidVersion,
      testEncryptionKey,
    );

    // 3. Create the cross contract call.
    // Cross contract call: send 1 WETH token to Dead address.
    const wethTokenContract = new Contract(
      WETH_TOKEN_ADDRESS,
      erc20Abi,
      ethersWallet,
    ) as unknown as TestERC20;
    const sendToAddress = DEAD_ADDRESS;
    const sendAmount = 20000n; // More than is available (after 0.25% unshield fee).
    const crossContractCalls: ContractTransaction[] = [
      await wethTokenContract.transfer.populateTransaction(sendToAddress, sendAmount),
    ];

    // 4. Create shield inputs.
    const shieldRandom = '10203040506070809000102030405060';
    const shieldERC20Addresses: RelayAdaptShieldERC20Recipient[] = [
      { tokenAddress: WETH_TOKEN_ADDRESS, recipientAddress: wallet.getAddress() },
    ];
    const relayShieldInputs = await RelayAdaptHelper.generateRelayShieldRequests(
      shieldRandom,
      shieldERC20Addresses,
      [], // shieldNFTRecipients
    );

    // 5. Get gas estimate from dummy txs.
    const randomGasEstimate = randomHex(31);
    const populatedTransactionGasEstimate = await relayAdaptContract.populateCrossContractCalls(
      dummyTransactions,
      crossContractCalls,
      relayShieldInputs,
      randomGasEstimate,
      true, // isGasEstimate
      true, // isRelayerTransaction
    );
    populatedTransactionGasEstimate.from = DEAD_ADDRESS;
    await expect(
      RelayAdaptContract.estimateGasWithErrorHandler(provider, populatedTransactionGasEstimate),
    ).to.be.rejectedWith(
      `RelayAdapt multicall failed at index 0 with 'execution reverted (unknown custom error)': Unknown Relay Adapt error.`,
    );

    // 6. Create real transactions with relay adapt params.
    const random = randomHex(31);
    const relayAdaptParams = await relayAdaptContract.getRelayAdaptParamsCrossContractCalls(
      dummyTransactions,
      crossContractCalls,
      relayShieldInputs,
      random,
      true, // isRelayerTransaction
    );
    transactionBatch.setAdaptID({
      contract: relayAdaptContract.address,
      parameters: relayAdaptParams,
    });
    const transactions = await transactionBatch.generateTransactions(
      engine.prover,
      wallet,
      txidVersion,
      testEncryptionKey,
      () => {},
    );
    transactions.forEach((transaction) => {
      expect(transaction.boundParams.adaptContract).to.equal(relayAdaptContract.address);
      expect(transaction.boundParams.adaptParams).to.equal(relayAdaptParams);
    });

    // 7. Generate real relay transaction for cross contract call.
    const relayTransaction = await relayAdaptContract.populateCrossContractCalls(
      transactions,
      crossContractCalls,
      relayShieldInputs,
      random,
      false, // isGasEstimate
      true, // isRelayerTransaction
    );

    const gasEstimateFinal = await provider.estimateGas(relayTransaction);

    // Gas estimate is currently an underestimate (which is a bug).
    // Set gas limit to this value, which should revert inside the smart contract.
    relayTransaction.gasLimit = (gasEstimateFinal * 101n) / 100n;

    // 8. Send transaction.
    const txResponse = await sendTransactionWithLatestNonce(ethersWallet, relayTransaction);

    // Perform scans: Unshield and Shield
    const scansAwaiter = awaitMultipleScans(wallet, chain, 3);

    const [txReceipt] = await Promise.all([
      txResponse.wait(),
      awaitRailgunSmartWalletTransact(railgunSmartWalletContract),
    ]);
    if (txReceipt == null) {
      throw new Error('No transaction receipt for relay transaction');
    }

    await expect(scansAwaiter).to.be.fulfilled;

    // Dead address should have 0 WETH.
    const sendAddressBalance: bigint = await wethTokenContract.balanceOf(sendToAddress);
    expect(sendAddressBalance).to.equal(0n);

    const relayAdaptAddressBalance: bigint = await wethTokenContract.balanceOf(
      relayAdaptContract.address,
    );
    expect(relayAdaptAddressBalance).to.equal(0n);

    const callResultError = RelayAdaptContract.getRelayAdaptCallError(txReceipt.logs);
    expect(callResultError).to.equal('Unknown Relay Adapt error.');

    // TODO: These are the incorrect assertions, if the tx is fully reverted. This requires a callbacks upgrade to contract.
    // For now, it is partially reverted. Unshield/shield fees are still charged.
    // This caps the loss of funds at 0.5% + Relayer fee.

    const expectedProxyBalance = BigInt(
      99750 /* original */ - 25 /* unshield fee */ - 24 /* re-shield fee */,
    );
    const expectedWalletBalance = BigInt(expectedProxyBalance - 300n /* relayer fee */);

    const treasuryBalance: bigint = await wethTokenContract.balanceOf(
      config.contracts.treasuryProxy,
    );
    expect(treasuryBalance).to.equal(299n);

    const proxyWethBalance = await wethTokenContract.balanceOf(railgunSmartWalletContract.address);
    const privateWalletBalance = await wallet.getBalanceERC20(
      txidVersion,
      chain,
      WETH_TOKEN_ADDRESS,
    );

    expect(proxyWethBalance).to.equal(expectedProxyBalance);
    expect(privateWalletBalance).to.equal(expectedWalletBalance);

    //
    // These are the correct assertions....
    //

    // const expectedPrivateWethBalance = BigInt(99750 /* original */);

    // const treasuryBalance: bigint = await wethTokenContract.balanceOf(config.contracts.treasuryProxy);
    // expect(treasuryBalance).to.equal(250n);

    // const proxyWethBalance = (await wethTokenContract.balanceOf(railgunSmartWalletContract.address));
    // const privateWalletBalance = await wallet.getBalanceERC20(txidVersion, chain, WETH_TOKEN_ADDRESS);

    // expect(proxyWethBalance).to.equal(expectedPrivateWethBalance);
    // expect(privateWalletBalance).to.equal(expectedPrivateWethBalance);
  });

  it('Should generate relay shield notes and inputs', async () => {
    const shieldERC20Recipients: RelayAdaptShieldERC20Recipient[] = [
      {
        tokenAddress: config.contracts.weth9.toLowerCase(),
        recipientAddress: wallet.getAddress(),
      },
      {
        tokenAddress: config.contracts.rail.toLowerCase(),
        recipientAddress: wallet.getAddress(),
      },
    ];

    const random = '10203040506070809000102030405060';
    const relayShieldInputs = await RelayAdaptHelper.generateRelayShieldRequests(
      random,
      shieldERC20Recipients,
      [], // shieldNFTRecipients
    );

    expect(relayShieldInputs.length).to.equal(2);
    expect(
      relayShieldInputs.map((shieldInput) => shieldInput.preimage.token.tokenAddress),
    ).to.deep.equal(shieldERC20Recipients.map((recipient) => recipient.tokenAddress.toLowerCase()));
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
          value: 0n,
        },
      ],
      10000000n,
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

  it('Should decode and parse relay adapt error logs (from failed Sushi V2 LP removal)', () => {
    const relayAdaptError = RelayAdaptContract.getRelayAdaptCallError(FormattedRelayAdaptErrorLogs);
    expect(relayAdaptError).to.equal('ds-math-sub-underflow');
  });

  it('Should extract call failed index and error message from ethers error', () => {
    const errorText = `execution reverted (unknown custom error) (action="estimateGas", data="0x5c0dee5d00000000000000000000000000000000000000000000000000000000000000050000000000000000000000000000000000000000000000000000000000000040000000000000000000000000000000000000000000000000000000000000006408c379a00000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000001564732d6d6174682d7375622d756e646572666c6f77000000000000000000000000000000000000000000000000000000000000000000000000000000", reason=null, transaction={ "data": "0x28223a77000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000007a00000000000000000000000000000000000000000000000000…00000000004640cd6086ade3e984b011b4e8c7cab9369b90499ab88222e673ec1ae4d2c3bf78ae96e95f9171653e5b1410273269edd64a0ab792a5d355093caa9cb92406125c7803a48028503783f2ab5e84f0ea270ce770860e436b77c942ed904a5d577d021cf0fd936183e0298175679d63d73902e116484e10c7b558d4dc84e113380500000000000000000000000000000000000000000000000000000000", "from": "0x000000000000000000000000000000000000dEaD", "to": "0x0355B7B8cb128fA5692729Ab3AAa199C1753f726" }, invocation=null, revert=null, code=CALL_EXCEPTION, version=6.4.0)`;
    const { callFailedIndexString, errorMessage } =
      RelayAdaptContract.extractGasEstimateCallFailedIndexAndErrorText(errorText);
    expect(callFailedIndexString).to.equal('5');
    expect(errorMessage).to.equal(
      `'execution reverted (unknown custom error)': ds-math-sub-underflow`,
    );
  });

  it('Should parse relay adapt log revert data - relay adapt abi value', () => {
    const parsed = RelayAdaptContract.parseRelayAdaptReturnValue(
      `0x5c0dee5d00000000000000000000000000000000000000000000000000000000000000050000000000000000000000000000000000000000000000000000000000000040000000000000000000000000000000000000000000000000000000000000006408c379a00000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000001564732d6d6174682d7375622d756e646572666c6f77000000000000000000000000000000000000000000000000000000000000000000000000000000`,
    );
    expect(parsed?.callIndex).to.equal(5);
    expect(parsed?.error).to.equal('ds-math-sub-underflow');
  });

  it('Should parse relay adapt log revert data - string value', () => {
    const parsed = RelayAdaptContract.parseRelayAdaptReturnValue(
      `0x08c379a0000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000000205261696c67756e4c6f6769633a204e6f746520616c7265616479207370656e74`,
    );
    expect(parsed?.callIndex).to.equal(undefined);
    expect(parsed?.error).to.equal('RailgunLogic: Note already spent');
  });

  it('Should parse relay adapt log revert data - string value from railgun cookbook transaction', () => {
    const parsed = RelayAdaptContract.parseRelayAdaptReturnValue(
      `0x5c0dee5d00000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000040000000000000000000000000000000000000000000000000000000000000002d52656c617941646170743a205265667573696e6720746f2063616c6c205261696c67756e20636f6e747261637400000000000000000000000000000000000000`,
    );
    expect(parsed?.callIndex).to.equal(2);
    expect(parsed?.error).to.equal('RelayAdapt: Refusing to call Railgun contract');
  });

  it('Should extract call failed index and error message from non-parseable ethers error', () => {
    const errorText = `not a parseable error`;
    const { callFailedIndexString, errorMessage } =
      RelayAdaptContract.extractGasEstimateCallFailedIndexAndErrorText(errorText);
    expect(callFailedIndexString).to.equal('UNKNOWN');
    expect(errorMessage).to.equal('error: not a parseable error');
  });

  afterEach(async () => {
    if (!isDefined(process.env.RUN_HARDHAT_TESTS)) {
      return;
    }
    await engine.unload();
    await provider.send('evm_revert', [snapshot]);
  });
});
