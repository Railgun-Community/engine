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
import { RelayAdaptHelper } from '../../relay-adapt-helper';
import { abi as erc20Abi } from '../../../../test/test-erc20-abi.test';
import { abi as erc721Abi } from '../../../../test/test-erc721-abi.test';
import { config } from '../../../../test/config.test';
import { RailgunWallet } from '../../../../wallet/railgun-wallet';
import {
  awaitMultipleScans,
  awaitRailgunSmartWalletShield,
  awaitRailgunSmartWalletTransact,
  awaitRailgunSmartWalletUnshield,
  awaitScan,
  getEthersWallet,
  isV2Test,
  mockGetLatestValidatedRailgunTxid,
  mockQuickSyncEvents,
  mockQuickSyncRailgunTransactionsV2,
  mockRailgunTxidMerklerootValidator,
  sendTransactionWithLatestNonce,
  testArtifactsGetter,
} from '../../../../test/helper.test';
import {
  NFTTokenData,
  OutputType,
  RelayAdaptShieldERC20Recipient,
} from '../../../../models/formatted-types';
import { ByteLength, hexToBytes, nToHex, randomHex } from '../../../../utils/bytes';
import { SnarkJSGroth16 } from '../../../../prover/prover';
import { Chain, ChainType } from '../../../../models/engine-types';
import { RailgunEngine } from '../../../../railgun-engine';
import { ShieldNoteERC20 } from '../../../../note/erc20/shield-note-erc20';
import { TransactNote } from '../../../../note/transact-note';
import { UnshieldNoteERC20 } from '../../../../note/erc20/unshield-note-erc20';
import { TransactionBatch } from '../../../../transaction/transaction-batch';
import { getTokenDataERC20 } from '../../../../note/note-util';
import { mintNFTsID01ForTest, shieldNFTForTest } from '../../../../test/shared-test.test';
import { UnshieldNoteNFT } from '../../../../note';
import { TestERC721 } from '../../../../test/abi/typechain/TestERC721';
import { TestERC20 } from '../../../../test/abi/typechain/TestERC20';
import { PollingJsonRpcProvider } from '../../../../provider/polling-json-rpc-provider';
import { ZERO_ADDRESS, promiseTimeout } from '../../../../utils';
import { createPollingJsonRpcProviderForListeners } from '../../../../provider/polling-util';
import { isDefined } from '../../../../utils/is-defined';
import { TXIDVersion } from '../../../../models/poi-types';
import { WalletBalanceBucket } from '../../../../models/txo-types';
import { RailgunVersionedSmartContracts } from '../../../railgun-smart-wallet/railgun-versioned-smart-contracts';
import { TransactionStructV3 } from '../../../../models';
import { PoseidonMerkleAdaptV3Contract } from '../poseidon-merkle-adapt-v3';

chai.use(chaiAsPromised);
const { expect } = chai;

let provider: JsonRpcProvider;
let chain: Chain;
let engine: RailgunEngine;
let ethersWallet: Wallet;
let snapshot: number;
let nft: TestERC721;
let wallet: RailgunWallet;
let wallet2: RailgunWallet;

const txidVersion = TXIDVersion.V3_PoseidonMerkle;

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
  [TXIDVersion.V3_PoseidonMerkle]: isDefined(process.env.DEPLOYMENT_BLOCK)
    ? Number(process.env.DEPLOYMENT_BLOCK)
    : 0,
};

let testShieldBaseToken: (value?: bigint) => Promise<TransactionReceipt | null>;

