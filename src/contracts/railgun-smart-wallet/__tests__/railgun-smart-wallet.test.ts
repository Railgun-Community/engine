/// <reference types="../../../types/global" />
import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { Contract, JsonRpcProvider, TransactionReceipt, Wallet } from 'ethers';
import memdown from 'memdown';
import { groth16 } from 'snarkjs';
import { abi as erc20Abi } from '../../../test/test-erc20-abi.test';
import { abi as erc721Abi } from '../../../test/test-erc721-abi.test';
import { config } from '../../../test/config.test';
import { RailgunWallet } from '../../../wallet/railgun-wallet';
import {
  ByteLength,
  formatToByteLength,
  hexlify,
  hexToBytes,
  randomHex,
} from '../../../utils/bytes';
import {
  awaitMultipleScans,
  awaitRailgunSmartWalletEvent,
  awaitRailgunSmartWalletShield,
  awaitScan,
  DECIMALS_18,
  getEthersWallet,
  mockGetLatestValidatedRailgunTxid,
  mockQuickSyncEvents,
  mockQuickSyncRailgunTransactions,
  mockRailgunTxidMerklerootValidator,
  sendTransactionWithLatestNonce,
  testArtifactsGetter,
} from '../../../test/helper.test';
import {
  CommitmentType,
  NFTTokenData,
  Nullifier,
  OutputType,
  TokenType,
  TransactCommitment,
} from '../../../models/formatted-types';
import {
  CommitmentEvent,
  EngineEvent,
  MerkletreeHistoryScanEventData,
  MerkletreeScanStatus,
  UnshieldStoredEvent,
} from '../../../models/event-types';
import { Memo } from '../../../note/memo';
import { ViewOnlyWallet } from '../../../wallet/view-only-wallet';
import { SnarkJSGroth16 } from '../../../prover/prover';
import { promiseTimeout } from '../../../utils/promises';
import { Chain, ChainType } from '../../../models/engine-types';
import { RailgunEngine } from '../../../railgun-engine';
import { RailgunSmartWalletContract } from '../railgun-smart-wallet';
import { MEMO_SENDER_RANDOM_NULL } from '../../../models/transaction-constants';
import { TransactNote } from '../../../note/transact-note';
import { ShieldNoteERC20 } from '../../../note/erc20/shield-note-erc20';
import {
  GAS_ESTIMATE_VARIANCE_DUMMY_TO_ACTUAL_TRANSACTION,
  TransactionBatch,
} from '../../../transaction/transaction-batch';
import { UnshieldNoteERC20 } from '../../../note/erc20/unshield-note-erc20';
import { getTokenDataERC20 } from '../../../note/note-util';
import { TokenDataGetter } from '../../../token/token-data-getter';
import { ContractStore } from '../../contract-store';
import { mintNFTsID01ForTest, shieldNFTForTest } from '../../../test/shared-test.test';
import { TestERC20 } from '../../../test/abi/typechain/TestERC20';
import { TestERC721 } from '../../../test/abi/typechain/TestERC721';
import { TransactionHistoryReceiveTokenAmount } from '../../../models/wallet-types';
import { ShieldRequestStruct } from '../../../abi/typechain/RailgunSmartWallet';
import { PollingJsonRpcProvider } from '../../../provider/polling-json-rpc-provider';
import { createPollingJsonRpcProviderForListeners } from '../../../provider/polling-util';
import { isDefined } from '../../../utils/is-defined';
import { TXIDVersion } from '../../../models/poi-types';

chai.use(chaiAsPromised);
const { expect } = chai;

const txidVersion = TXIDVersion.V2_PoseidonMerkle;

