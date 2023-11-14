import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { groth16 } from 'snarkjs';
import memdown from 'memdown';
import { TXIDVersion, TXOPOIListStatus } from '../../models/poi-types';
import { RailgunEngine } from '../../railgun-engine';
import { RailgunWallet } from '../../wallet/railgun-wallet';
import { AddressData } from '../../key-derivation/bech32';
import { TransactionStructV2, TransactionStructV3 } from '../../models/transaction-types';
import { TransactionBatch } from '../../transaction/transaction-batch';
import { TransactNote } from '../../note/transact-note';
import { getTokenDataERC20 } from '../../note/note-util';
import { OutputType } from '../../models/formatted-types';
import { Chain, ChainType } from '../../models';
import { hexlify, padToLength, randomHex } from '../../utils/bytes';
import {
  extractFirstNoteERC20AmountMapFromTransactionRequest,
  extractRailgunTransactionDataFromTransactionRequest,
} from '../extract-transaction-data';
import { config } from '../../test/config.test';
import { RelayAdaptVersionedSmartContracts } from '../../contracts/relay-adapt/relay-adapt-versioned-smart-contracts';
import {
  getTestTXIDVersion,
  isV2Test,
  mockGetLatestValidatedRailgunTxid,
  mockQuickSyncEvents,
  mockQuickSyncRailgunTransactionsV2,
  mockRailgunTxidMerklerootValidator,
  testArtifactsGetter,
} from '../../test/helper.test';
import { SnarkJSGroth16 } from '../../prover/prover';
import { PollingJsonRpcProvider } from '../../provider/polling-json-rpc-provider';
import { createPollingJsonRpcProviderForListeners } from '../../provider/polling-util';
import {
  createEngineVerifyProofStub,
  createEngineWalletBalancesStub,
  restoreEngineStubs,
} from '../../test/engine-stubs.test';
import { TestPOINodeInterface } from '../../test/test-poi-node-interface.test';
import { TokenDataGetter } from '../../token/token-data-getter';
import { RailgunVersionedSmartContracts } from '../../contracts/railgun-smart-wallet/railgun-versioned-smart-contracts';
import { isDefined } from '../../utils/is-defined';

chai.use(chaiAsPromised);
const { expect } = chai;

let engine: RailgunEngine;
let railgunWallet: RailgunWallet;

const txidVersion = getTestTXIDVersion();

const RANDOM_RELAY_ADAPT = randomHex(31);
const MOCK_TOKEN_ADDRESS = config.contracts.rail;

const TREE = 0;
let chain: Chain;
let tokenDataGetter: TokenDataGetter;

const MOCK_ETH_WALLET_ADDRESS = '0x9E9F988356f46744Ee0374A17a5Fa1a3A3cC3777';

