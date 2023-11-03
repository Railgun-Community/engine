/// <reference types="../../../../types/global" />
import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { Contract, JsonRpcProvider, TransactionReceipt, Wallet } from 'ethers';
import memdown from 'memdown';
import { groth16 } from 'snarkjs';
import { abi as erc20Abi } from '../../../../test/test-erc20-abi.test';
import { abi as erc721Abi } from '../../../../test/test-erc721-abi.test';
import { config } from '../../../../test/config.test';
import { RailgunWallet } from '../../../../wallet/railgun-wallet';
import {
  ByteLength,
  formatToByteLength,
  hexlify,
  hexToBytes,
  randomHex,
} from '../../../../utils/bytes';
import {
  awaitMultipleScans,
  awaitRailgunSmartWalletShield,
  awaitRailgunSmartWalletTransact,
  awaitScan,
  DECIMALS_18,
  getEthersWallet,
  getTestTXIDVersion,
  isV2Test,
  mockGetLatestValidatedRailgunTxid,
  mockQuickSyncEvents,
  mockQuickSyncRailgunTransactionsV2,
  mockRailgunTxidMerklerootValidator,
  sendTransactionWithLatestNonce,
  testArtifactsGetter,
} from '../../../../test/helper.test';
import {
  CommitmentType,
  NFTTokenData,
  Nullifier,
  OutputType,
  RailgunTransactionV3,
  RailgunTransactionVersion,
  TokenType,
  TransactCommitmentV2,
  TransactCommitmentV3,
} from '../../../../models/formatted-types';
import {
  CommitmentEvent,
  EngineEvent,
  MerkletreeHistoryScanEventData,
  MerkletreeScanStatus,
  UnshieldStoredEvent,
} from '../../../../models/event-types';
import { Memo } from '../../../../note/memo';
import { ViewOnlyWallet } from '../../../../wallet/view-only-wallet';
import { SnarkJSGroth16 } from '../../../../prover/prover';
import { promiseTimeout } from '../../../../utils/promises';
import { Chain, ChainType } from '../../../../models/engine-types';
import { RailgunEngine } from '../../../../railgun-engine';
import { RailgunSmartWalletContract } from '../railgun-smart-wallet';
import { MEMO_SENDER_RANDOM_NULL } from '../../../../models/transaction-constants';
import { TransactNote } from '../../../../note/transact-note';
import { ShieldNoteERC20 } from '../../../../note/erc20/shield-note-erc20';
import {
  GAS_ESTIMATE_VARIANCE_DUMMY_TO_ACTUAL_TRANSACTION,
  TransactionBatch,
} from '../../../../transaction/transaction-batch';
import { getTokenDataERC20 } from '../../../../note/note-util';
import { TokenDataGetter } from '../../../../token/token-data-getter';
import { mintNFTsID01ForTest, shieldNFTForTest } from '../../../../test/shared-test.test';
import { TestERC20 } from '../../../../test/abi/typechain/TestERC20';
import { TestERC721 } from '../../../../test/abi/typechain/TestERC721';
import { TransactionHistoryReceiveTokenAmount } from '../../../../models/wallet-types';
import { ShieldRequestStruct } from '../../../../abi/typechain/RailgunSmartWallet';
import { PollingJsonRpcProvider } from '../../../../provider/polling-json-rpc-provider';
import { createPollingJsonRpcProviderForListeners } from '../../../../provider/polling-util';
import { isDefined } from '../../../../utils/is-defined';
import { TXIDVersion } from '../../../../models/poi-types';
import { WalletBalanceBucket } from '../../../../models/txo-types';
import { RailgunVersionedSmartContracts } from '../../railgun-versioned-smart-contracts';
import { POIValidation } from '../../../../validation/poi-validation';

chai.use(chaiAsPromised);
const { expect } = chai;

const txidVersion = getTestTXIDVersion();

let provider: PollingJsonRpcProvider;
let chain: Chain;
let engine: RailgunEngine;
let ethersWallet: Wallet;
let snapshot: number;
let token: TestERC20;
let nft: TestERC721;
let wallet: RailgunWallet;
let wallet2: RailgunWallet;
let viewOnlyWallet: ViewOnlyWallet;

const testMnemonic = config.mnemonic;
const testEncryptionKey = config.encryptionKey;

const TOKEN_ADDRESS = config.contracts.rail;
const NFT_ADDRESS = config.contracts.testERC721;
const RANDOM = randomHex(16);
const VALUE = BigInt(10000) * DECIMALS_18;

let testShield: (value?: bigint) => Promise<TransactionReceipt | null>;