describe('poseidon-merkle-adapt-v3', function test() {
  this.timeout(45000);

  beforeEach(async () => {
    engine = RailgunEngine.initForWallet(
      'TestRelayAdaptV3',
      memdown(),
      testArtifactsGetter,
      mockQuickSyncEvents,
      mockQuickSyncRailgunTransactionsV2,
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
    const pollingProvider = await createPollingJsonRpcProviderForListeners(
      fallbackProvider,
      chain.id,
    );
    await engine.loadNetwork(
      chain,
      config.contracts.proxy,
      config.contracts.relayAdapt,
      config.contracts.poseidonMerkleAccumulatorV3,
      config.contracts.poseidonMerkleVerifierV3,
      config.contracts.tokenVaultV3,
      config.contracts.poseidonMerkleAdaptV3,
      fallbackProvider,
      pollingProvider,
      DEPLOYMENT_BLOCKS,
      undefined,
      !isV2Test(), // supportsV3
    );
    await engine.scanHistory(chain);

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

      const shieldTx = await RailgunVersionedSmartContracts.populateShieldBaseToken(
        txidVersion,
        chain,
        shieldRequest,
      );

      // Send shield on chain
      const tx = await sendTransactionWithLatestNonce(ethersWallet, shieldTx);

      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const [_, txReceipt] = await Promise.all([
        awaitRailgunSmartWalletShield(txidVersion, chain),
        tx.wait(),
        promiseTimeout(
          awaitScan(wallet, chain),
          20000,
          'Timed out shielding base token for relay adapt test setup',
        ),
      ]);
      await wallet.refreshPOIsForTXIDVersion(chain, txidVersion, true);

      return txReceipt;
    };
  });

  it('[V3] [HH] Should wrap and shield base token', async function run() {
    if (isV2Test() || !isDefined(process.env.RUN_HARDHAT_TESTS)) {
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

    const shieldTx = await RailgunVersionedSmartContracts.populateShieldBaseToken(
      txidVersion,
      chain,
      shieldRequest,
    );

    // Send shield on chain
    const txResponse = await sendTransactionWithLatestNonce(ethersWallet, shieldTx);

    await Promise.all([
      awaitRailgunSmartWalletShield(txidVersion, chain),
      txResponse.wait(),
      promiseTimeout(awaitScan(wallet, chain), 15000),
    ]);
    await wallet.refreshPOIsForTXIDVersion(chain, txidVersion, true);

    expect(
      await wallet.getBalanceERC20(txidVersion, chain, WETH_TOKEN_ADDRESS, [
        WalletBalanceBucket.Spendable,
      ]),
    ).to.equal(9975n);
  });

  it('[V3] [HH] Should return gas estimate for unshield base token', async function run() {
    if (isV2Test() || !isDefined(process.env.RUN_HARDHAT_TESTS)) {
      this.skip();
      return;
    }

    await testShieldBaseToken(100000000n);
    expect(
      await wallet.getBalanceERC20(txidVersion, chain, WETH_TOKEN_ADDRESS, [
        WalletBalanceBucket.Spendable,
      ]),
    ).to.equal(99750000n);

    const transactionBatch = new TransactionBatch(chain);

    const relayerFee = TransactNote.createTransfer(
      wallet2.addressKeys,
      wallet.addressKeys,
      1000n,
      wethTokenData,
      false, // showSenderAddressToRecipient
      OutputType.RelayerFee,
      undefined, // memoText
    );
    transactionBatch.addOutput(relayerFee); // Simulate Relayer fee output.

    const unshieldValue = 99000000n;

    const unshieldNote = new UnshieldNoteERC20(
      RailgunVersionedSmartContracts.getRelayAdaptContract(txidVersion, chain).address,
      unshieldValue,
      WETH_TOKEN_ADDRESS,
    );
    transactionBatch.addUnshieldData(unshieldNote.unshieldData);

    const dummyTransactions = await transactionBatch.generateDummyTransactions(
      engine.prover,
      wallet,
      txidVersion,
      testEncryptionKey,
      [], // crossContractCallsV3
    );

    const relayTransactionGasEstimate =
      await RailgunVersionedSmartContracts.populateUnshieldBaseToken(
        txidVersion,
        chain,
        dummyTransactions,
        ethersWallet.address,
        undefined, // random31BytesV2Only
      );

    relayTransactionGasEstimate.from = DEAD_ADDRESS;

    const gasEstimate = await provider.estimateGas(relayTransactionGasEstimate);
    expect(Number(gasEstimate)).to.be.greaterThan(0);
  });

  it('[V3] [HH] Should execute relay adapt transaction for unshield base token', async function run() {
    if (isV2Test() || !isDefined(process.env.RUN_HARDHAT_TESTS)) {
      this.skip();
      return;
    }

    await testShieldBaseToken();
    expect(
      await wallet.getBalanceERC20(txidVersion, chain, WETH_TOKEN_ADDRESS, [
        WalletBalanceBucket.Spendable,
      ]),
    ).to.equal(9975n);

    // 1. Generate transaction batch to unshield necessary amount, and pay Relayer.
    const transactionBatch = new TransactionBatch(chain);
    const relayerFee = TransactNote.createTransfer(
      wallet2.addressKeys,
      wallet.addressKeys,
      100n,
      wethTokenData,
      false, // showSenderAddressToRecipient
      OutputType.RelayerFee,
      undefined, // memoText
    );
    transactionBatch.addOutput(relayerFee); // Simulate Relayer fee output.

    const unshieldValue = 300n;
    const unshieldNote = new UnshieldNoteERC20(
      RailgunVersionedSmartContracts.getRelayAdaptContract(txidVersion, chain).address,
      unshieldValue,
      WETH_TOKEN_ADDRESS,
    );
    transactionBatch.addUnshieldData(unshieldNote.unshieldData);

    // 2. Create real transactions with relay adapt params.
    const { provedTransactions } = await transactionBatch.generateTransactions(
      engine.prover,
      wallet,
      txidVersion,
      testEncryptionKey,
      () => {},
      false, // shouldGeneratePreTransactionPOIs
      [],
    );

    // 3: Generate final transaction for unshield base token.
    const transaction = await RailgunVersionedSmartContracts.populateUnshieldBaseToken(
      txidVersion,
      chain,
      provedTransactions,
      ethersWallet.address,
      undefined, // random31BytesV2Only
    );

    // 4: Send transaction.
    const txResponse = await sendTransactionWithLatestNonce(ethersWallet, transaction);

    const awaiterScan = awaitMultipleScans(wallet, chain, 2);

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const [_t, _u, txReceipt] = await Promise.all([
      awaitRailgunSmartWalletTransact(txidVersion, chain),
      awaitRailgunSmartWalletUnshield(txidVersion, chain),
      txResponse.wait(),
      awaiterScan,
    ]);
    if (txReceipt == null) {
      throw new Error('No transaction receipt for relay transaction');
    }
    await wallet.refreshPOIsForTXIDVersion(chain, txidVersion, true);

    expect(
      await wallet.getBalanceERC20(txidVersion, chain, WETH_TOKEN_ADDRESS, [
        WalletBalanceBucket.Spendable,
      ]),
    ).to.equal(BigInt(9975 /* original */ - 100 /* relayer fee */ - 300 /* unshield amount */));

    const callResultError = RailgunVersionedSmartContracts.getRelayAdaptCallError(
      txidVersion,
      txReceipt.logs,
    );
    expect(callResultError).to.equal(undefined);
  });

  it('[V3] [HH] Should execute relay adapt transaction for NFT transaction', async function run() {
    if (isV2Test() || !isDefined(process.env.RUN_HARDHAT_TESTS)) {
      this.skip();
      return;
    }

    // Shield WETH for Relayer fee.
    await testShieldBaseToken();
    expect(
      await wallet.getBalanceERC20(txidVersion, chain, WETH_TOKEN_ADDRESS, [
        WalletBalanceBucket.Spendable,
      ]),
    ).to.equal(9975n);

    // Mint NFTs with tokenIDs 0 and 1 into public balance.
    await mintNFTsID01ForTest(nft, ethersWallet);

    // Approve NFT for shield.
    const approval = await nft.approve.populateTransaction(
      RailgunVersionedSmartContracts.getShieldApprovalContract(txidVersion, chain).address,
      1,
    );
    const approvalTxResponse = await sendTransactionWithLatestNonce(ethersWallet, approval);
    await approvalTxResponse.wait();

    // Create shield
    const shield = await shieldNFTForTest(
      txidVersion,
      wallet,
      ethersWallet,
      chain,
      randomHex(16),
      NFT_ADDRESS,
      '1',
    );

    const nftBalanceAfterShield = await nft.balanceOf(
      RailgunVersionedSmartContracts.getShieldApprovalContract(txidVersion, chain).address,
    );
    expect(nftBalanceAfterShield).to.equal(1n);

    const nftTokenData = shield.tokenData as NFTTokenData;

    // 1. Generate transaction batch to unshield necessary amount, and pay Relayer.
    const transactionBatch = new TransactionBatch(chain);
    const relayerFee = TransactNote.createTransfer(
      wallet2.addressKeys,
      wallet.addressKeys,
      300n,
      wethTokenData,
      false, // showSenderAddressToRecipient
      OutputType.RelayerFee,
      undefined, // memoText
    );
    transactionBatch.addOutput(relayerFee); // Simulate Relayer fee output.

    const unshieldNote = new UnshieldNoteNFT(
      RailgunVersionedSmartContracts.getRelayAdaptContract(txidVersion, chain).address,
      nftTokenData,
    );
    transactionBatch.addUnshieldData(unshieldNote.unshieldData);

    // 2. Create the cross contract calls.
    // Do nothing for now.
    // TODO: Add a test NFT interaction via cross contract call.
    const crossContractCalls: ContractTransaction[] = [];

    // 3. Create dummy transactions from batch.
    const dummyTransactions = await transactionBatch.generateDummyTransactions(
      engine.prover,
      wallet,
      txidVersion,
      testEncryptionKey,
      crossContractCalls,
    );

    // 4. Populate dummy execute transaction for gas estimate
    const populatedTransactionGasEstimate = await RailgunVersionedSmartContracts.generateTransact(
      txidVersion,
      chain,
      dummyTransactions,
    );
    populatedTransactionGasEstimate.from = DEAD_ADDRESS;
    const gasEstimate = await RailgunVersionedSmartContracts.estimateGasWithErrorHandler(
      txidVersion,
      provider,
      populatedTransactionGasEstimate,
    );
    expect(Number(gasEstimate)).to.be.greaterThan(1_000_000);
    expect(Number(gasEstimate)).to.be.lessThan(1_100_000);

    const relayAdaptV3Calldata = RailgunVersionedSmartContracts.getRelayAdaptV3Calldata(
      txidVersion,
      chain,
      crossContractCalls,
    );

    // 5. Create real transactions with relay adapt params.
    const { provedTransactions } = await transactionBatch.generateTransactions(
      engine.prover,
      wallet,
      txidVersion,
      testEncryptionKey,
      () => {},
      false, // shouldGeneratePreTransactionPOIs
      crossContractCalls,
    );
    provedTransactions.forEach((transaction) => {
      expect((transaction as TransactionStructV3).boundParams.global.to).to.equal(
        RailgunVersionedSmartContracts.getRelayAdaptContract(txidVersion, chain).address,
      );
      expect((transaction as TransactionStructV3).boundParams.global.data).to.equal(
        relayAdaptV3Calldata,
      );
    });

    // 6. Generate real relay transaction for cross contract call.
    const populatedTransaction = await RailgunVersionedSmartContracts.generateTransact(
      txidVersion,
      chain,
      provedTransactions,
    );
    const gasEstimateFinal = await provider.estimateGas(populatedTransaction);
    expect(Math.abs(Number(gasEstimate - gasEstimateFinal))).to.be.below(
      15000,
      'Gas difference from estimate (dummy) to final transaction should be less than 15000',
    );

    // 7: Send relay transaction.
    const txResponse = await sendTransactionWithLatestNonce(ethersWallet, populatedTransaction);

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const [_t, _u, txReceipt] = await Promise.all([
      awaitRailgunSmartWalletTransact(txidVersion, chain),
      awaitRailgunSmartWalletUnshield(txidVersion, chain),
      txResponse.wait(),
      promiseTimeout(
        awaitScan(wallet, chain),
        10000,
        'Timed out waiting for scan after cross-contract call',
      ),
    ]);
    if (txReceipt == null) {
      throw new Error('No transaction receipt for relay transaction');
    }

    const callResultError = RailgunVersionedSmartContracts.getRelayAdaptCallError(
      txidVersion,
      txReceipt.logs,
    );
    expect(callResultError).to.equal(undefined);

    const nftBalanceAfterReshield = await nft.balanceOf(
      RailgunVersionedSmartContracts.getShieldApprovalContract(txidVersion, chain).address,
    );
    expect(nftBalanceAfterReshield).to.equal(1n);
  }).timeout(300_000);

  it.only(
    '[V3] [HH] Should execute relay adapt transaction for NFT transaction - no relayer fee',
    async function run() {
      if (isV2Test() || !isDefined(process.env.RUN_HARDHAT_TESTS)) {
        this.skip();
        return;
      }

      // Mint NFTs with tokenIDs 0 and 1 into public balance.
      await mintNFTsID01ForTest(nft, ethersWallet);

      // Approve NFT for shield.
      const approval = await nft.approve.populateTransaction(
        RailgunVersionedSmartContracts.getShieldApprovalContract(txidVersion, chain).address,
        1,
      );
      const approvalTxResponse = await sendTransactionWithLatestNonce(ethersWallet, approval);
      await approvalTxResponse.wait();

      // Create shield
      const shield = await shieldNFTForTest(
        txidVersion,
        wallet,
        ethersWallet,
        chain,
        randomHex(16),
        NFT_ADDRESS,
        '1',
      );

      const nftBalanceAfterShield = await nft.balanceOf(
        RailgunVersionedSmartContracts.getShieldApprovalContract(txidVersion, chain).address,
      );
      expect(nftBalanceAfterShield).to.equal(1n);

      const nftTokenData = shield.tokenData as NFTTokenData;

      // 1. Generate transaction batch to unshield necessary amount, and pay Relayer.
      const transactionBatch = new TransactionBatch(chain);

      const unshieldNote = new UnshieldNoteNFT(
        RailgunVersionedSmartContracts.getRelayAdaptContract(txidVersion, chain).address,
        nftTokenData,
      );
      transactionBatch.addUnshieldData(unshieldNote.unshieldData);

      // 2. Create the cross contract calls.
      // Do nothing.
      const crossContractCalls: ContractTransaction[] = [];

      // 3. Create dummy transactions from batch.
      const dummyTransactions = await transactionBatch.generateDummyTransactions(
        engine.prover,
        wallet,
        txidVersion,
        testEncryptionKey,
        crossContractCalls,
      );

      // 4. Populate dummy execute transaction for gas estimate
      const populatedTransactionGasEstimate = await RailgunVersionedSmartContracts.generateTransact(
        txidVersion,
        chain,
        dummyTransactions,
      );
      populatedTransactionGasEstimate.from = DEAD_ADDRESS;
      const gasEstimate = await RailgunVersionedSmartContracts.estimateGasWithErrorHandler(
        txidVersion,
        provider,
        populatedTransactionGasEstimate,
      );

      // TODO-V3: Add these gasEstimate checks when re-shield is working on relay-adapt.
      // expect(Number(gasEstimate)).to.be.greaterThan(1_000_000);
      // expect(Number(gasEstimate)).to.be.lessThan(1_100_000);

      // 5. Create real transactions with relay adapt params.
      const { provedTransactions } = await transactionBatch.generateTransactions(
        engine.prover,
        wallet,
        txidVersion,
        testEncryptionKey,
        () => {},
        false, // shouldGeneratePreTransactionPOIs
        crossContractCalls,
      );
      provedTransactions.forEach((transaction) => {
        expect((transaction as TransactionStructV3).boundParams.global.to).to.equal(ZERO_ADDRESS);
        expect((transaction as TransactionStructV3).boundParams.global.data).to.equal('0x');
      });

      // 6. Generate real relay transaction for cross contract call.
      const populatedTransaction = await RailgunVersionedSmartContracts.generateTransact(
        txidVersion,
        chain,
        provedTransactions,
      );
      const gasEstimateFinal = await provider.estimateGas(populatedTransaction);
      expect(Math.abs(Number(gasEstimate - gasEstimateFinal))).to.be.below(
        15000,
        'Gas difference from estimate (dummy) to final transaction should be less than 15000',
      );

      // 7: Send relay transaction.
      const txResponse = await sendTransactionWithLatestNonce(ethersWallet, populatedTransaction);

      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const [_t, _u, txReceipt] = await Promise.all([
        awaitRailgunSmartWalletTransact(txidVersion, chain),
        awaitRailgunSmartWalletUnshield(txidVersion, chain),
        txResponse.wait(),
        promiseTimeout(
          awaitScan(wallet, chain),
          10000,
          'Timed out waiting for scan after cross-contract call',
        ),
      ]);
      if (txReceipt == null) {
        throw new Error('No transaction receipt for relay transaction');
      }

      const callResultError = RailgunVersionedSmartContracts.getRelayAdaptCallError(
        txidVersion,
        txReceipt.logs,
      );
      expect(callResultError).to.equal(undefined);

      // TODO-V3: This is expected to fail until re-shield is working on relay-adapt.
      const nftBalanceAfterReshield = await nft.balanceOf(
        RailgunVersionedSmartContracts.getShieldApprovalContract(txidVersion, chain).address,
      );
      expect(nftBalanceAfterReshield).to.equal(1n);
    },
  ).timeout(300_000);

  it('[V3] [HH] Should shield all leftover WETH in relay adapt contract', async function run() {
    if (isV2Test() || !isDefined(process.env.RUN_HARDHAT_TESTS)) {
      this.skip();
      return;
    }

    await testShieldBaseToken();
    expect(
      await wallet.getBalanceERC20(txidVersion, chain, WETH_TOKEN_ADDRESS, [
        WalletBalanceBucket.Spendable,
      ]),
    ).to.equal(9975n);

    // 1. Generate transaction batch to unshield necessary amount, and pay Relayer.
    const transactionBatch = new TransactionBatch(chain);
    const unshieldNote = new UnshieldNoteERC20(
      RailgunVersionedSmartContracts.getRelayAdaptContract(txidVersion, chain).address,
      1000n,
      WETH_TOKEN_ADDRESS,
    );
    transactionBatch.addUnshieldData(unshieldNote.unshieldData);

    const { provedTransactions: serializedTxs } = await transactionBatch.generateTransactions(
      engine.prover,
      wallet,
      txidVersion,
      testEncryptionKey,
      () => {},
      false, // shouldGeneratePreTransactionPOIs
      [], // crossContractCallsV3
    );
    const transact = await RailgunVersionedSmartContracts.generateTransact(
      txidVersion,
      chain,
      serializedTxs,
    );

    // Unshield to relay adapt.
    const txTransact = await sendTransactionWithLatestNonce(ethersWallet, transact);

    await Promise.all([
      awaitRailgunSmartWalletTransact(txidVersion, chain),
      awaitRailgunSmartWalletUnshield(txidVersion, chain),
      awaitMultipleScans(wallet, chain, 2),
      txTransact.wait(),
    ]);

    const wethTokenContract = new Contract(
      WETH_TOKEN_ADDRESS,
      erc20Abi,
      ethersWallet,
    ) as unknown as TestERC20;

    let relayAdaptAddressBalance: bigint = await wethTokenContract.balanceOf(
      RailgunVersionedSmartContracts.getRelayAdaptContract(txidVersion, chain).address,
    );
    expect(relayAdaptAddressBalance).to.equal(998n);

    // 9975 - 1000
    expect(
      await wallet.getBalanceERC20(txidVersion, chain, WETH_TOKEN_ADDRESS, [
        WalletBalanceBucket.Spendable,
      ]),
    ).to.equal(8975n);

    // Value 0n doesn't matter - all WETH remaining in Relay Adapt will be shielded.
    await testShieldBaseToken(0n);

    relayAdaptAddressBalance = await wethTokenContract.balanceOf(
      RailgunVersionedSmartContracts.getRelayAdaptContract(txidVersion, chain).address,
    );
    expect(relayAdaptAddressBalance).to.equal(0n);

    // 9975 - 1000 + 998 - 2 (fee)
    expect(
      await wallet.getBalanceERC20(txidVersion, chain, WETH_TOKEN_ADDRESS, [
        WalletBalanceBucket.Spendable,
      ]),
    ).to.equal(9971n);
  }).timeout(300_000);

  it('[V3] [HH] Should execute relay adapt transaction for cross contract call', async function run() {
    if (isV2Test() || !isDefined(process.env.RUN_HARDHAT_TESTS)) {
      this.skip();
      return;
    }

    await testShieldBaseToken();
    expect(
      await wallet.getBalanceERC20(txidVersion, chain, WETH_TOKEN_ADDRESS, [
        WalletBalanceBucket.Spendable,
      ]),
    ).to.equal(9975n);

    // 1. Generate transaction batch to unshield necessary amount, and pay Relayer.
    const transactionBatch = new TransactionBatch(chain);
    const relayerFee = TransactNote.createTransfer(
      wallet2.addressKeys,
      wallet.addressKeys,
      300n,
      wethTokenData,
      false, // showSenderAddressToRecipient
      OutputType.RelayerFee,
      undefined, // memoText
    );
    transactionBatch.addOutput(relayerFee); // Simulate Relayer fee output.
    const unshieldNote = new UnshieldNoteERC20(
      RailgunVersionedSmartContracts.getRelayAdaptContract(txidVersion, chain).address,
      1000n,
      WETH_TOKEN_ADDRESS,
    );
    transactionBatch.addUnshieldData(unshieldNote.unshieldData);

    // 2. Create the cross contract call.
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

    // 3. Create dummy transactions from batch.
    const dummyTransactions = await transactionBatch.generateDummyTransactions(
      engine.prover,
      wallet,
      txidVersion,
      testEncryptionKey,
      crossContractCalls,
    );

    // 4. Populate dummy execute transaction for gas estimate
    const populatedTransactionGasEstimate = await RailgunVersionedSmartContracts.generateTransact(
      txidVersion,
      chain,
      dummyTransactions,
    );
    populatedTransactionGasEstimate.from = DEAD_ADDRESS;
    const gasEstimate = await RailgunVersionedSmartContracts.estimateGasWithErrorHandler(
      txidVersion,
      provider,
      populatedTransactionGasEstimate,
    );
    expect(Number(gasEstimate)).to.be.greaterThan(1_000_000);
    expect(Number(gasEstimate)).to.be.lessThan(1_100_000);

    const relayAdaptV3Calldata = RailgunVersionedSmartContracts.getRelayAdaptV3Calldata(
      txidVersion,
      chain,
      crossContractCalls,
    );

    // 5. Create real transactions with relay adapt params.
    const { provedTransactions } = await transactionBatch.generateTransactions(
      engine.prover,
      wallet,
      txidVersion,
      testEncryptionKey,
      () => {},
      false, // shouldGeneratePreTransactionPOIs
      crossContractCalls,
    );
    provedTransactions.forEach((transaction) => {
      expect((transaction as TransactionStructV3).boundParams.global.to).to.equal(
        RailgunVersionedSmartContracts.getRelayAdaptContract(txidVersion, chain).address,
      );
      expect((transaction as TransactionStructV3).boundParams.global.data).to.equal(
        relayAdaptV3Calldata,
      );
    });

    // 7. Generate real relay transaction for cross contract call.
    const populatedTransaction = await RailgunVersionedSmartContracts.generateTransact(
      txidVersion,
      chain,
      provedTransactions,
    );
    const gasEstimateFinal = await provider.estimateGas(populatedTransaction);

    expect(Math.abs(Number(gasEstimate - gasEstimateFinal))).to.be.below(
      10000,
      'Gas difference from estimate (dummy) to final transaction should be less than 10000',
    );

    // Add 20% to gasEstimate for gasLimit.
    populatedTransaction.gasLimit = (gasEstimate * 120n) / 100n;

    // 8. Send transaction.
    const txResponse = await sendTransactionWithLatestNonce(ethersWallet, populatedTransaction);

    // Perform scans: Unshield and Shield
    const scansAwaiter = awaitMultipleScans(wallet, chain, 3);

    const [txReceipt] = await Promise.all([
      txResponse.wait(),
      awaitRailgunSmartWalletTransact(txidVersion, chain),
    ]);
    if (txReceipt == null) {
      throw new Error('No transaction receipt for relay transaction');
    }

    await expect(scansAwaiter).to.be.fulfilled;
    await wallet.refreshPOIsForTXIDVersion(chain, txidVersion, true);

    // Dead address should have 990n WETH.
    const sendAddressBalance: bigint = await wethTokenContract.balanceOf(sendToAddress);
    expect(sendAddressBalance).to.equal(sendAmount);

    const relayAdaptAddressBalance: bigint = await wethTokenContract.balanceOf(
      RailgunVersionedSmartContracts.getRelayAdaptContract(txidVersion, chain).address,
    );
    expect(relayAdaptAddressBalance).to.equal(0n);

    const callResultError = RailgunVersionedSmartContracts.getRelayAdaptCallError(
      txidVersion,
      txReceipt.logs,
    );
    expect(callResultError).to.equal(undefined);

    const expectedPrivateWethBalance = BigInt(
      9975 /* original shield */ -
        300 /* relayer fee */ -
        1000 /* unshield */ +
        8 /* re-shield (1000 unshield amount - 2 unshield fee - 990 send amount - 0 re-shield fee) */,
    );
    const expectedTotalPrivateWethBalance = expectedPrivateWethBalance + 300n; // Add relayer fee.

    const proxyWethBalance = await wethTokenContract.balanceOf(
      RailgunVersionedSmartContracts.getShieldApprovalContract(txidVersion, chain).address,
    );
    expect(proxyWethBalance).to.equal(expectedTotalPrivateWethBalance);

    const privateWalletBalance = await wallet.getBalanceERC20(
      txidVersion,
      chain,
      WETH_TOKEN_ADDRESS,
      [WalletBalanceBucket.Spendable],
    );
    expect(privateWalletBalance).to.equal(expectedPrivateWethBalance);
  }).timeout(300_000);

  it('[V3] [HH] Should revert send, but keep fees for failing cross contract call', async function run() {
    if (isV2Test() || !isDefined(process.env.RUN_HARDHAT_TESTS)) {
      this.skip();
      return;
    }

    await testShieldBaseToken(100000n);
    expect(
      await wallet.getBalanceERC20(txidVersion, chain, WETH_TOKEN_ADDRESS, [
        WalletBalanceBucket.Spendable,
      ]),
    ).to.equal(99750n);

    // 1. Generate transaction batch to unshield necessary amount, and pay Relayer.
    const transactionBatch = new TransactionBatch(chain);
    const relayerFee = TransactNote.createTransfer(
      wallet2.addressKeys,
      wallet.addressKeys,
      300n,
      wethTokenData,
      false, // showSenderAddressToRecipient
      OutputType.RelayerFee,
      undefined, // memoText
    );
    transactionBatch.addOutput(relayerFee); // Simulate Relayer fee output.
    const unshieldNote = new UnshieldNoteERC20(
      RailgunVersionedSmartContracts.getRelayAdaptContract(txidVersion, chain).address,
      10000n,
      WETH_TOKEN_ADDRESS,
    );
    transactionBatch.addUnshieldData(unshieldNote.unshieldData);

    // 2. Create the cross contract call.
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

    // 3. Create dummy transactions from batch.
    const dummyTransactions = await transactionBatch.generateDummyTransactions(
      engine.prover,
      wallet,
      txidVersion,
      testEncryptionKey,
      crossContractCalls,
    );

    // 4. Populate dummy execute transaction for gas estimate
    const populatedTransactionGasEstimate = await RailgunVersionedSmartContracts.generateTransact(
      txidVersion,
      chain,
      dummyTransactions,
    );
    populatedTransactionGasEstimate.from = DEAD_ADDRESS;
    await expect(
      RailgunVersionedSmartContracts.estimateGasWithErrorHandler(
        txidVersion,
        provider,
        populatedTransactionGasEstimate,
      ),
    ).to.be.rejectedWith(
      `RelayAdapt multicall failed at index 0 with 'execution reverted (unknown custom error)': Unknown Relay Adapt error.`,
    );

    const relayAdaptV3Calldata = RailgunVersionedSmartContracts.getRelayAdaptV3Calldata(
      txidVersion,
      chain,
      crossContractCalls,
    );

    // 5. Populate actual execute transaction (proved)
    const { provedTransactions } = await transactionBatch.generateTransactions(
      engine.prover,
      wallet,
      txidVersion,
      testEncryptionKey,
      () => {},
      false, // shouldGeneratePreTransactionPOIs
      crossContractCalls,
    );
    provedTransactions.forEach((transaction) => {
      expect((transaction as TransactionStructV3).boundParams.global.to).to.equal(
        RailgunVersionedSmartContracts.getRelayAdaptContract(txidVersion, chain).address,
      );
      expect((transaction as TransactionStructV3).boundParams.global.data).to.equal(
        relayAdaptV3Calldata.data,
      );
    });

    // 6. Generate actual 'execute' transaction for cross contract call.
    const populatedTransaction = await RailgunVersionedSmartContracts.generateTransact(
      txidVersion,
      chain,
      provedTransactions,
    );

    // 7. Send transaction.
    const txResponse = await sendTransactionWithLatestNonce(ethersWallet, populatedTransaction);

    // Perform scans: Unshield and Shield
    const scansAwaiter = awaitMultipleScans(wallet, chain, 3);

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const [_t, _u, txReceipt] = await Promise.all([
      awaitRailgunSmartWalletTransact(txidVersion, chain),
      awaitRailgunSmartWalletUnshield(txidVersion, chain),
      txResponse.wait(),
    ]);
    if (txReceipt == null) {
      throw new Error('No transaction receipt for relay transaction');
    }

    await expect(scansAwaiter).to.be.fulfilled;
    await wallet.refreshPOIsForTXIDVersion(chain, txidVersion, true);

    // Dead address should have 0 WETH.
    const sendAddressBalance: bigint = await wethTokenContract.balanceOf(sendToAddress);
    expect(sendAddressBalance).to.equal(0n);

    const relayAdaptAddressBalance: bigint = await wethTokenContract.balanceOf(
      RailgunVersionedSmartContracts.getRelayAdaptContract(txidVersion, chain).address,
    );
    expect(relayAdaptAddressBalance).to.equal(0n);

    const callResultError = RailgunVersionedSmartContracts.getRelayAdaptCallError(
      txidVersion,
      txReceipt.logs,
    );
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

    const proxyWethBalance = await wethTokenContract.balanceOf(
      RailgunVersionedSmartContracts.getShieldApprovalContract(txidVersion, chain).address,
    );
    const privateWalletBalance = await wallet.getBalanceERC20(
      txidVersion,
      chain,
      WETH_TOKEN_ADDRESS,
      [WalletBalanceBucket.Spendable],
    );

    expect(proxyWethBalance).to.equal(expectedTotalPrivateWethBalance);
    expect(privateWalletBalance).to.equal(expectedPrivateWethBalance);
  });

  it('[V3] [HH] Should revert send for failing re-shield', async function run() {
    if (isV2Test() || !isDefined(process.env.RUN_HARDHAT_TESTS)) {
      this.skip();
      return;
    }

    await testShieldBaseToken(100000n);
    expect(
      await wallet.getBalanceERC20(txidVersion, chain, WETH_TOKEN_ADDRESS, [
        WalletBalanceBucket.Spendable,
      ]),
    ).to.equal(99750n);

    // 1. Generate transaction batch to unshield necessary amount, and pay Relayer.
    const transactionBatch = new TransactionBatch(chain);
    const relayerFee = TransactNote.createTransfer(
      wallet2.addressKeys,
      wallet.addressKeys,
      300n,
      wethTokenData,
      false, // showSenderAddressToRecipient
      OutputType.RelayerFee,
      undefined, // memoText
    );
    transactionBatch.addOutput(relayerFee); // Simulate Relayer fee output.
    const unshieldNote = new UnshieldNoteERC20(
      RailgunVersionedSmartContracts.getRelayAdaptContract(txidVersion, chain).address,
      10000n,
      WETH_TOKEN_ADDRESS,
    );
    transactionBatch.addUnshieldData(unshieldNote.unshieldData);

    // 2. Create the cross contract call.
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

    // 3. Create dummy transactions from batch.
    const dummyTransactions = await transactionBatch.generateDummyTransactions(
      engine.prover,
      wallet,
      txidVersion,
      testEncryptionKey,
      crossContractCalls,
    );

    // 4. Populate dummy execute transaction for gas estimate
    const populatedTransactionGasEstimate = await RailgunVersionedSmartContracts.generateTransact(
      txidVersion,
      chain,
      dummyTransactions,
    );
    populatedTransactionGasEstimate.from = DEAD_ADDRESS;
    await expect(
      RailgunVersionedSmartContracts.estimateGasWithErrorHandler(
        txidVersion,
        provider,
        populatedTransactionGasEstimate,
      ),
      txidVersion,
    ).to.be.rejectedWith(
      `RelayAdapt multicall failed at index 0 with 'execution reverted (unknown custom error)': Unknown Relay Adapt error.`,
    );

    const relayAdaptV3Calldata = RailgunVersionedSmartContracts.getRelayAdaptV3Calldata(
      txidVersion,
      chain,
      crossContractCalls,
    );

    // 5. Create real transactions with relay adapt params.
    const { provedTransactions } = await transactionBatch.generateTransactions(
      engine.prover,
      wallet,
      txidVersion,
      testEncryptionKey,
      () => {},
      false, // shouldGeneratePreTransactionPOIs
      crossContractCalls,
    );
    provedTransactions.forEach((transaction) => {
      expect((transaction as TransactionStructV3).boundParams.global.to).to.equal(
        RailgunVersionedSmartContracts.getRelayAdaptContract(txidVersion, chain).address,
      );
      expect((transaction as TransactionStructV3).boundParams.global.data).to.equal(
        relayAdaptV3Calldata,
      );
    });

    // 7. Generate real relay transaction for cross contract call.
    const populatedTransaction = await RailgunVersionedSmartContracts.generateTransact(
      txidVersion,
      chain,
      provedTransactions,
    );

    const gasEstimateFinal = await provider.estimateGas(populatedTransaction);

    // Set gas limit to this value, which should revert inside the smart contract.
    populatedTransaction.gasLimit = (gasEstimateFinal * 101n) / 100n;

    // 8. Send transaction.
    const txResponse = await sendTransactionWithLatestNonce(ethersWallet, populatedTransaction);

    // Perform scans: Unshield and Shield
    const scansAwaiter = awaitMultipleScans(wallet, chain, 3);

    const [txReceipt] = await Promise.all([
      txResponse.wait(),
      awaitRailgunSmartWalletTransact(txidVersion, chain),
    ]);
    if (txReceipt == null) {
      throw new Error('No transaction receipt for relay transaction');
    }

    await expect(scansAwaiter).to.be.fulfilled;
    await wallet.refreshPOIsForTXIDVersion(chain, txidVersion, true);

    // Dead address should have 0 WETH.
    const sendAddressBalance: bigint = await wethTokenContract.balanceOf(sendToAddress);
    expect(sendAddressBalance).to.equal(0n);

    const relayAdaptAddressBalance: bigint = await wethTokenContract.balanceOf(
      RailgunVersionedSmartContracts.getRelayAdaptContract(txidVersion, chain).address,
    );
    expect(relayAdaptAddressBalance).to.equal(0n);

    const callResultError = RailgunVersionedSmartContracts.getRelayAdaptCallError(
      txidVersion,
      txReceipt.logs,
    );
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

    const proxyWethBalance = await wethTokenContract.balanceOf(
      RailgunVersionedSmartContracts.getShieldApprovalContract(txidVersion, chain).address,
    );
    const privateWalletBalance = await wallet.getBalanceERC20(
      txidVersion,
      chain,
      WETH_TOKEN_ADDRESS,
      [WalletBalanceBucket.Spendable],
    );

    expect(proxyWethBalance).to.equal(expectedProxyBalance);
    expect(privateWalletBalance).to.equal(expectedWalletBalance);
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

  it('[V3] Should get relay adapt V3 calldata', async function run() {
    if (isV2Test()) {
      this.skip();
      return;
    }

    const relayAdaptV3Calldata = PoseidonMerkleAdaptV3Contract.getRelayAdaptV3Calldata([
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
    ]);

    expect(relayAdaptV3Calldata).to.equal(
      '0x0000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000000200000000000000000000000008f86403a4de0bb5791fa46b8e795c547942fe4cf000000000000000000000000000000000000000000000000000000000000006000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000064d28c25d400000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000002686900000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
    );
  });

  it('[V3] Should decode and parse relay adapt error logs', async function run() {
    if (isV2Test()) {
      this.skip();
      return;
    }

    // TODO-V3: Add test for V3.
    expect(true).to.equal(false, 'TODO-V3: Add test for V3 (See V2 implementation and tests)');
  });

  it('[V3] Should extract call failed index and error message from ethers error', async function run() {
    if (isV2Test()) {
      this.skip();
      return;
    }

    // TODO-V3: Add test for V3.
    expect(true).to.equal(false, 'TODO-V3: Add test for V3 (See V2 implementation and tests)');
  });

  it('[V3] Should parse relay adapt log revert data - relay adapt abi value', async function run() {
    if (isV2Test()) {
      this.skip();
      return;
    }

    // TODO-V3: Add test for V3.
    expect(true).to.equal(false, 'TODO-V3: Add test for V3 (See V2 implementation and tests)');
  });

  it('[V3] Should parse relay adapt log revert data - string value', async function run() {
    if (isV2Test()) {
      this.skip();
      return;
    }

    // TODO-V3: Add test for V3.
    expect(true).to.equal(false, 'TODO-V3: Add test for V3 (See V2 implementation and tests)');
  });

  afterEach(async () => {
    if (!isDefined(process.env.RUN_HARDHAT_TESTS)) {
      return;
    }
    await engine.unload();
    await provider.send('evm_revert', [snapshot]);
  });
});