describe('extract-transaction-data', () => {
  const createGoerliTransferTransactions = async (
    receiverAddressData: AddressData,
    senderAddressData: AddressData,
    fee: bigint,
    tokenAddress: string,
  ): Promise<(TransactionStructV2 | TransactionStructV3)[]> => {
    // Force refresh POIs to be Valid, so balance is Spendable (see beforeEach)
    await railgunWallet.refreshPOIsForAllTXIDVersions(chain, true);

    const transaction = new TransactionBatch(chain);
    transaction.addOutput(
      TransactNote.createTransfer(
        receiverAddressData,
        senderAddressData,
        fee,
        getTokenDataERC20(tokenAddress),
        false, // shouldShowSender
        OutputType.Transfer,
        undefined, // memoText
      ),
    );
    return transaction.generateDummyTransactions(
      engine.prover,
      railgunWallet,
      txidVersion,
      config.encryptionKey,
    );
  };

  const createGoerliRelayAdaptUnshieldTransactions = async (
    receiverAddressData: AddressData,
    senderAddressData: AddressData,
    fee: bigint,
    tokenAddress: string,
  ): Promise<(TransactionStructV2 | TransactionStructV3)[]> => {
    const transaction = new TransactionBatch(chain);
    transaction.addOutput(
      TransactNote.createTransfer(
        receiverAddressData,
        senderAddressData,
        fee,
        getTokenDataERC20(tokenAddress),
        false, // shouldShowSender
        OutputType.Transfer,
        undefined, // memoText
      ),
    );
    return transaction.generateDummyTransactions(
      engine.prover,
      railgunWallet,
      txidVersion,
      config.encryptionKey,
    );
  };

  before(async function run() {
    this.timeout(10000);

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

    tokenDataGetter = new TokenDataGetter(engine.db);

    railgunWallet = await engine.createWalletFromMnemonic(
      config.encryptionKey,
      config.mnemonic,
      undefined,
    );

    const tokenAddressHexlify = hexlify(padToLength(MOCK_TOKEN_ADDRESS, 32));

    await createEngineWalletBalancesStub(railgunWallet.addressKeys, tokenAddressHexlify, TREE);
    createEngineVerifyProofStub();

    if (!isDefined(process.env.RUN_HARDHAT_TESTS)) {
      return;
    }

    const provider = new PollingJsonRpcProvider(config.rpc, config.chainId, 100);
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
  });

  beforeEach(() => {
    TestPOINodeInterface.overridePOIsListStatus = TXOPOIListStatus.Valid;
  });

  afterEach(() => {
    TestPOINodeInterface.overridePOIsListStatus = TXOPOIListStatus.Missing;
  });

  it('[V2] Should extract railgun transaction data', async function run() {
    if (!isV2Test()) {
      this.skip();
      return;
    }

    const transaction = {
      to: config.contracts.proxy,
      data: '0xd8ae136a0000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000014fceeac99eb8419a2796d1958fc2050d489bf5a3eb170ef16a667060344ba900000000000000000000000000000000000000000000000000000000000000220000000000000000000000000000000000000000000000000000000000000026000000000000000000000000000000000000000000000000000000000000002c000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000105802951a46d9e999151eb0eb9e4c7c1260b7ee88539011c207dc169c4dd17ee00000000000000000000000000000000000000000000000000000000000000022d19ecebdbe7eaf95d5e36841de3df4fa84f4d978f00aea308f0edb3deb1958600b6efe9fcfa0057732d69ea826bb0b4249ed1f921e139eaa3aa6ea2ff0196fa00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000050000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000e00000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000001c0f5c40b3a54da7510b4d04c25c3995ed107543dfa63c7e69f544b7a7f83e39cd9a1fc243639f8d9fbac6ac7f7744dc2b1fc49c9fce02cb93ce60536668e905bdd47813f3b05b8b5f29c4c7dfaf0bd2a3d9f143442dfed60bd8d63705031f12c68acd866af2b2f986a6468fd46b76730faebed97a29e654a96f2d1d18c964553150d1f957d2d57c0410a8d34c12433b67453c04d0edf89a437366ecee156e2da290d1f957d2d57c0410a8d34c12433b67453c04d0edf89a437366ecee156e2da2900000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000000160000000000000000000000000000000000000000000000000000000000000003ef2b9485d38127f76d7955f4c216bf8acf0c54ca8b05c6a90d051fa782a677d719a5cdb5269b184d038d3c6b238575efc42253c5b360b8e361f08b0b08798000000000000000000000000000000000000000000000000000000000000000000000744f5b8a005f417a594cdd783852c1e0979cc5010704f13c52de3377d0cad242957f9331392b03a10ec6354e1bb7f952b6056a0d071c839acf6c845bd8e248908c4cbe7c0d1884f0d5a7a5cad42a7fcdbddb25acbc5f9d444c625d2b0c63cc48945739b05749ef8c430e0c5bbd0c02056b0e2f106c9fcba307a291e4ba41a907bc910387ac5698108ef609bb441f44e25dcfcf2def6c174ae4c7108441cae9d7bc910387ac5698108ef609bb441f44e25dcfcf2def6c174ae4c7108441cae9d00000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000000160000000000000000000000000000000000000000000000000000000000000003e7f6aaaa49235ea17f5f90c73e2a0cf615bc392a8a52a29d262923059c165cd528f922b2b00c33a1e667a5ecee2086cf014a40705578552ab55413a9d4cc500000000000000000000000000000000000000000000000000000000000000000000',
    };
    const railgunTransactionData = await extractRailgunTransactionDataFromTransactionRequest(
      txidVersion,
      chain,
      transaction,
      false, // useRelayAdapt
      config.contracts.proxy,
      railgunWallet.viewingKeyPair.privateKey,
      railgunWallet.addressKeys,
      tokenDataGetter,
    );
    expect(railgunTransactionData).to.deep.equal([
      {
        railgunTxid: '18759632f78e7ce85cbd04769b98c8a5436d5144ff9f96f9743eeab43864f98a',
        utxoTreeIn: 0n,
        firstCommitment: '0x2d19ecebdbe7eaf95d5e36841de3df4fa84f4d978f00aea308f0edb3deb19586',
        firstCommitmentNotePublicKey:
          5359614152058359376498286929274915634684900503457035822149709199778311325149n,
      },
    ]);
  });

  it('[HH] Should extract fee correctly - transfer', async function run() {
    if (!isDefined(process.env.RUN_HARDHAT_TESTS)) {
      this.skip();
      return;
    }

    const fee = BigInt('1000');
    const senderAddressData = RailgunEngine.decodeAddress(
      '0zk1qy00025qjn7vw0mvu4egcxlkjv3nkemeat92qdlh3lzl4rpzxv9f8rv7j6fe3z53ll2adx8kn0lj0ucjkz4xxyax8l9mpqjgrf9z3zjvlvqr4qxgznrpqugcjt8',
    );
    const transactions = await createGoerliTransferTransactions(
      railgunWallet.addressKeys,
      senderAddressData,
      fee,
      MOCK_TOKEN_ADDRESS,
    );
    const transaction = await RailgunVersionedSmartContracts.generateTransact(
      txidVersion,
      chain,
      transactions,
    );
    const firstNoteERC20AmountMap = await extractFirstNoteERC20AmountMapFromTransactionRequest(
      txidVersion,
      chain,
      transaction,
      false, // useRelayAdapt
      isV2Test() ? config.contracts.proxy : config.contracts.poseidonMerkleVerifierV3,
      railgunWallet.viewingKeyPair.privateKey,
      railgunWallet.addressKeys,
      tokenDataGetter,
    );
    expect(Object.keys(firstNoteERC20AmountMap).length).to.equal(1);
    expect(firstNoteERC20AmountMap[MOCK_TOKEN_ADDRESS.toLowerCase()]).to.equal(1000n);
  }).timeout(60000);

  it('[HH] Should fail for incorrect receiver address - transfer', async function run() {
    if (!isDefined(process.env.RUN_HARDHAT_TESTS)) {
      this.skip();
      return;
    }

    const fee = BigInt('1000');
    const receiverAddressData = RailgunEngine.decodeAddress(
      '0zk1q8hxknrs97q8pjxaagwthzc0df99rzmhl2xnlxmgv9akv32sua0kfrv7j6fe3z53llhxknrs97q8pjxaagwthzc0df99rzmhl2xnlxmgv9akv32sua0kg0zpzts',
    );
    const senderAddressData = RailgunEngine.decodeAddress(
      '0zk1qy00025qjn7vw0mvu4egcxlkjv3nkemeat92qdlh3lzl4rpzxv9f8rv7j6fe3z53ll2adx8kn0lj0ucjkz4xxyax8l9mpqjgrf9z3zjvlvqr4qxgznrpqugcjt8',
    );
    const transactions = await createGoerliTransferTransactions(
      receiverAddressData,
      senderAddressData,
      fee,
      MOCK_TOKEN_ADDRESS,
    );
    const transaction = await RailgunVersionedSmartContracts.generateTransact(
      txidVersion,
      chain,
      transactions,
    );
    const firstNoteERC20AmountMap = await extractFirstNoteERC20AmountMapFromTransactionRequest(
      txidVersion,
      chain,
      transaction,
      false, // useRelayAdapt
      isV2Test() ? config.contracts.proxy : config.contracts.poseidonMerkleVerifierV3,
      railgunWallet.viewingKeyPair.privateKey,
      railgunWallet.addressKeys,
      tokenDataGetter,
    );
    expect(Object.keys(firstNoteERC20AmountMap).length).to.equal(0);
  }).timeout(60000);

  it('[HH] Should extract fee correctly - relay adapt', async function run() {
    if (!isDefined(process.env.RUN_HARDHAT_TESTS)) {
      this.skip();
      return;
    }

    const fee = BigInt('1000');
    const senderAddressData = RailgunEngine.decodeAddress(
      '0zk1qy00025qjn7vw0mvu4egcxlkjv3nkemeat92qdlh3lzl4rpzxv9f8rv7j6fe3z53ll2adx8kn0lj0ucjkz4xxyax8l9mpqjgrf9z3zjvlvqr4qxgznrpqugcjt8',
    );
    const transactions = await createGoerliRelayAdaptUnshieldTransactions(
      railgunWallet.addressKeys,
      senderAddressData,
      fee,
      MOCK_TOKEN_ADDRESS,
    );
    const transaction = await RelayAdaptVersionedSmartContracts.populateUnshieldBaseToken(
      txidVersion,
      chain,
      transactions,
      MOCK_ETH_WALLET_ADDRESS,
      RANDOM_RELAY_ADAPT,
    );
    const firstNoteERC20AmountMap = await extractFirstNoteERC20AmountMapFromTransactionRequest(
      txidVersion,
      chain,
      transaction,
      true, // useRelayAdapt
      isV2Test() ? config.contracts.relayAdapt : config.contracts.poseidonMerkleVerifierV3,
      railgunWallet.viewingKeyPair.privateKey,
      railgunWallet.addressKeys,
      tokenDataGetter,
    );
    expect(Object.keys(firstNoteERC20AmountMap).length).to.equal(1);
    expect(firstNoteERC20AmountMap[MOCK_TOKEN_ADDRESS.toLowerCase()]).to.equal(1000n);
  }).timeout(60000);

  it('[HH] Should fail for incorrect receiver address - relay adapt', async function run() {
    if (!isDefined(process.env.RUN_HARDHAT_TESTS)) {
      this.skip();
      return;
    }

    const fee = BigInt('1000');
    const receiverAddressData = RailgunEngine.decodeAddress(
      '0zk1q8hxknrs97q8pjxaagwthzc0df99rzmhl2xnlxmgv9akv32sua0kfrv7j6fe3z53llhxknrs97q8pjxaagwthzc0df99rzmhl2xnlxmgv9akv32sua0kg0zpzts',
    );
    const senderAddressData = RailgunEngine.decodeAddress(
      '0zk1qy00025qjn7vw0mvu4egcxlkjv3nkemeat92qdlh3lzl4rpzxv9f8rv7j6fe3z53ll2adx8kn0lj0ucjkz4xxyax8l9mpqjgrf9z3zjvlvqr4qxgznrpqugcjt8',
    );
    const transactions = await createGoerliRelayAdaptUnshieldTransactions(
      receiverAddressData,
      senderAddressData,
      fee,
      MOCK_TOKEN_ADDRESS,
    );
    const transaction = await RelayAdaptVersionedSmartContracts.populateUnshieldBaseToken(
      txidVersion,
      chain,
      transactions,
      MOCK_ETH_WALLET_ADDRESS,
      RANDOM_RELAY_ADAPT,
    );
    const firstNoteERC20AmountMap = await extractFirstNoteERC20AmountMapFromTransactionRequest(
      txidVersion,
      chain,
      transaction,
      true, // useRelayAdapt
      isV2Test() ? config.contracts.relayAdapt : config.contracts.poseidonMerkleVerifierV3,
      railgunWallet.viewingKeyPair.privateKey,
      railgunWallet.addressKeys,
      tokenDataGetter,
    );
    expect(Object.keys(firstNoteERC20AmountMap).length).to.equal(0);
  }).timeout(60000);

  after(async () => {
    restoreEngineStubs();
    await engine.unload();
  });
}).timeout(120000);