describe('railgun-smart-wallet', function runTests() {
  this.timeout(20000);

  beforeEach(async () => {
    engine = RailgunEngine.initForWallet(
      'Test RSW',
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

    if (!isDefined(process.env.RUN_HARDHAT_TESTS)) {
      return;
    }

    provider = new PollingJsonRpcProvider(config.rpc, config.chainId, 100);
    chain = {
      type: ChainType.EVM,
      id: Number((await provider.getNetwork()).chainId),
    };
    const pollingProvider = await createPollingJsonRpcProviderForListeners(provider, chain.id);
    await engine.loadNetwork(
      chain,
      config.contracts.proxy,
      config.contracts.relayAdapt,
      config.contracts.poseidonMerkleAccumulatorV3,
      config.contracts.poseidonMerkleVerifierV3,
      config.contracts.tokenVaultV3,
      provider,
      pollingProvider,
      { [TXIDVersion.V2_PoseidonMerkle]: 0, [TXIDVersion.V3_PoseidonMerkle]: 0 },
      0,
      !isV2Test(), // supportsV3
    );
    await engine.scanHistory(chain);

    ethersWallet = getEthersWallet(config.mnemonic, provider);
    snapshot = (await provider.send('evm_snapshot', [])) as number;

    token = new Contract(TOKEN_ADDRESS, erc20Abi, ethersWallet) as unknown as TestERC20;
    const balance = await token.balanceOf(ethersWallet.address);
    await token.approve(
      RailgunVersionedSmartContracts.getShieldApprovalContract(txidVersion, chain).address,
      balance,
    );

    nft = new Contract(NFT_ADDRESS, erc721Abi, ethersWallet) as unknown as TestERC721;

    wallet = await engine.createWalletFromMnemonic(testEncryptionKey, testMnemonic, 0);
    wallet2 = await engine.createWalletFromMnemonic(testEncryptionKey, testMnemonic, 1);
    viewOnlyWallet = await engine.createViewOnlyWalletFromShareableViewingKey(
      testEncryptionKey,
      wallet.generateShareableViewingKey(),
      undefined, // creationBlockNumbers
    );

    // fn to create shield tx for tests
    // tx should be complete and balances updated after await
    testShield = async (
      value: bigint = BigInt(110000) * DECIMALS_18,
    ): Promise<TransactionReceipt | null> => {
      // Create shield
      const shield = new ShieldNoteERC20(wallet.masterPublicKey, RANDOM, value, TOKEN_ADDRESS);
      const shieldPrivateKey = hexToBytes(randomHex(32));
      const shieldInput = await shield.serialize(
        shieldPrivateKey,
        wallet.getViewingKeyPair().pubkey,
      );

      const shieldTx = await RailgunVersionedSmartContracts.generateShield(txidVersion, chain, [
        shieldInput,
      ]);

      // Send shield on chain
      const tx = await sendTransactionWithLatestNonce(ethersWallet, shieldTx);
      const txReceipt = (await Promise.all([tx.wait(), awaitScan(wallet, chain)]))[0];
      await wallet.refreshPOIsForTXIDVersion(chain, txidVersion, true);
      return txReceipt;
    };
  });

  it('Should fail to instantiate without a polling provider', () => {
    const nonPollingProvider = new JsonRpcProvider(config.rpc);
    expect(() => {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-explicit-any
      return new RailgunSmartWalletContract(
        'abc',
        nonPollingProvider as any,
        nonPollingProvider as any,
        chain,
      );
    }).to.throw(
      'The JsonRpcProvider must have polling enabled. Use PollingJsonRpcProvider to instantiate.',
    );
  });

  it('[HH] Should retrieve merkle root from contract', async function run() {
    if (!isDefined(process.env.RUN_HARDHAT_TESTS)) {
      this.skip();
      return;
    }

    expect(
      await RailgunVersionedSmartContracts.getAccumulator(txidVersion, chain).merkleRoot(),
    ).to.equal('14fceeac99eb8419a2796d1958fc2050d489bf5a3eb170ef16a667060344ba90');
  });

  it('[HH] Should check gas estimates for dummy transactions and full transactions', async function run() {
    if (!isDefined(process.env.RUN_HARDHAT_TESTS)) {
      this.skip();
      return;
    }

    // Token for relayer fee
    await testShield();
    const tokenData = getTokenDataERC20(TOKEN_ADDRESS);

    // Mint NFTs with tokenIDs 0 and 1 into public balance.
    await mintNFTsID01ForTest(nft, ethersWallet);

    // Approve NFT for shield.
    const approval = await nft.approve.populateTransaction(
      RailgunVersionedSmartContracts.getShieldApprovalContract(txidVersion, chain).address,
      1,
    );
    const approvalTxResponse = await sendTransactionWithLatestNonce(ethersWallet, approval);
    await approvalTxResponse.wait();

    const shield = await shieldNFTForTest(
      txidVersion,
      wallet,
      ethersWallet,
      chain,
      RANDOM,
      NFT_ADDRESS,
      BigInt(1).toString(),
    );

    const nullRelayerFeeOutput = TransactNote.createTransfer(
      wallet2.addressKeys,
      wallet.addressKeys,
      0n,
      tokenData,
      false, // showSenderAddressToRecipient
      OutputType.Transfer,
      undefined, // memoText
    );
    const actualRelayerFeeOutput = TransactNote.createTransfer(
      wallet2.addressKeys,
      wallet.addressKeys,
      300n,
      tokenData,
      false, // showSenderAddressToRecipient
      OutputType.Transfer,
      undefined, // memoText
    );
    const nftTransferOutput = TransactNote.createERC721Transfer(
      wallet2.addressKeys,
      wallet.addressKeys,
      shield.tokenData as NFTTokenData,
      false, // showSenderAddressToRecipient
      undefined, // memoText
    );

    // Submit actual transaction so the tree has a spent note/nullifier at position 0.
    const initialTransactionBatch = new TransactionBatch(chain);
    initialTransactionBatch.addOutput(actualRelayerFeeOutput);
    const { provedTransactions: txs_initial, preTransactionPOIsPerTxidLeafPerList } =
      await initialTransactionBatch.generateTransactions(
        engine.prover,
        wallet,
        txidVersion,
        testEncryptionKey,
        () => {},
        true, // shouldGeneratePreTransactionPOIs
      );
    const tx_initial = await RailgunVersionedSmartContracts.generateTransact(
      txidVersion,
      chain,
      txs_initial,
    );

    const isValidPOI = await POIValidation.isValidSpendableTransaction(
      txidVersion,
      chain,
      engine.prover,
      tx_initial,
      false, // useRelayAdapt
      isV2Test() ? config.contracts.proxy : config.contracts.poseidonMerkleVerifierV3,
      preTransactionPOIsPerTxidLeafPerList,
      wallet2.viewingKeyPair.privateKey,
      wallet2.addressKeys,
      new TokenDataGetter(engine.db),
    );
    expect(isValidPOI.isValid).to.equal(true, isValidPOI.error);

    const txTransact = await sendTransactionWithLatestNonce(ethersWallet, tx_initial);
    await Promise.all([txTransact.wait()]);

    if (isV2Test()) {
      await Promise.all([
        promiseTimeout(awaitMultipleScans(wallet, chain, 2), 15000, 'Timed out wallet1 scan'),
      ]);
    } else {
      await Promise.all([
        promiseTimeout(awaitScan(wallet, chain), 15000, 'Timed out wallet1 scan'),
      ]);
    }

    await wallet.refreshPOIsForTXIDVersion(chain, txidVersion, true);

    // Case 1 - Dummy estimate with Null Relayer Fee
    const transactionBatch_DummyNullRelayerFee = new TransactionBatch(chain);
    transactionBatch_DummyNullRelayerFee.addOutput(nullRelayerFeeOutput);
    transactionBatch_DummyNullRelayerFee.addOutput(nftTransferOutput);
    const txs_DummyNullRelayerFee =
      await transactionBatch_DummyNullRelayerFee.generateDummyTransactions(
        engine.prover,
        wallet,
        txidVersion,
        testEncryptionKey,
      );
    expect(txs_DummyNullRelayerFee.length).to.equal(2);
    expect(txs_DummyNullRelayerFee.map((tx) => tx.nullifiers.length)).to.deep.equal([1, 1]);
    expect(txs_DummyNullRelayerFee.map((tx) => tx.commitments.length)).to.deep.equal([1, 1]);
    expect(txs_DummyNullRelayerFee.map((tx) => tx.proof)).to.deep.equal([
      {
        a: { x: 0n, y: 0n },
        b: { x: [0n, 0n], y: [0n, 0n] },
        c: { x: 0n, y: 0n },
      },
      {
        a: { x: 0n, y: 0n },
        b: { x: [0n, 0n], y: [0n, 0n] },
        c: { x: 0n, y: 0n },
      },
    ]);
    const tx_DummyNullRelayerFee = await RailgunVersionedSmartContracts.generateTransact(
      txidVersion,
      chain,
      txs_DummyNullRelayerFee,
    );
    tx_DummyNullRelayerFee.from = '0x000000000000000000000000000000000000dEaD';
    const gasEstimate_DummyNullRelayerFee = await provider.estimateGas(tx_DummyNullRelayerFee);

    // This should be around 1.32M gas.
    // This will vary slightly based on small changes to the contract.
    expect(Number(gasEstimate_DummyNullRelayerFee)).to.be.greaterThan(
      isV2Test() ? 1_290_000 : 1_330_000,
    );
    expect(Number(gasEstimate_DummyNullRelayerFee)).to.be.lessThan(
      isV2Test() ? 1_330_000 : 1_350_000,
    );

    // Case 2 - Dummy estimate with Actual Relayer Fee
    const transactionBatch_DummyActualRelayerFee = new TransactionBatch(chain);
    transactionBatch_DummyActualRelayerFee.addOutput(actualRelayerFeeOutput);
    transactionBatch_DummyActualRelayerFee.addOutput(nftTransferOutput);
    const txs_DummyActualRelayerFee =
      await transactionBatch_DummyActualRelayerFee.generateDummyTransactions(
        engine.prover,
        wallet,
        txidVersion,
        testEncryptionKey,
      );
    expect(txs_DummyActualRelayerFee.length).to.equal(2);
    expect(txs_DummyActualRelayerFee.map((tx) => tx.nullifiers.length)).to.deep.equal([1, 1]);
    expect(txs_DummyActualRelayerFee.map((tx) => tx.commitments.length)).to.deep.equal([2, 1]); // 2 commitments for Relayer Fee - one is change.
    expect(txs_DummyActualRelayerFee.map((tx) => tx.proof)).to.deep.equal([
      {
        a: { x: 0n, y: 0n },
        b: { x: [0n, 0n], y: [0n, 0n] },
        c: { x: 0n, y: 0n },
      },
      {
        a: { x: 0n, y: 0n },
        b: { x: [0n, 0n], y: [0n, 0n] },
        c: { x: 0n, y: 0n },
      },
    ]);
    const tx_DummyActualRelayerFee = await RailgunVersionedSmartContracts.generateTransact(
      txidVersion,
      chain,
      txs_DummyActualRelayerFee,
    );
    tx_DummyActualRelayerFee.from = '0x000000000000000000000000000000000000dEaD';
    const gasEstimate_DummyActualRelayerFee = await provider.estimateGas(tx_DummyActualRelayerFee);
    // This should be around 1.39M (1.44M V3) gas.
    // This will vary slightly based on small changes to the contract.
    expect(Number(gasEstimate_DummyActualRelayerFee)).to.be.greaterThan(
      isV2Test() ? 1_370_000 : 1_400_000,
    );
    expect(Number(gasEstimate_DummyActualRelayerFee)).to.be.lessThan(
      isV2Test() ? 1_420_000 : 1_500_000,
    );

    // Case 3 - Actual transaction
    const transactionBatch_ActualTransaction = new TransactionBatch(chain);
    transactionBatch_ActualTransaction.addOutput(actualRelayerFeeOutput);
    transactionBatch_ActualTransaction.addOutput(nftTransferOutput);
    const { provedTransactions: txs_ActualTransaction } =
      await transactionBatch_ActualTransaction.generateTransactions(
        engine.prover,
        wallet,
        txidVersion,
        testEncryptionKey,
        () => {},
        false, // shouldGeneratePreTransactionPOIs
      );
    expect(txs_ActualTransaction.length).to.equal(2);
    expect(txs_ActualTransaction.map((tx) => tx.nullifiers.length)).to.deep.equal([1, 1]);
    expect(txs_ActualTransaction.map((tx) => tx.commitments.length)).to.deep.equal([2, 1]);
    expect(txs_ActualTransaction.map((tx) => tx.proof)).to.not.deep.equal([
      {
        a: { x: 0n, y: 0n },
        b: { x: [0n, 0n], y: [0n, 0n] },
        c: { x: 0n, y: 0n },
      },
      {
        a: { x: 0n, y: 0n },
        b: { x: [0n, 0n], y: [0n, 0n] },
        c: { x: 0n, y: 0n },
      },
    ]);
    const tx_ActualTransaction = await RailgunVersionedSmartContracts.generateTransact(
      txidVersion,
      chain,
      txs_ActualTransaction,
    );
    tx_ActualTransaction.from = ethersWallet.address;
    const gasEstimate_ActualTransaction = await provider.estimateGas(tx_ActualTransaction);
    // This should be around 1.42M gas. (1.45M for V3)
    // This will vary slightly based on small changes to the contract.
    expect(Number(gasEstimate_ActualTransaction)).to.be.greaterThan(
      isV2Test() ? 1_410_000 : 1_440_000,
    );
    expect(Number(gasEstimate_ActualTransaction)).to.be.lessThan(
      isV2Test() ? 1_430_000 : 1_550_000,
    );

    // Should be very similar to dummy transaction with actual relayer fee.
    // Variance expected at ~7500 additional gas for actual transaction. (we've seen 7121, also tested at 7146 and 7194 with multi-circuit in the field)
    expect(
      Number(gasEstimate_ActualTransaction - gasEstimate_DummyActualRelayerFee),
    ).to.be.lessThan(
      // 9000
      GAS_ESTIMATE_VARIANCE_DUMMY_TO_ACTUAL_TRANSACTION,
    );
    expect(
      Number(gasEstimate_ActualTransaction - gasEstimate_DummyActualRelayerFee),
    ).to.be.greaterThan(isV2Test() ? 7000 : 8300);
    expect(
      Number(gasEstimate_ActualTransaction - gasEstimate_DummyActualRelayerFee),
    ).to.be.lessThan(isV2Test() ? 7300 : 8700);
  }).timeout(120000);

  it('[HH] Should return valid merkle roots', async function run() {
    if (!isDefined(process.env.RUN_HARDHAT_TESTS)) {
      this.skip();
      return;
    }
    expect(
      await RailgunVersionedSmartContracts.getAccumulator(txidVersion, chain).validateMerkleroot(
        0,
        '0x14fceeac99eb8419a2796d1958fc2050d489bf5a3eb170ef16a667060344ba90',
      ),
    ).to.equal(true);
    expect(
      await RailgunVersionedSmartContracts.getAccumulator(txidVersion, chain).validateMerkleroot(
        0,
        '0x09981e69d3ecf345fb3e2e48243889aa4ff906423d6a686005cac572a3a9632d',
      ),
    ).to.equal(false);
  });

  it('[HH] Should return fees', async function run() {
    if (!isDefined(process.env.RUN_HARDHAT_TESTS)) {
      this.skip();
      return;
    }
    const fees = await RailgunVersionedSmartContracts.fees(txidVersion, chain);
    expect(fees).to.be.an('object');
    expect(fees.shield).to.be.a('bigint');
    expect(fees.unshield).to.be.a('bigint');
  });

  it('[HH] Should find shield, transact and unshield as historical events', async function run() {
    if (!isDefined(process.env.RUN_HARDHAT_TESTS)) {
      this.skip();
      return;
    }

    let resultEvent!: Optional<CommitmentEvent>;
    const eventsListener = async (
      _txidVersion: TXIDVersion,
      commitmentEvents: CommitmentEvent[],
    ) => {
      // eslint-disable-next-line prefer-destructuring
      resultEvent = commitmentEvents[0];
    };
    let resultNullifiers: Nullifier[] = [];
    const nullifiersListener = async (_txidVersion: TXIDVersion, nullifiers: Nullifier[]) => {
      resultNullifiers.push(...nullifiers);
    };
    let resultUnshields: UnshieldStoredEvent[] = [];
    const unshieldListener = async (
      _txidVersion: TXIDVersion,
      unshields: UnshieldStoredEvent[],
    ) => {
      resultUnshields.push(...unshields);
    };
    // eslint-disable-next-line prefer-const
    let resultRailgunTransactionsV3: RailgunTransactionV3[] = [];
    const railgunTransactionsV3Listener = async (
      _txidVersion: TXIDVersion,
      railgunTransactions: RailgunTransactionV3[],
    ) => {
      resultRailgunTransactionsV3.push(...railgunTransactions);
    };

    let startingBlock = await provider.getBlockNumber();

    // Add a secondary listener.
    await RailgunVersionedSmartContracts.setTreeUpdateListeners(
      txidVersion,
      chain,
      eventsListener,
      nullifiersListener,
      unshieldListener,
      railgunTransactionsV3Listener,
      async () => {},
    );

    // Subscribe to Nullified event
    const resultNullifiers2: Nullifier[] = [];
    const nullifiersListener2 = (nullifiers: Nullifier[]) => {
      resultNullifiers2.push(...nullifiers);
    };
    RailgunVersionedSmartContracts.getAccumulator(txidVersion, chain).on(
      EngineEvent.ContractNullifierReceived,
      nullifiersListener2,
    );

    const txResponse = await testShield();
    if (txResponse == null) {
      throw new Error('No shield transaction response');
    }

    // Listeners should have been updated automatically by contract events.

    expect(resultEvent).to.be.an('object', 'No event in history for shield');
    expect((resultEvent as CommitmentEvent).txid).to.equal(hexlify(txResponse.hash));
    expect(resultNullifiers.length).to.equal(0);
    expect(resultRailgunTransactionsV3.length).to.equal(0);

    resultEvent = undefined;
    resultNullifiers = [];
    resultUnshields = [];

    let latestBlock = await provider.getBlockNumber();

    await RailgunVersionedSmartContracts.getHistoricalEvents(
      txidVersion,
      chain,
      startingBlock,
      latestBlock,
      () => engine.getNextStartingBlockSlowScan(txidVersion, chain),
      eventsListener,
      nullifiersListener,
      unshieldListener,
      railgunTransactionsV3Listener,
      async () => {},
    );

    // Listeners should have been updated by historical event scan.

    expect(resultEvent).to.be.an('object', 'No event in history for shield');
    expect((resultEvent as unknown as CommitmentEvent).txid).to.equal(hexlify(txResponse.hash));
    expect(resultNullifiers.length).to.equal(0);
    expect(resultUnshields.length).to.equal(0);
    expect(resultRailgunTransactionsV3.length).to.equal(0);

    startingBlock = await provider.getBlockNumber();

    const transactionBatch = new TransactionBatch(chain);

    const tokenData = getTokenDataERC20(TOKEN_ADDRESS);

    transactionBatch.addOutput(
      TransactNote.createTransfer(
        wallet2.addressKeys,
        wallet.addressKeys,
        300n,
        tokenData,
        false, // showSenderAddressToRecipient
        OutputType.RelayerFee,
        undefined, // memoText
      ),
    );
    transactionBatch.addUnshieldData({
      toAddress: ethersWallet.address,
      value: 100n,
      tokenData,
    });
    const { provedTransactions: serializedTxs, preTransactionPOIsPerTxidLeafPerList } =
      await transactionBatch.generateTransactions(
        engine.prover,
        wallet,
        txidVersion,
        testEncryptionKey,
        () => {},
        false, // shouldGeneratePreTransactionPOIs
      );
    const transact = await RailgunVersionedSmartContracts.generateTransact(
      txidVersion,
      chain,
      serializedTxs,
    );

    const isValidPOI = await POIValidation.isValidSpendableTransaction(
      txidVersion,
      chain,
      engine.prover,
      transact,
      false, // useRelayAdapt
      isV2Test() ? config.contracts.proxy : config.contracts.poseidonMerkleVerifierV3,
      preTransactionPOIsPerTxidLeafPerList,
      wallet2.viewingKeyPair.privateKey,
      wallet2.addressKeys,
      new TokenDataGetter(engine.db),
    );
    expect(isValidPOI.isValid).to.equal(true, isValidPOI.error);

    // Send transact on chain
    const txTransact = await sendTransactionWithLatestNonce(ethersWallet, transact);
    const txResponseTransact = await txTransact.wait();

    if (isV2Test()) {
      await Promise.all([
        promiseTimeout(awaitMultipleScans(wallet, chain, 2), 15000, 'Timed out wallet1 scan'),
        promiseTimeout(awaitMultipleScans(wallet2, chain, 2), 15000, 'Timed out wallet2 scan'),
      ]);
    } else {
      await Promise.all([
        promiseTimeout(awaitScan(wallet, chain), 15000, 'Timed out wallet1 scan'),
        promiseTimeout(awaitScan(wallet2, chain), 15000, 'Timed out wallet2 scan'),
      ]);
    }

    await wallet.refreshPOIsForTXIDVersion(chain, txidVersion, true);
    await viewOnlyWallet.refreshPOIsForAllTXIDVersions(chain);

    expect(
      await wallet.getBalanceERC20(txidVersion, chain, TOKEN_ADDRESS, [
        WalletBalanceBucket.Spendable,
      ]),
    ).equal(109724999999999999999600n);
    expect(
      await viewOnlyWallet.getBalanceERC20(txidVersion, chain, TOKEN_ADDRESS, [
        WalletBalanceBucket.Spendable,
      ]),
    ).equal(109724999999999999999600n);

    // Event should have been scanned by automatic contract events:

    if (txResponseTransact == null) {
      throw new Error('No transact transaction response');
    }
    const txid = hexlify(txResponseTransact.hash);
    expect((resultEvent as unknown as CommitmentEvent).txid).to.equal(txid);
    expect(resultNullifiers[0].txid).to.equal(txid);
    expect(resultNullifiers2[0].txid).to.equal(txid);
    expect(resultUnshields.length).to.equal(1);
    expect(resultUnshields[0].txid).to.equal(txid);

    switch (txidVersion) {
      case TXIDVersion.V2_PoseidonMerkle:
        expect(resultRailgunTransactionsV3.length).to.equal(0);
        break;
      case TXIDVersion.V3_PoseidonMerkle:
        expect(resultRailgunTransactionsV3.length).to.equal(1);
        expect(resultRailgunTransactionsV3[0].commitments.length).to.equal(3);
        expect(resultRailgunTransactionsV3[0].boundParamsHash).to.be.a('string');
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-expect-error
        delete resultRailgunTransactionsV3[0].boundParamsHash;
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-expect-error
        delete resultRailgunTransactionsV3[0].commitments;
        expect(resultRailgunTransactionsV3).to.deep.equal([
          {
            version: RailgunTransactionVersion.V3,
            txid,
            blockNumber: txResponseTransact.blockNumber,
            nullifiers: ['0x05802951a46d9e999151eb0eb9e4c7c1260b7ee88539011c207dc169c4dd17ee'],
            unshield: {
              toAddress: '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266',
              tokenData,
              value: '100',
            },
            utxoTreeIn: 0,
            utxoTreeOut: 0,
            utxoBatchStartPositionOut: 1,
          },
        ]);
        break;
    }

    resultEvent = undefined;
    resultNullifiers = [];
    resultRailgunTransactionsV3 = [];

    latestBlock = await provider.getBlockNumber();

    await RailgunVersionedSmartContracts.getHistoricalEvents(
      txidVersion,
      chain,
      startingBlock,
      latestBlock,
      () => engine.getNextStartingBlockSlowScan(txidVersion, chain),
      eventsListener,
      nullifiersListener,
      unshieldListener,
      railgunTransactionsV3Listener,
      async () => {},
    );

    // Event should have been scanned by historical event scan.

    expect((resultEvent as unknown as CommitmentEvent).txid).to.equal(txid);
    expect((resultEvent as unknown as CommitmentEvent).commitments[0].commitmentType).to.equal(
      isV2Test() ? CommitmentType.TransactCommitmentV2 : CommitmentType.TransactCommitmentV3,
    );
    expect(resultNullifiers.length).to.equal(1);

    switch (txidVersion) {
      case TXIDVersion.V2_PoseidonMerkle:
        expect(resultRailgunTransactionsV3.length).to.equal(0);
        break;
      case TXIDVersion.V3_PoseidonMerkle:
        expect(resultRailgunTransactionsV3.length).to.equal(1);
        expect(resultRailgunTransactionsV3[0].commitments.length).to.equal(3);
        expect(resultRailgunTransactionsV3[0].boundParamsHash).to.be.a('string');
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-expect-error
        delete resultRailgunTransactionsV3[0].boundParamsHash;
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-expect-error
        delete resultRailgunTransactionsV3[0].commitments;
        expect(resultRailgunTransactionsV3).to.deep.equal([
          {
            version: RailgunTransactionVersion.V3,
            txid,
            blockNumber: txResponseTransact.blockNumber,
            nullifiers: ['0x05802951a46d9e999151eb0eb9e4c7c1260b7ee88539011c207dc169c4dd17ee'],
            unshield: {
              toAddress: '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266',
              tokenData,
              value: '100',
            },
            utxoTreeIn: 0,
            utxoTreeOut: 0,
            utxoBatchStartPositionOut: 1,
          },
        ]);
        break;
    }
  }).timeout(120000);

  it('[HH] Should create 11 shields which generates 2 unshield events', async function run() {
    if (!isDefined(process.env.RUN_HARDHAT_TESTS)) {
      this.skip();
      return;
    }

    const startingBlock = await provider.getBlockNumber();

    const shieldInputs: ShieldRequestStruct[] = [];
    for (let i = 0; i < 11; i += 1) {
      const shield = new ShieldNoteERC20(wallet.masterPublicKey, RANDOM, 100000000n, TOKEN_ADDRESS);
      const shieldPrivateKey = hexToBytes(randomHex(32));
      shieldInputs.push(
        // eslint-disable-next-line no-await-in-loop
        await shield.serialize(shieldPrivateKey, wallet.getViewingKeyPair().pubkey),
      );
    }
    const shieldTx = await RailgunVersionedSmartContracts.generateShield(
      txidVersion,
      chain,
      shieldInputs,
    );

    // Send shield on chain
    const tx = await sendTransactionWithLatestNonce(ethersWallet, shieldTx);
    await Promise.all([tx.wait(), awaitScan(wallet, chain)]);
    await wallet.refreshPOIsForTXIDVersion(chain, txidVersion, true);

    const transactionBatch = new TransactionBatch(chain);

    const tokenData = getTokenDataERC20(TOKEN_ADDRESS);

    transactionBatch.addUnshieldData({
      toAddress: ethersWallet.address,
      value: 1097250000n, // 11 * 100000000 * 0.9975
      tokenData,
    });
    const { provedTransactions: serializedTxs } = await transactionBatch.generateTransactions(
      engine.prover,
      wallet,
      txidVersion,
      testEncryptionKey,
      () => {},
      false, // shouldGeneratePreTransactionPOIs
    );
    const transact = await RailgunVersionedSmartContracts.generateTransact(
      txidVersion,
      chain,
      serializedTxs,
    );

    // Send transact on chain
    const txTransact = await sendTransactionWithLatestNonce(ethersWallet, transact);
    await Promise.all([txTransact.wait()]);

    if (isV2Test()) {
      await Promise.all([
        promiseTimeout(awaitMultipleScans(wallet, chain, 2), 15000, 'Timed out wallet1 scan'),
      ]);
    } else {
      await Promise.all([
        promiseTimeout(awaitScan(wallet, chain), 15000, 'Timed out wallet1 scan'),
      ]);
    }

    await wallet.refreshPOIsForTXIDVersion(chain, txidVersion, true);

    expect(
      await wallet.getBalanceERC20(txidVersion, chain, TOKEN_ADDRESS, [
        WalletBalanceBucket.Spendable,
      ]),
    ).equal(0n);

    const history = await wallet.getTransactionHistory(chain, startingBlock);

    const tokenFormatted = formatToByteLength(TOKEN_ADDRESS, ByteLength.UINT_256, false);

    expect(history.length).to.equal(2);

    const singleShieldHistory: TransactionHistoryReceiveTokenAmount = {
      tokenData: getTokenDataERC20(TOKEN_ADDRESS),
      tokenHash: tokenFormatted,
      amount: 99750000n, // 100000000 * 0.9975
      memoText: undefined,
      senderAddress: undefined,
      shieldFee: '250000', // 100000000 * 0.0025
      balanceBucket: WalletBalanceBucket.Spent,
      hasValidPOIForActiveLists: true,
    };

    // Check first output: Shield (receive only).
    expect(history[0].receiveTokenAmounts).deep.eq([
      singleShieldHistory,
      singleShieldHistory,
      singleShieldHistory,
      singleShieldHistory,
      singleShieldHistory,
      singleShieldHistory,
      singleShieldHistory,
      singleShieldHistory,
      singleShieldHistory,
      singleShieldHistory,
      singleShieldHistory, // x11
    ]);
    expect(history[0].transferTokenAmounts).deep.eq([]);
    expect(history[0].relayerFeeTokenAmount).eq(undefined);
    expect(history[0].changeTokenAmounts).deep.eq([]);
    expect(history[0].unshieldTokenAmounts).deep.eq([]);

    // Check first output: Unshield.
    expect(history[1].receiveTokenAmounts).deep.eq([]);
    expect(history[1].transferTokenAmounts).deep.eq([]);
    expect(history[1].relayerFeeTokenAmount).eq(undefined);
    expect(history[1].changeTokenAmounts).deep.eq([]);
    expect(history[1].unshieldTokenAmounts).deep.eq([
      {
        tokenData: getTokenDataERC20(TOKEN_ADDRESS),
        tokenHash: tokenFormatted,
        amount: 995006250n, // 1097250000n * 10/11 * 0.9975
        recipientAddress: isV2Test() ? ethersWallet.address : ethersWallet.address.toLowerCase(),
        memoText: undefined,
        senderAddress: undefined,
        unshieldFee: '2493750',
        // eslint-disable-next-line no-unneeded-ternary
        hasValidPOIForActiveLists: isV2Test() ? false : true,
      },
      {
        tokenData: getTokenDataERC20(TOKEN_ADDRESS),
        tokenHash: tokenFormatted,
        amount: 99500625n, // 1097250000n * 1/11 * 0.9975
        recipientAddress: isV2Test() ? ethersWallet.address : ethersWallet.address.toLowerCase(),
        memoText: undefined,
        senderAddress: undefined,
        unshieldFee: '249375', // 1097250000n * 1/11 * 0.9975
        // eslint-disable-next-line no-unneeded-ternary
        hasValidPOIForActiveLists: isV2Test() ? false : true,
      },
    ]);
  }).timeout(120000);

  it('[HH] Should scan and rescan history for events', async function run() {
    if (!isDefined(process.env.RUN_HARDHAT_TESTS)) {
      this.skip();
      return;
    }

    await testShield();

    const tree = 0;

    const utxoMerkletree = engine.getUTXOMerkletree(txidVersion, chain);

    expect(await utxoMerkletree.getTreeLength(tree)).to.equal(1);
    let historyScanCompletedForChain!: Chain;
    const historyScanListener = (data: MerkletreeHistoryScanEventData) => {
      if (data.scanStatus === MerkletreeScanStatus.Complete) {
        historyScanCompletedForChain = data.chain;
      }
    };
    engine.on(EngineEvent.UTXOMerkletreeHistoryScanUpdate, historyScanListener);
    await engine.scanHistory(chain);
    expect(historyScanCompletedForChain).to.equal(chain);
    expect(await engine.getStartScanningBlock(txidVersion, chain)).to.be.above(0);

    await engine.clearSyncedUTXOMerkletreeLeavesAllTXIDVersions(chain);
    expect(await utxoMerkletree.getTreeLength(tree)).to.equal(0);
    expect(await engine.getStartScanningBlock(txidVersion, chain)).to.equal(0);

    const forceRefresh = true;
    await wallet.refreshPOIsForAllTXIDVersions(chain, forceRefresh);
    await engine.fullRescanUTXOMerkletreesAndWallets(chain);
    expect(await utxoMerkletree.getTreeLength(tree)).to.equal(1);
  });

  // it('[HH] Should get note hashes', async function run() {
  //   if (!isDefined(process.env.RUN_HARDHAT_TESTS)) {
  //     this.skip();
  //     return;
  //   }
  //   const unshield = new UnshieldNoteERC20(ethersWallet.address, 100n, await token.getAddress());
  //   const contractHash = await railgunSmartWalletContract.hashCommitment(unshield.preImage);

  //   expect(hexlify(contractHash)).to.equal(unshield.hashHex);
  // });

  it('[HH] Should shield erc20', async function run() {
    if (!isDefined(process.env.RUN_HARDHAT_TESTS)) {
      this.skip();
      return;
    }

    let result!: CommitmentEvent;
    await RailgunVersionedSmartContracts.setTreeUpdateListeners(
      txidVersion,
      chain,
      async (_txidVersion: TXIDVersion, commitmentEvents: CommitmentEvent[]) => {
        // eslint-disable-next-line prefer-destructuring
        result = commitmentEvents[0];
      },
      async () => {},
      async () => {},
      async () => {},
      async () => {},
    );
    const merkleRootBefore = await RailgunVersionedSmartContracts.getAccumulator(
      txidVersion,
      chain,
    ).merkleRoot();

    // Create shield
    const shield = new ShieldNoteERC20(wallet.masterPublicKey, RANDOM, VALUE, TOKEN_ADDRESS);
    const shieldPrivateKey = hexToBytes(randomHex(32));
    const shieldInput = await shield.serialize(shieldPrivateKey, wallet.getViewingKeyPair().pubkey);

    const shieldTx = await RailgunVersionedSmartContracts.generateShield(txidVersion, chain, [
      shieldInput,
    ]);

    const txResponse = await sendTransactionWithLatestNonce(ethersWallet, shieldTx);
    await Promise.all([
      awaitRailgunSmartWalletShield(txidVersion, chain),
      promiseTimeout(awaitScan(wallet, chain), 5000),
      txResponse.wait(),
    ]);
    await wallet.refreshPOIsForTXIDVersion(chain, txidVersion, true);

    // Check result
    expect(result.treeNumber).to.equal(0);
    expect(result.startPosition).to.equal(0);
    expect(result.commitments.length).to.equal(1);

    const merkleRootAfterShield = await RailgunVersionedSmartContracts.getAccumulator(
      txidVersion,
      chain,
    ).merkleRoot();

    // Check merkle root changed
    expect(merkleRootAfterShield).not.to.equal(merkleRootBefore);
  }).timeout(20000);

  it('[HH] Should shield erc721', async function run() {
    if (!isDefined(process.env.RUN_HARDHAT_TESTS)) {
      this.skip();
      return;
    }

    let result!: CommitmentEvent;
    await RailgunVersionedSmartContracts.setTreeUpdateListeners(
      txidVersion,
      chain,
      async (_txidVersion: TXIDVersion, commitmentEvents: CommitmentEvent[]) => {
        // eslint-disable-next-line prefer-destructuring
        result = commitmentEvents[0];
      },
      async () => {},
      async () => {},
      async () => {},
      async () => {},
    );
    const merkleRootBefore = await RailgunVersionedSmartContracts.getAccumulator(
      txidVersion,
      chain,
    ).merkleRoot();

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
      RANDOM,
      NFT_ADDRESS,
      BigInt(1).toString(),
    );

    // Check tokenData stored in contract.
    const { tokenHash } = shield;
    const tokenDataGetter = new TokenDataGetter(engine.db);
    const onChainTokenData = await tokenDataGetter.getNFTTokenData(txidVersion, chain, tokenHash);
    expect(onChainTokenData.tokenAddress.toLowerCase()).to.equal(NFT_ADDRESS.toLowerCase());
    expect(onChainTokenData.tokenSubID).to.equal(
      formatToByteLength('01', ByteLength.UINT_256, true),
    );
    expect(onChainTokenData.tokenType).to.equal(TokenType.ERC721);

    // Check that NFT Token Data Cache has data for this hash.
    const cachedNFTTokenData = await tokenDataGetter.getCachedNFTTokenData(tokenHash);
    expect(cachedNFTTokenData).to.deep.equal(onChainTokenData);

    // Check result
    expect(result.treeNumber).to.equal(0);
    expect(result.startPosition).to.equal(0);
    expect(result.commitments.length).to.equal(1);

    const merkleRootAfterShield = await RailgunVersionedSmartContracts.getAccumulator(
      txidVersion,
      chain,
    ).merkleRoot();

    // Check merkle root changed
    expect(merkleRootAfterShield).not.to.equal(merkleRootBefore);
  }).timeout(20000);

  it('[HH] Should create transactions and parse tree updates', async function run() {
    if (!isDefined(process.env.RUN_HARDHAT_TESTS)) {
      this.skip();
      return;
    }

    await testShield(1000n);
    const merkleRootAfterShield = await RailgunVersionedSmartContracts.getAccumulator(
      txidVersion,
      chain,
    ).merkleRoot();

    let result!: CommitmentEvent;
    await RailgunVersionedSmartContracts.setTreeUpdateListeners(
      txidVersion,
      chain,
      async (_txidVersion: TXIDVersion, commitmentEvents: CommitmentEvent[]) => {
        // eslint-disable-next-line prefer-destructuring
        result = commitmentEvents[0];
      },
      async () => {},
      async () => {},
      async () => {},
      async () => {},
    );
    // Create transaction
    const transactionBatch = new TransactionBatch(chain);

    const tokenData = getTokenDataERC20(TOKEN_ADDRESS);

    transactionBatch.addOutput(
      TransactNote.createTransfer(
        wallet2.addressKeys,
        wallet.addressKeys,
        300n,
        tokenData,
        true, // showSenderAddressToRecipient
        OutputType.RelayerFee,
        undefined, // memoText
      ),
    );
    transactionBatch.addUnshieldData({
      toAddress: ethersWallet.address,
      value: 100n,
      tokenData,
    });

    // Create transact
    const { provedTransactions } = await transactionBatch.generateTransactions(
      engine.prover,
      wallet,
      txidVersion,
      testEncryptionKey,
      () => {},
      false, // shouldGeneratePreTransactionPOIs
    );
    const transact = await RailgunVersionedSmartContracts.generateTransact(
      txidVersion,
      chain,
      provedTransactions,
    );

    // Send transact on chain
    const txResponse = await sendTransactionWithLatestNonce(ethersWallet, transact);

    await Promise.all([txResponse.wait(), awaitRailgunSmartWalletTransact(txidVersion, chain)]);

    // Check merkle root changed
    const merkleRootAfterTransact = await RailgunVersionedSmartContracts.getAccumulator(
      txidVersion,
      chain,
    ).merkleRoot();
    expect(merkleRootAfterTransact).to.not.equal(merkleRootAfterShield);

    // Check result
    expect(result).to.not.equal(undefined);
    expect(result.treeNumber).to.equal(0);
    expect(result.startPosition).to.equal(1);
    expect(result.commitments.length).to.equal(2);
    switch (txidVersion) {
      case TXIDVersion.V2_PoseidonMerkle: {
        expect((result.commitments as TransactCommitmentV2[])[0].ciphertext.memo.length).to.equal(
          2,
        );
        expect((result.commitments as TransactCommitmentV2[])[1].ciphertext.memo.length).to.equal(
          2,
        );
        expect(
          Memo.decryptNoteAnnotationData(
            (result.commitments as TransactCommitmentV2[])[0].ciphertext.annotationData,
            wallet.getViewingKeyPair().privateKey,
          ),
        ).to.deep.equal({
          outputType: OutputType.RelayerFee,
          senderRandom: MEMO_SENDER_RANDOM_NULL,
          walletSource: 'test rsw',
        });
        expect(
          Memo.decryptNoteAnnotationData(
            (result.commitments as TransactCommitmentV2[])[1].ciphertext.annotationData,
            wallet.getViewingKeyPair().privateKey,
          ),
        ).to.deep.equal({
          outputType: OutputType.Change,
          senderRandom: MEMO_SENDER_RANDOM_NULL,
          walletSource: 'test rsw',
        });
        break;
      }
      case TXIDVersion.V3_PoseidonMerkle: {
        expect(
          Memo.decryptSenderCiphertextV3(
            (result.commitments as TransactCommitmentV3[])[0].senderCiphertext,
            wallet.getViewingKeyPair().privateKey,
            0, // transactCommitmentBatchIndex
          ),
        ).to.deep.equal({
          outputType: OutputType.RelayerFee,
          walletSource: 'test rsw',
        });
        expect(
          Memo.decryptSenderCiphertextV3(
            (result.commitments as TransactCommitmentV3[])[1].senderCiphertext,
            wallet.getViewingKeyPair().privateKey,
            1, // transactCommitmentBatchIndex
          ),
        ).to.deep.equal({
          outputType: OutputType.Change,
          walletSource: 'test rsw',
        });
        break;
      }
    }
  }).timeout(120000);

  afterEach(async () => {
    if (!isDefined(process.env.RUN_HARDHAT_TESTS)) {
      return;
    }
    await engine.unload();
    await provider.send('evm_revert', [snapshot]);
  });
});