let provider: PollingJsonRpcProvider;
let chain: Chain;
let engine: RailgunEngine;
let ethersWallet: Wallet;
let snapshot: number;
let token: TestERC20;
let nft: TestERC721;
let railgunSmartWalletContract: RailgunSmartWalletContract;
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
      mockQuickSyncRailgunTransactions,
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
    const pollingProvider = await createPollingJsonRpcProviderForListeners(provider);
    await engine.loadNetwork(
      chain,
      config.contracts.proxy,
      config.contracts.relayAdapt,
      provider,
      pollingProvider,
      { [TXIDVersion.V2_PoseidonMerkle]: 0 },
      0,
    );
    await engine.scanHistory(chain);
    railgunSmartWalletContract = ContractStore.railgunSmartWalletContracts[chain.type][chain.id];

    ethersWallet = getEthersWallet(config.mnemonic, provider);
    snapshot = (await provider.send('evm_snapshot', [])) as number;

    token = new Contract(TOKEN_ADDRESS, erc20Abi, ethersWallet) as unknown as TestERC20;
    const balance = await token.balanceOf(ethersWallet.address);
    await token.approve(railgunSmartWalletContract.address, balance);

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

      const shieldTx = await railgunSmartWalletContract.generateShield([shieldInput]);

      // Send shield on chain
      const tx = await sendTransactionWithLatestNonce(ethersWallet, shieldTx);
      return (await Promise.all([tx.wait(), awaitScan(wallet, chain)]))[0];
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

    expect(await railgunSmartWalletContract.merkleRoot()).to.equal(
      '14fceeac99eb8419a2796d1958fc2050d489bf5a3eb170ef16a667060344ba90',
    );
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
    const approval = await nft.approve.populateTransaction(railgunSmartWalletContract.address, 1);
    const approvalTxResponse = await sendTransactionWithLatestNonce(ethersWallet, approval);
    await approvalTxResponse.wait();

    const shield = await shieldNFTForTest(
      wallet,
      ethersWallet,
      railgunSmartWalletContract,
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
      wallet.getViewingKeyPair(),
      false, // showSenderAddressToRecipient
      OutputType.Transfer,
      undefined, // memoText
    );
    const actualRelayerFeeOutput = TransactNote.createTransfer(
      wallet2.addressKeys,
      wallet.addressKeys,
      300n,
      tokenData,
      wallet.getViewingKeyPair(),
      false, // showSenderAddressToRecipient
      OutputType.Transfer,
      undefined, // memoText
    );
    const nftTransferOutput = TransactNote.createERC721Transfer(
      wallet2.addressKeys,
      wallet.addressKeys,
      shield.tokenData as NFTTokenData,
      wallet.getViewingKeyPair(),
      false, // showSenderAddressToRecipient
      undefined, // memoText
    );

    // Submit actual transaction so the tree has a spent note/nullifier at position 0.
    const initialTransactionBatch = new TransactionBatch(chain);
    initialTransactionBatch.addOutput(actualRelayerFeeOutput);
    const txs_initial = await initialTransactionBatch.generateTransactions(
      engine.prover,
      wallet,
      txidVersion,
      testEncryptionKey,
      () => {},
    );
    const tx_initial = await railgunSmartWalletContract.transact(txs_initial);
    const txTransact = await sendTransactionWithLatestNonce(ethersWallet, tx_initial);
    await Promise.all([
      txTransact.wait(),
      promiseTimeout(awaitMultipleScans(wallet, chain, 2), 15000, 'Timed out wallet1 scan'),
    ]);

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
    const tx_DummyNullRelayerFee = await railgunSmartWalletContract.transact(
      txs_DummyNullRelayerFee,
    );
    tx_DummyNullRelayerFee.from = '0x000000000000000000000000000000000000dEaD';
    const gasEstimate_DummyNullRelayerFee = await provider.estimateGas(tx_DummyNullRelayerFee);

    // This should be around 1.30M gas.
    // This will vary slightly based on small changes to the contract.
    expect(Number(gasEstimate_DummyNullRelayerFee)).to.be.greaterThan(1_290_000);
    expect(Number(gasEstimate_DummyNullRelayerFee)).to.be.lessThan(1_310_000);

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
    const tx_DummyActualRelayerFee = await railgunSmartWalletContract.transact(
      txs_DummyActualRelayerFee,
    );
    tx_DummyActualRelayerFee.from = '0x000000000000000000000000000000000000dEaD';
    const gasEstimate_DummyActualRelayerFee = await provider.estimateGas(tx_DummyActualRelayerFee);
    // This should be around 1.41M gas.
    // This will vary slightly based on small changes to the contract.
    expect(Number(gasEstimate_DummyActualRelayerFee)).to.be.greaterThan(1_400_000);
    expect(Number(gasEstimate_DummyActualRelayerFee)).to.be.lessThan(1_420_000);

    // Case 3 - Actual transaction
    const transactionBatch_ActualTransaction = new TransactionBatch(chain);
    transactionBatch_ActualTransaction.addOutput(actualRelayerFeeOutput);
    transactionBatch_ActualTransaction.addOutput(nftTransferOutput);
    const txs_ActualTransaction = await transactionBatch_ActualTransaction.generateTransactions(
      engine.prover,
      wallet,
      txidVersion,
      testEncryptionKey,
      () => {},
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
    const tx_ActualTransaction = await railgunSmartWalletContract.transact(txs_ActualTransaction);
    tx_ActualTransaction.from = ethersWallet.address;
    const gasEstimate_ActualTransaction = await provider.estimateGas(tx_ActualTransaction);
    // This should be around 1.42M gas.
    // This will vary slightly based on small changes to the contract.
    expect(Number(gasEstimate_ActualTransaction)).to.be.greaterThan(1_410_000);
    expect(Number(gasEstimate_ActualTransaction)).to.be.lessThan(1_430_000);

    // Should be very similar to dummy transaction with actual relayer fee.
    // Variance expected at ~7500 additional gas for actual transaction. (we've seen 7121, also tested at 7146 and 7194 with multi-circuit in the field)
    expect(
      Number(gasEstimate_ActualTransaction - gasEstimate_DummyActualRelayerFee),
    ).to.be.lessThan(
      // 7500
      GAS_ESTIMATE_VARIANCE_DUMMY_TO_ACTUAL_TRANSACTION,
    );
    expect(
      Number(gasEstimate_ActualTransaction - gasEstimate_DummyActualRelayerFee),
    ).to.be.greaterThan(7000);
    expect(
      Number(gasEstimate_ActualTransaction - gasEstimate_DummyActualRelayerFee),
    ).to.be.lessThan(7300);
  }).timeout(120000);

  it('[HH] Should return valid merkle roots', async function run() {
    if (!isDefined(process.env.RUN_HARDHAT_TESTS)) {
      this.skip();
      return;
    }
    expect(
      await railgunSmartWalletContract.validateMerkleroot(
        0,
        '0x14fceeac99eb8419a2796d1958fc2050d489bf5a3eb170ef16a667060344ba90',
      ),
    ).to.equal(true);
    expect(
      await railgunSmartWalletContract.validateMerkleroot(
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
    const fees = await railgunSmartWalletContract.fees();
    expect(fees).to.be.an('object');
    expect(fees.shield).to.be.a('bigint');
    expect(fees.unshield).to.be.a('bigint');
    expect(fees.nft).to.be.a('bigint');
  });

  it('[HH] Should find shield, transact and unshield as historical events', async function run() {
    if (!isDefined(process.env.RUN_HARDHAT_TESTS)) {
      this.skip();
      return;
    }

    let resultEvent!: Optional<CommitmentEvent>;
    const eventsListener = async (_txidVersion: TXIDVersion, commitmentEvent: CommitmentEvent) => {
      resultEvent = commitmentEvent;
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

    let startingBlock = await provider.getBlockNumber();

    // Add a secondary listener.
    await railgunSmartWalletContract.setTreeUpdateListeners(
      eventsListener,
      nullifiersListener,
      unshieldListener,
    );

    // Subscribe to Nullified event
    const resultNullifiers2: Nullifier[] = [];
    const nullifiersListener2 = (nullifiers: Nullifier[]) => {
      resultNullifiers2.push(...nullifiers);
    };
    railgunSmartWalletContract.on(EngineEvent.ContractNullifierReceived, nullifiersListener2);

    const txResponse = await testShield();
    if (txResponse == null) {
      throw new Error('No shield transaction response');
    }

    // Listeners should have been updated automatically by contract events.

    expect(resultEvent).to.be.an('object', 'No event in history for shield');
    expect((resultEvent as CommitmentEvent).txid).to.equal(hexlify(txResponse.hash));
    expect(resultNullifiers.length).to.equal(0);

    resultEvent = undefined;
    resultNullifiers = [];
    resultUnshields = [];

    let latestBlock = await provider.getBlockNumber();

    await railgunSmartWalletContract.getHistoricalEvents(
      chain,
      startingBlock,
      latestBlock,
      () => engine.getNextStartingBlockSlowScan(txidVersion, chain),
      eventsListener,
      nullifiersListener,
      unshieldListener,
      async () => {},
    );

    // Listeners should have been updated by historical event scan.

    expect(resultEvent).to.be.an('object', 'No event in history for shield');
    expect((resultEvent as unknown as CommitmentEvent).txid).to.equal(hexlify(txResponse.hash));
    expect(resultNullifiers.length).to.equal(0);
    expect(resultUnshields.length).to.equal(0);

    startingBlock = await provider.getBlockNumber();

    const transactionBatch = new TransactionBatch(chain);

    const tokenData = getTokenDataERC20(TOKEN_ADDRESS);

    transactionBatch.addOutput(
      TransactNote.createTransfer(
        wallet2.addressKeys,
        wallet.addressKeys,
        300n,
        tokenData,
        wallet.getViewingKeyPair(),
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
    const serializedTxs = await transactionBatch.generateTransactions(
      engine.prover,
      wallet,
      txidVersion,
      testEncryptionKey,
      () => {},
    );
    const transact = await railgunSmartWalletContract.transact(serializedTxs);

    // Send transact on chain
    const txTransact = await sendTransactionWithLatestNonce(ethersWallet, transact);
    const [txResponseTransact] = await Promise.all([
      txTransact.wait(),
      promiseTimeout(awaitMultipleScans(wallet, chain, 2), 15000, 'Timed out wallet1 scan'),
      promiseTimeout(awaitMultipleScans(viewOnlyWallet, chain, 2), 15000, 'Timed out wallet1 scan'),
    ]);

    expect(await wallet.getBalanceERC20(txidVersion, chain, TOKEN_ADDRESS)).equal(
      109724999999999999999600n,
    );
    expect(await viewOnlyWallet.getBalanceERC20(txidVersion, chain, TOKEN_ADDRESS)).equal(
      109724999999999999999600n,
    );

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

    resultEvent = undefined;
    resultNullifiers = [];

    latestBlock = await provider.getBlockNumber();

    await railgunSmartWalletContract.getHistoricalEvents(
      chain,
      startingBlock,
      latestBlock,
      () => engine.getNextStartingBlockSlowScan(txidVersion, chain),
      eventsListener,
      nullifiersListener,
      unshieldListener,
      async () => {},
    );

    // Event should have been scanned by historical event scan.

    expect((resultEvent as unknown as CommitmentEvent).txid).to.equal(txid);
    expect((resultEvent as unknown as CommitmentEvent).commitments[0].commitmentType).to.equal(
      CommitmentType.TransactCommitment,
    );
    expect(resultNullifiers.length).to.equal(1);
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
    const shieldTx = await railgunSmartWalletContract.generateShield(shieldInputs);

    // Send shield on chain
    const tx = await sendTransactionWithLatestNonce(ethersWallet, shieldTx);
    await Promise.all([tx.wait(), awaitScan(wallet, chain)]);

    const transactionBatch = new TransactionBatch(chain);

    const tokenData = getTokenDataERC20(TOKEN_ADDRESS);

    transactionBatch.addUnshieldData({
      toAddress: ethersWallet.address,
      value: 1097250000n, // 11 * 100000000 * 0.9975
      tokenData,
    });
    const serializedTxs = await transactionBatch.generateTransactions(
      engine.prover,
      wallet,
      txidVersion,
      testEncryptionKey,
      () => {},
    );
    const transact = await railgunSmartWalletContract.transact(serializedTxs);

    // Send transact on chain
    const txTransact = await sendTransactionWithLatestNonce(ethersWallet, transact);
    await Promise.all([
      txTransact.wait(),
      promiseTimeout(awaitMultipleScans(wallet, chain, 2), 15000, 'Timed out wallet1 scan'),
    ]);

    expect(await wallet.getBalanceERC20(txidVersion, chain, TOKEN_ADDRESS)).equal(0n);

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
        recipientAddress: ethersWallet.address,
        memoText: undefined,
        senderAddress: undefined,
        unshieldFee: '2493750',
      },
      {
        tokenData: getTokenDataERC20(TOKEN_ADDRESS),
        tokenHash: tokenFormatted,
        amount: 99500625n, // 1097250000n * 1/11 * 0.9975
        recipientAddress: ethersWallet.address,
        memoText: undefined,
        senderAddress: undefined,
        unshieldFee: '249375', // 1097250000n * 1/11 * 0.9975
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

    const utxoMerkletree = engine.getUTXOMerkletree(TXIDVersion.V2_PoseidonMerkle, chain);

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

    await engine.clearSyncedUTXOMerkletreeLeaves(txidVersion, chain);
    expect(await utxoMerkletree.getTreeLength(tree)).to.equal(0);
    expect(await engine.getStartScanningBlock(txidVersion, chain)).to.equal(0);

    await engine.fullRescanUTXOMerkletreesAndWallets(chain);
    expect(await utxoMerkletree.getTreeLength(tree)).to.equal(1);
  });

  it('[HH] Should get note hashes', async function run() {
    if (!isDefined(process.env.RUN_HARDHAT_TESTS)) {
      this.skip();
      return;
    }
    const unshield = new UnshieldNoteERC20(ethersWallet.address, 100n, await token.getAddress());
    const contractHash = await railgunSmartWalletContract.hashCommitment(unshield.preImage);

    expect(hexlify(contractHash)).to.equal(unshield.hashHex);
  });

  it('[HH] Should shield erc20', async function run() {
    if (!isDefined(process.env.RUN_HARDHAT_TESTS)) {
      this.skip();
      return;
    }

    let result!: CommitmentEvent;
    await railgunSmartWalletContract.setTreeUpdateListeners(
      async (_txidVersion: TXIDVersion, commitmentEvent: CommitmentEvent) => {
        result = commitmentEvent;
      },
      async () => {},
      async () => {},
    );
    const merkleRootBefore = await railgunSmartWalletContract.merkleRoot();

    // Create shield
    const shield = new ShieldNoteERC20(wallet.masterPublicKey, RANDOM, VALUE, TOKEN_ADDRESS);
    const shieldPrivateKey = hexToBytes(randomHex(32));
    const shieldInput = await shield.serialize(shieldPrivateKey, wallet.getViewingKeyPair().pubkey);

    const shieldTx = await railgunSmartWalletContract.generateShield([shieldInput]);

    const txResponse = await sendTransactionWithLatestNonce(ethersWallet, shieldTx);
    await Promise.all([
      awaitRailgunSmartWalletShield(railgunSmartWalletContract),
      promiseTimeout(awaitScan(wallet, chain), 5000),
      txResponse.wait(),
    ]);

    // Check result
    expect(result.treeNumber).to.equal(0);
    expect(result.startPosition).to.equal(0);
    expect(result.commitments.length).to.equal(1);

    const merkleRootAfterShield = await railgunSmartWalletContract.merkleRoot();

    // Check merkle root changed
    expect(merkleRootAfterShield).not.to.equal(merkleRootBefore);
  }).timeout(20000);

  it('[HH] Should shield erc721', async function run() {
    if (!isDefined(process.env.RUN_HARDHAT_TESTS)) {
      this.skip();
      return;
    }

    let result!: CommitmentEvent;
    await railgunSmartWalletContract.setTreeUpdateListeners(
      async (_txidVersion: TXIDVersion, commitmentEvent: CommitmentEvent) => {
        result = commitmentEvent;
      },
      async () => {},
      async () => {},
    );
    const merkleRootBefore = await railgunSmartWalletContract.merkleRoot();

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
      RANDOM,
      NFT_ADDRESS,
      BigInt(1).toString(),
    );

    // Check tokenData stored in contract.
    const { tokenHash } = shield;
    const tokenDataGetter = new TokenDataGetter(engine.db, chain);
    const onChainTokenData = await tokenDataGetter.getNFTTokenData(tokenHash);
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

    const merkleRootAfterShield = await railgunSmartWalletContract.merkleRoot();

    // Check merkle root changed
    expect(merkleRootAfterShield).not.to.equal(merkleRootBefore);
  }).timeout(20000);

  it('[HH] Should create transactions and parse tree updates', async function run() {
    if (!isDefined(process.env.RUN_HARDHAT_TESTS)) {
      this.skip();
      return;
    }

    await testShield(1000n);
    const merkleRootAfterShield = await railgunSmartWalletContract.merkleRoot();

    let result!: CommitmentEvent;
    await railgunSmartWalletContract.setTreeUpdateListeners(
      async (_txidVersion: TXIDVersion, commitmentEvent: CommitmentEvent) => {
        result = commitmentEvent;
      },
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
        wallet.getViewingKeyPair(),
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
    const transact = await railgunSmartWalletContract.transact(
      await transactionBatch.generateTransactions(
        engine.prover,
        wallet,
        txidVersion,
        testEncryptionKey,
        () => {},
      ),
    );

    // Send transact on chain
    const txResponse = await sendTransactionWithLatestNonce(ethersWallet, transact);

    await Promise.all([
      txResponse.wait(),
      awaitRailgunSmartWalletEvent(
        railgunSmartWalletContract,
        railgunSmartWalletContract.contract.filters.Transact(),
      ),
    ]);

    // Check merkle root changed
    const merkleRootAfterTransact = await railgunSmartWalletContract.merkleRoot();
    expect(merkleRootAfterTransact).to.not.equal(merkleRootAfterShield);

    // Check result
    expect(result.treeNumber).to.equal(0);
    expect(result.startPosition).to.equal(1);
    expect(result.commitments.length).to.equal(2);
    expect((result.commitments as TransactCommitment[])[0].ciphertext.memo.length).to.equal(2);
    expect((result.commitments as TransactCommitment[])[1].ciphertext.memo.length).to.equal(2);
    expect(
      Memo.decryptNoteAnnotationData(
        (result.commitments as TransactCommitment[])[0].ciphertext.annotationData,
        wallet.getViewingKeyPair().privateKey,
      ),
    ).to.deep.equal({
      outputType: OutputType.RelayerFee,
      senderRandom: MEMO_SENDER_RANDOM_NULL,
      walletSource: 'test rsw',
    });
    expect(
      Memo.decryptNoteAnnotationData(
        (result.commitments as TransactCommitment[])[1].ciphertext.annotationData,
        wallet.getViewingKeyPair().privateKey,
      ),
    ).to.deep.equal({
      outputType: OutputType.Change,
      senderRandom: MEMO_SENDER_RANDOM_NULL,
      walletSource: 'test rsw',
    });
  }).timeout(120000);

  afterEach(async () => {
    if (!isDefined(process.env.RUN_HARDHAT_TESTS)) {
      return;
    }
    await engine.unload();
    await provider.send('evm_revert', [snapshot]);
  });
});
