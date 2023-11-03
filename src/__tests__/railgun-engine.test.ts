import chai, { expect } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { Contract, TransactionReceipt, Wallet } from 'ethers';
import memdown from 'memdown';
import { groth16 } from 'snarkjs';
import sinon, { SinonStub } from 'sinon';
import { RailgunEngine } from '../railgun-engine';
import { abi as erc20Abi } from '../test/test-erc20-abi.test';
import { config } from '../test/config.test';
import { abi as erc721Abi } from '../test/test-erc721-abi.test';
import { RailgunWallet } from '../wallet/railgun-wallet';
import {
  awaitMultipleScans,
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
} from '../test/helper.test';
import { ShieldNoteERC20 } from '../note/erc20/shield-note-erc20';
import {
  ByteLength,
  formatToByteLength,
  hexToBigInt,
  hexToBytes,
  nToHex,
  randomHex,
  strip0x,
} from '../utils/bytes';
import {
  CommitmentType,
  LegacyGeneratedCommitment,
  NFTTokenData,
  OutputType,
  RailgunTransactionV2,
  RailgunTransactionVersion,
  TokenType,
} from '../models/formatted-types';
import { Prover, SnarkJSGroth16 } from '../prover/prover';
import { TestERC20 } from '../test/abi/typechain/TestERC20';
import { TestERC721 } from '../test/abi/typechain/TestERC721';
import { promiseTimeout } from '../utils/promises';
import { Chain, ChainType } from '../models/engine-types';
import { TransactNote } from '../note/transact-note';
import { TOKEN_SUB_ID_NULL } from '../models/transaction-constants';
import { getTokenDataERC20, getTokenDataHash, getTokenDataNFT } from '../note/note-util';
import { TransactionBatch } from '../transaction/transaction-batch';
import { UnshieldNoteNFT } from '../note/nft/unshield-note-nft';
import { mintNFTsID01ForTest, shieldNFTForTest } from '../test/shared-test.test';
import { createPollingJsonRpcProviderForListeners } from '../provider/polling-util';
import { isDefined } from '../utils/is-defined';
import { PollingJsonRpcProvider } from '../provider/polling-json-rpc-provider';
import { UTXOMerkletree } from '../merkletree/utxo-merkletree';
import { POI } from '../poi/poi';
import {
  MOCK_LIST,
  MOCK_LIST_ACTIVE,
  MOCK_LIST_KEY,
  TestPOINodeInterface,
} from '../test/test-poi-node-interface.test';
import { hashBoundParamsV2 } from '../transaction/bound-params';
import { calculateRailgunTransactionVerificationHash } from '../transaction/railgun-txid';
import { TXIDMerkletree } from '../merkletree/txid-merkletree';
import { POIEngineProofInputs, TXIDVersion, TXOPOIListStatus } from '../models/poi-types';
import { getBlindedCommitmentForShieldOrTransact } from '../poi/blinded-commitment';
import { getGlobalTreePosition } from '../poi/global-tree-position';
import { ShieldNote } from '../note';
import { TransactionStruct, WalletBalanceBucket } from '../models';
import { stringifySafe } from '../utils';
import { AES } from '../utils/encryption/aes';
import { createDummyMerkleProof } from '../merkletree/merkle-proof';
import { RailgunVersionedSmartContracts } from '../contracts/railgun-smart-wallet/railgun-versioned-smart-contracts';
import { TransactionStructV2, TransactionStructV3 } from '../models/transaction-types';
import { WalletBalanceBucket } from '../models/txo-types';

chai.use(chaiAsPromised);

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
let utxoMerkletree: UTXOMerkletree;
let txidMerkletree: TXIDMerkletree;
let tokenAddress: string;

let transactNoteRandomStub: SinonStub;
let transactSenderRandomStub: SinonStub;
let aesGetRandomIVStub: SinonStub;
let poiGetListsCanGenerateSpentPOIsStub: SinonStub;

const erc20Address = config.contracts.rail;
const nftAddress = config.contracts.testERC721;

const testMnemonic = config.mnemonic;
const testEncryptionKey = config.encryptionKey;

const random = '67c600e777b86d3a1e72a53092e9fe85';

describe('railgun-engine', function test() {
  this.timeout(20000);

  const shieldTestTokens = async (
    railgunAddress: string,
    value: bigint,
  ): Promise<ShieldNoteERC20> => {
    const mpk = RailgunEngine.decodeAddress(railgunAddress).masterPublicKey;
    const receiverViewingPublicKey = wallet.getViewingKeyPair().pubkey;
    const shield = new ShieldNoteERC20(mpk, random, value, tokenAddress);

    const shieldPrivateKey = hexToBytes(randomHex(32));
    const shieldInput = await shield.serialize(shieldPrivateKey, receiverViewingPublicKey);

    const erc20Token = new Contract(erc20Address, erc20Abi, ethersWallet) as unknown as TestERC20;
    const spender = RailgunVersionedSmartContracts.getShieldApprovalContract(
      txidVersion,
      chain,
    ).address;
    const balance = await erc20Token.balanceOf(ethersWallet.address);
    const approval = await erc20Token.approve.populateTransaction(spender, balance);
    const approvalTx = await sendTransactionWithLatestNonce(ethersWallet, approval);
    await approvalTx.wait();
    const allowance = await erc20Token.allowance(ethersWallet.address, spender);
    expect(allowance).to.equal(balance);
    expect(allowance > value).to.equal(true);

    // Create shield
    const shieldTx = await RailgunVersionedSmartContracts.generateShield(txidVersion, chain, [
      shieldInput,
    ]);

    // Send shield on chain
    const tx = await sendTransactionWithLatestNonce(ethersWallet, shieldTx);
    await Promise.all([
      tx.wait(),
      promiseTimeout(awaitScan(wallet, chain), 10000, 'Timed out scanning after test token shield'),
    ]);
    await wallet.refreshPOIsForTXIDVersion(chain, txidVersion, true);

    const balancePost = await erc20Token.balanceOf(ethersWallet.address);
    expect(balancePost).to.equal(balance - value);

    return shield;
  };

  const generateAndVerifyPOI = async (
    shield: ShieldNote,
    transactReceipt: TransactionReceipt,
    transactions: (TransactionStructV2 | TransactionStructV3)[],
    expectedProofInputs: POIEngineProofInputs,
    expectedListKey: string,
    expectedBlindedCommitmentsOut: string[],
  ) => {
    const proverSpy = sinon.spy(Prover.prototype, 'provePOI');

    try {
      const { blockNumber } = transactReceipt;

      let utxoBatchStartPosition = 1;

      if (isV2Test()) {
        // No railgunTxid yet - no POI submitted.
        await wallet.generatePOIsAllSentCommitmentsAndUnshieldEvents(chain, txidVersion);
        expect(proverSpy.getCalls()).to.deep.equal([]);

        const transactionsV2 = transactions as TransactionStructV2[];

        // eslint-disable-next-line no-restricted-syntax
        for (const transaction of transactionsV2) {
          const railgunTransaction: RailgunTransactionV2 = {
            version: RailgunTransactionVersion.V2,
            graphID: '0x01',
            commitments: transaction.commitments as string[],
            nullifiers: transaction.nullifiers as string[],
            boundParamsHash: nToHex(
              hashBoundParamsV2(transactionsV2[0].boundParams),
              ByteLength.UINT_256,
            ),
            unshield: {
              tokenData: shield.tokenData,
              toAddress: '0x1234',
              value: '0x01',
            },
            timestamp: 1_000_000,
            txid: strip0x(transactReceipt.hash),
            blockNumber,
            utxoTreeIn: 0,
            utxoTreeOut: 0,
            utxoBatchStartPositionOut: utxoBatchStartPosition,
            verificationHash: calculateRailgunTransactionVerificationHash(
              undefined,
              transaction.nullifiers[0] as string,
            ),
          };
          utxoBatchStartPosition += transaction.commitments.length;

          // eslint-disable-next-line no-await-in-loop
          await engine.handleNewRailgunTransactionsV2(txidVersion, chain, [railgunTransaction]);
        }
      }

      // To debug POI Status Info:
      // await wallet.refreshSpentPOIsAllSentCommitmentsAndUnshieldEvents(txidVersion, chain);
      // console.log(await wallet.getTXOsReceivedPOIStatusInfo(txidVersion, chain));
      // console.log(await wallet.getTXOsSpentPOIStatusInfo(txidVersion, chain));

      await wallet.generatePOIsAllSentCommitmentsAndUnshieldEvents(chain, txidVersion);

      const calls = proverSpy.getCalls();
      expect(calls.length).to.equal(1);
      const firstCallArgs = proverSpy.getCalls()[0].args;

      const proofInputsWithoutPOIMerkleroots = {
        ...firstCallArgs[0],
        poiMerkleroots: [],
        poiInMerkleProofPathElements: [],
      };
      const expectedProofInputsWithoutPOIMerkleroots = {
        ...expectedProofInputs,
        poiMerkleroots: [],
        poiInMerkleProofPathElements: [],
      };
      // inputs: POIEngineProofInputs
      expect(proofInputsWithoutPOIMerkleroots).to.deep.equal(
        expectedProofInputsWithoutPOIMerkleroots,
      );

      // listKey: string
      expect(firstCallArgs[1]).to.deep.equal(expectedListKey);
      // blindedCommitmentsOut: string[]
      expect(firstCallArgs[3]).to.deep.equal(expectedBlindedCommitmentsOut);

      proverSpy.restore();
    } catch (err) {
      proverSpy.restore();
      throw err;
    }
  };

  beforeEach(async () => {
    engine = RailgunEngine.initForWallet(
      'Test Wallet',
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

    transactNoteRandomStub = sinon
      .stub(TransactNote, 'getNoteRandom')
      .returns('123456789012345678901234567890ab'); // 16 bytes
    transactSenderRandomStub = sinon
      .stub(TransactNote, 'getSenderRandom')
      .returns('098765432109876543210987654321'); // 15 bytes
    aesGetRandomIVStub = sinon.stub(AES, 'getRandomIV').returns('abcdef1234567890abcdef1234567890');
    poiGetListsCanGenerateSpentPOIsStub = sinon
      .stub(POI, 'getListKeysCanGenerateSpentPOIs')
      .returns([MOCK_LIST_KEY]);

    // Activate POI list
    POI.init([MOCK_LIST_ACTIVE], new TestPOINodeInterface());

    // EngineDebug.init(console); // uncomment for logs
    provider = new PollingJsonRpcProvider(config.rpc, config.chainId);
    chain = {
      type: ChainType.EVM,
      id: Number((await provider.getNetwork()).chainId),
    };

    ethersWallet = getEthersWallet(config.mnemonic, provider);

    snapshot = (await provider.send('evm_snapshot', [])) as number;
    token = new Contract(erc20Address, erc20Abi, ethersWallet) as unknown as TestERC20;
    tokenAddress = formatToByteLength(erc20Address, ByteLength.UINT_256, false);

    nft = new Contract(nftAddress, erc721Abi, ethersWallet) as unknown as TestERC721;

    wallet = await engine.createWalletFromMnemonic(testEncryptionKey, testMnemonic);
    wallet2 = await engine.createWalletFromMnemonic(testEncryptionKey, testMnemonic, 1);
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
      { [TXIDVersion.V2_PoseidonMerkle]: 24, [TXIDVersion.V3_PoseidonMerkle]: 24 },
      0,
      !isV2Test(), // supportsV3
    );

    const balance = await token.balanceOf(ethersWallet.address);
    await token.approve(
      RailgunVersionedSmartContracts.getShieldApprovalContract(txidVersion, chain).address,
      balance,
    );

    await engine.scanHistory(chain);
    utxoMerkletree = engine.getUTXOMerkletree(txidVersion, chain);
    txidMerkletree = engine.getTXIDMerkletree(txidVersion, chain);
  });

  after(() => {
    POI.init([MOCK_LIST], new TestPOINodeInterface());
  });

  it('[HH] Should load existing wallets', async function run() {
    if (!isDefined(process.env.RUN_HARDHAT_TESTS)) {
      this.skip();
      return;
    }

    engine.unloadWallet(wallet.id);
    await engine.loadExistingWallet(testEncryptionKey, wallet.id);
    expect(engine.wallets[wallet.id].id).to.equal(wallet.id);
  });

  it('Should delete wallet', async () => {
    const walletForDeletion = await engine.createWalletFromMnemonic(
      testEncryptionKey,
      testMnemonic,
      5, // index
    );

    await engine.deleteWallet(walletForDeletion.id);
    await expect(
      engine.loadExistingWallet(testEncryptionKey, walletForDeletion.id),
    ).to.be.rejectedWith(
      'Key not found in database [000000000000000000000000000000000000000000000000000077616c6c6574:4e562d7b2e7cd11d98309031e1697540b51647fa67c9621f74bbd8ef45312443]',
    );
  });

  it('[HH] Should get balances after shield and rescan', async function run() {
    if (!isDefined(process.env.RUN_HARDHAT_TESTS)) {
      this.skip();
      return;
    }

    const shieldsPre = await engine.getAllShieldCommitments(txidVersion, chain, 0);
    expect(shieldsPre.length).to.equal(0);

    const commitment: LegacyGeneratedCommitment = {
      commitmentType: CommitmentType.LegacyGeneratedCommitment,
      hash: '14308448bcb19ecff96805fe3d00afecf82b18fa6f8297b42cf2aadc23f412e6',
      txid: '0x0543be0699a7eac2b75f23b33d435aacaeb0061f63e336230bcc7559a1852f33',
      timestamp: undefined,
      preImage: {
        npk: '0xc24ea33942c0fb9acce5dbada73137ad3257a6f2e1be8f309c1fe9afc5410a',
        token: {
          tokenType: TokenType.ERC20,
          tokenAddress: `0x${tokenAddress}`,
          tokenSubID: TOKEN_SUB_ID_NULL,
        },
        value: '9138822709a9fc231cba6',
      },
      encryptedRandom: [
        '0xb47a353e294711ff73cf086f97ee1ed29b853b67c353bc2371b87fe72c716cc6',
        '0x3d321af08b8fa7a8f70379407706b752',
      ],
      blockNumber: 0,
      utxoTree: 0,
      utxoIndex: 0,
    };

    // Override root validator
    utxoMerkletree.merklerootValidator = () => Promise.resolve(true);
    await utxoMerkletree.queueLeaves(0, 0, [commitment]);
    await utxoMerkletree.updateTreesFromWriteQueue();

    await wallet.scanBalances(txidVersion, chain, undefined);
    await wallet.refreshPOIsForTXIDVersion(chain, txidVersion, true);
    const balance = await wallet.getBalanceERC20(txidVersion, chain, tokenAddress, [
      WalletBalanceBucket.Spendable,
    ]);
    const value = hexToBigInt(commitment.preImage.value);
    expect(balance).to.equal(value);

    await wallet.fullRescanBalancesAllTXIDVersions(chain, undefined);
    await wallet.refreshPOIsForTXIDVersion(chain, txidVersion, true);
    const balanceRescan = await wallet.getBalanceERC20(txidVersion, chain, tokenAddress, [
      WalletBalanceBucket.Spendable,
    ]);
    expect(balanceRescan).to.equal(value);

    await wallet.clearScannedBalancesAllTXIDVersions(chain);
    const balanceClear = await wallet.getBalanceERC20(txidVersion, chain, tokenAddress, [
      WalletBalanceBucket.Spendable,
    ]);
    expect(balanceClear).to.equal(undefined);

    const shieldsPost = await engine.getAllShieldCommitments(txidVersion, chain, 0);
    expect(shieldsPost.length).to.equal(1);
  });

  it('[HH] With a creation block number provided, should show balance after shield and rescan', async function run() {
    if (!isDefined(process.env.RUN_HARDHAT_TESTS)) {
      this.skip();
      return;
    }

    // [[chain.type]: [[chain.id]: 0]]
    const creationBlockNumbers: number[][] = [];
    creationBlockNumbers[chain.type] = [];
    creationBlockNumbers[chain.type][chain.id] = 0;
    wallet.setCreationBlockNumbers(creationBlockNumbers);

    const commitment: LegacyGeneratedCommitment = {
      commitmentType: CommitmentType.LegacyGeneratedCommitment,
      hash: '14308448bcb19ecff96805fe3d00afecf82b18fa6f8297b42cf2aadc23f412e6',
      txid: '0x0543be0699a7eac2b75f23b33d435aacaeb0061f63e336230bcc7559a1852f33',
      timestamp: undefined,
      preImage: {
        npk: '0xc24ea33942c0fb9acce5dbada73137ad3257a6f2e1be8f309c1fe9afc5410a',
        token: {
          tokenType: TokenType.ERC20,
          tokenAddress: `0x${tokenAddress}`,
          tokenSubID: TOKEN_SUB_ID_NULL,
        },
        value: '9138822709a9fc231cba6',
      },
      encryptedRandom: [
        '0xb47a353e294711ff73cf086f97ee1ed29b853b67c353bc2371b87fe72c716cc6',
        '0x3d321af08b8fa7a8f70379407706b752',
      ],
      blockNumber: 0,
      utxoTree: 0,
      utxoIndex: 0,
    };
    // Override root validator
    utxoMerkletree.merklerootValidator = () => Promise.resolve(true);
    await utxoMerkletree.queueLeaves(0, 0, [commitment]);
    await utxoMerkletree.updateTreesFromWriteQueue();

    await wallet.scanBalances(txidVersion, chain, undefined);
    await wallet.refreshPOIsForTXIDVersion(chain, txidVersion, true);
    const balance = await wallet.getBalanceERC20(txidVersion, chain, tokenAddress, [
      WalletBalanceBucket.Spendable,
    ]);
    const value = hexToBigInt(commitment.preImage.value);
    expect(balance).to.equal(value);

    const walletDetails = await wallet.getWalletDetails(txidVersion, chain);
    expect(walletDetails.creationTree).to.equal(0);
    expect(walletDetails.creationTreeHeight).to.equal(0);

    await wallet.fullRescanBalancesAllTXIDVersions(chain, undefined);
    await wallet.refreshPOIsForTXIDVersion(chain, txidVersion, true);
    const balanceRescan = await wallet.getBalanceERC20(txidVersion, chain, tokenAddress, [
      WalletBalanceBucket.Spendable,
    ]);
    expect(balanceRescan).to.equal(value);

    await wallet.clearScannedBalancesAllTXIDVersions(chain);
    const balanceCleared = await wallet.getBalanceERC20(txidVersion, chain, tokenAddress, [
      WalletBalanceBucket.Spendable,
    ]);
    expect(balanceCleared).to.equal(undefined);

    const walletDetailsCleared = await wallet.getWalletDetails(txidVersion, chain);
    expect(walletDetailsCleared.creationTree).to.equal(0); // creationTree should not get reset on clear
    expect(walletDetailsCleared.creationTreeHeight).to.equal(0); // creationTreeHeight should not get reset on clear
    expect(walletDetailsCleared.treeScannedHeights.length).to.equal(0);
  });

  it.only(
    '[HH] Should shield, unshield w/ relayer and update balance, generate POIs, and pull formatted spend/receive transaction history',
    async function run() {
      if (!isDefined(process.env.RUN_HARDHAT_TESTS)) {
        this.skip();
        return;
      }

      const initialBalance = await wallet.getBalanceERC20(txidVersion, chain, tokenAddress, [
        WalletBalanceBucket.Spendable,
      ]);
      expect(initialBalance).to.equal(undefined);

      const address = wallet.getAddress(chain);
      const shield = await shieldTestTokens(address, BigInt(110000) * DECIMALS_18);

      const balance = await wallet.getBalanceERC20(txidVersion, chain, tokenAddress, [
        WalletBalanceBucket.Spendable,
      ]);
      expect(balance).to.equal(BigInt('109725000000000000000000'));

      const tokenData = getTokenDataERC20(tokenAddress);

      // Create transaction
      const transactionBatch = new TransactionBatch(chain);
      transactionBatch.addUnshieldData({
        toAddress: ethersWallet.address,
        value: BigInt(300) * DECIMALS_18,
        tokenData,
      });

      // Add output for mock Relayer
      transactionBatch.addOutput(
        TransactNote.createTransfer(
          wallet2.addressKeys,
          wallet.addressKeys,
          1n,
          tokenData,
          false, // showSenderAddressToRecipient
          OutputType.RelayerFee,
          undefined, // memoText
        ),
      );

      const { provedTransactions, preTransactionPOIsPerTxidLeafPerList } =
        await transactionBatch.generateTransactions(
          engine.prover,
          wallet,
          txidVersion,
          testEncryptionKey,
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          (progress: number, status: string) => {
            // console.log(progress, status);
          },
          true, // shouldGeneratePreTransactionPOIs
        );

      expect(Object.keys(preTransactionPOIsPerTxidLeafPerList).length).to.equal(1);
      expect(Object.keys(preTransactionPOIsPerTxidLeafPerList[MOCK_LIST_KEY]).length).to.equal(1);
      // TODO-V3: Add validation
      // expect(
      //   Object.keys(
      //     preTransactionPOIsPerTxidLeafPerList[MOCK_LIST_KEY][
      //       '02be5bff330011817852871274f0794a72787caab660d1c7e91b19fb7548fc3b'
      //     ].snarkProof,
      //   ),
      // ).to.deep.equal(['pi_a', 'pi_b', 'pi_c']);
      // // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // // @ts-expect-error
      // delete preTransactionPOIsPerTxidLeafPerList[MOCK_LIST_KEY][
      //   '02be5bff330011817852871274f0794a72787caab660d1c7e91b19fb7548fc3b'
      // ].snarkProof; // Snark proof values will change on each run.
      // expect(preTransactionPOIsPerTxidLeafPerList).to.deep.equal({
      //   [MOCK_LIST_KEY]: {
      //     '02be5bff330011817852871274f0794a72787caab660d1c7e91b19fb7548fc3b': {
      //       txidMerkleroot: '2e062605c1d675c0569af9aae453c585d53a8807a27bbd1706905e94fd972e8a',
      //       poiMerkleroots: ['284d03b4f4e545a9bf5259162f0d5103c1598c98217b84ec51589610d94f7071'],
      //       blindedCommitmentsOut: [
      //         '0x1441c994c1336075c8fc3687235e583fb5fa37e561184585bac31e3c029a46eb',
      //         '0x19f596cb35c783ce81498026696fae8f84de0937f68354ef29a08bf8c01e3f38',
      //       ],
      //       railgunTxidIfHasUnshield:
      //         '0x044da3f1c8aad9aa03ec818fdcc78eee3fdf1633b12e1ae0b6259853f6a01619',
      //     },
      //   },
      // });

      TestPOINodeInterface.overridePOIsListStatus = TXOPOIListStatus.Missing;

      const transact = await RailgunVersionedSmartContracts.generateTransact(
        txidVersion,
        chain,
        provedTransactions,
      );

      const transactTx = await sendTransactionWithLatestNonce(ethersWallet, transact);
      const transactReceipt = await transactTx.wait();

      if (!transactReceipt) {
        throw new Error('Failed to get transact receipt');
      }
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

      const shieldCommitment = nToHex(
        ShieldNote.getShieldNoteHash(
          shield.notePublicKey,
          shield.tokenHash,
          BigInt('109725000000000000000000'), // Value after fee
        ),
        ByteLength.UINT_256,
      );
      const blindedCommitmentIn = getBlindedCommitmentForShieldOrTransact(
        shieldCommitment,
        shield.notePublicKey,
        getGlobalTreePosition(0, 0),
      );
      expect(blindedCommitmentIn).to.equal(
        '0x1add5dfd0299e9dc5af6fdfc0d86c0aaad29f9f9ca61674f67d3d185e28802e2',
      );
      const poiMerkleProofs = [blindedCommitmentIn].map(createDummyMerkleProof);

      // Generate POI
      await generateAndVerifyPOI(
        shield,
        transactReceipt,
        provedTransactions,
        {
          anyRailgunTxidMerklerootAfterTransaction: isV2Test()
            ? '1acb66807dbec43a6010729175e1e8535498ee8df8bda6113a170a78eb735f03'
            : '01be6db56d02c02561efc7926b6d3d6b48cfe87bb56dfade3abe79d99beabea2', // Different boundParamsHash for V3 changes the railgun txid
          boundParamsHash: isV2Test()
            ? '0357cc6d8af845f638fb6e2bdbf482f466d11454a2e31c69d9b7ec69ce8cd873'
            : '13ee7db3dc2486d5bba597bdd4ec7e91b5fda820915a9d7fd4eda24220492ea5', // Different boundParamsHash for V3 changes the railgun txid
          commitmentsOut: [
            '0x2c5acad8f41f95a2795997353f6cdb0838493cd5604f8ddc1859a468233e15ac',
            '0x0c3f2e70ce66ea83593e26e7d13bd27a2a770920964786eaed95551b4ad51c4e',
            '0x05b93bb7d3cd650232f233868e9a420f08031029720f69df51dd04c6b7e5bd70',
          ],
          npksOut: [
            2800314339815912641032015410982157821342520564864853273055282304996901162130n,
            11534906831940272621633961845961479374350832633003460590301493842374950642962n,
          ],
          nullifiers: ['0x05802951a46d9e999151eb0eb9e4c7c1260b7ee88539011c207dc169c4dd17ee'],
          nullifyingKey:
            8368299126798249740586535953124199418524409103803955764525436743456763691384n,
          railgunTxidMerkleProofIndices:
            '0000000000000000000000000000000000000000000000000000000000000000',
          railgunTxidMerkleProofPathElements: [
            '0488f89b25bc7011eaf6a5edce71aeafb9fe706faa3c0a5cd9cbe868ae3b9ffc',
            '01c405064436affeae1fc8e30b2e417b4243bbb819adca3b55bb32efc3e43a4f',
            '0888d37652d10d1781db54b70af87b42a2916e87118f507218f9a42a58e85ed2',
            '183f531ead7217ebc316b4c02a2aad5ad87a1d56d4fb9ed81bf84f644549eaf5',
            '093c48f1ecedf2baec231f0af848a57a76c6cf05b290a396707972e1defd17df',
            '1437bb465994e0453357c17a676b9fdba554e215795ebc17ea5012770dfb77c7',
            '12359ef9572912b49f44556b8bbbfa69318955352f54cfa35cb0f41309ed445a',
            '2dc656dadc82cf7a4707786f4d682b0f130b6515f7927bde48214d37ec25a46c',
            '2500bdfc1592791583acefd050bc439a87f1d8e8697eb773e8e69b44973e6fdc',
            '244ae3b19397e842778b254cd15c037ed49190141b288ff10eb1390b34dc2c31',
            '0ca2b107491c8ca6e5f7e22403ea8529c1e349a1057b8713e09ca9f5b9294d46',
            '18593c75a9e42af27b5e5b56b99c4c6a5d7e7d6e362f00c8e3f69aeebce52313',
            '17aca915b237b04f873518947a1f440f0c1477a6ac79299b3be46858137d4bfb',
            '2726c22ad3d9e23414887e8233ee83cc51603f58c48a9c9e33cb1f306d4365c0',
            '08c5bd0f85cef2f8c3c1412a2b69ee943c6925ecf79798bb2b84e1b76d26871f',
            '27f7c465045e0a4d8bec7c13e41d793734c50006ca08920732ce8c3096261435',
          ],
          randomsIn: ['67c600e777b86d3a1e72a53092e9fe85'],
          spendingPublicKey: [
            15684838006997671713939066069845237677934334329285343229142447933587909549584n,
            11878614856120328179849762231924033298788609151532558727282528569229552954628n,
          ],
          token: '0000000000000000000000009fe46736679d2d9a65f0992f2272de9f3c7fa6e0',
          utxoPositionsIn: [0],
          utxoTreeIn: 0,
          utxoBatchGlobalStartPositionOut: 1n,
          railgunTxidIfHasUnshield: isV2Test()
            ? '0x0fefd169291c1deec2affa8dcbfbee4a4bbeddfc3b5723c031665ba631725c62'
            : '0x13a073d73a7b46faed5b24331762600498dc3e1510960ebb942bc7d037d348ac', // Different boundParamsHash for V3 changes the railgun txid
          valuesIn: [109725000000000000000000n],
          valuesOut: [1n, 109424999999999999999999n],
          poiMerkleroots: poiMerkleProofs.map((proof) => proof.root),
          poiInMerkleProofIndices: poiMerkleProofs.map((proof) => proof.indices),
          poiInMerkleProofPathElements: poiMerkleProofs.map((proof) => proof.elements),
        },
        MOCK_LIST_KEY,
        [
          '0x009496b785d48f34983bd248bbf0c0b12bba749689c017d9d016493b419f0571',
          '0x2d1e5b80789879000d35b3bf7028247dc62c0dbabf736264f9d71a6421f008da',
        ],
      );

      TestPOINodeInterface.overridePOIsListStatus = TXOPOIListStatus.Valid;
      await wallet.refreshPOIsForTXIDVersion(chain, txidVersion, true);
      await wallet2.refreshPOIsForTXIDVersion(chain, txidVersion, true);

      // BALANCE = shielded amount - 300(decimals) - 1
      const newBalance = await wallet.getBalanceERC20(txidVersion, chain, tokenAddress, [
        WalletBalanceBucket.Spendable,
      ]);
      expect(newBalance).to.equal(109424999999999999999999n, 'Failed to receive expected balance');

      const newBalance2 = await wallet2.getBalanceERC20(txidVersion, chain, tokenAddress, [
        WalletBalanceBucket.Spendable,
      ]);
      expect(newBalance2).to.equal(BigInt(1));

      // check if relayer wallet finds valid POI for received commitment
      const hasValidRelayerPOI = await wallet2.receiveCommitmentHasValidPOI(
        txidVersion,
        chain,
        '0x2c5acad8f41f95a2795997353f6cdb0838493cd5604f8ddc1859a468233e15ac',
      );
      expect(hasValidRelayerPOI).to.equal(true);

      // check the transactions log
      const history = await wallet.getTransactionHistory(chain, undefined);
      expect(history.length).to.equal(2);

      const tokenFormatted = formatToByteLength(tokenAddress, ByteLength.UINT_256, false);

      // Make sure nullifier events map to completed txid.
      const nullifiers = provedTransactions
        .map((transaction) => transaction.nullifiers)
        .flat() as string[];
      const completedTxid = await engine.getCompletedTxidFromNullifiers(
        txidVersion,
        chain,
        nullifiers,
      );
      expect(completedTxid).to.equal(transactTx.hash);

      // Check first output: Shield (receive only).
      expect(history[0].receiveTokenAmounts).deep.eq([
        {
          tokenData: getTokenDataERC20(tokenAddress),
          tokenHash: tokenFormatted,
          amount: BigInt('109725000000000000000000'),
          memoText: undefined,
          senderAddress: undefined,
          shieldFee: '275000000000000000000',
          balanceBucket: WalletBalanceBucket.Spent,
          hasValidPOIForActiveLists: true,
        },
      ]);
      expect(history[0].transferTokenAmounts).deep.eq([]);
      expect(history[0].relayerFeeTokenAmount).eq(undefined);
      expect(history[0].changeTokenAmounts).deep.eq([]);
      expect(history[0].unshieldTokenAmounts).deep.eq([]);

      // Check second output: Unshield (relayer fee + change).
      // NOTE: No receive token amounts should be logged by history.

      // TODO: The stubs for sinon random cause this expectation to fail:
      // expect(history[1].receiveTokenAmounts).deep.eq(
      //   [],
      //   "Receive amount should be filtered out - it's the same as change output.",
      // );

      expect(history[1].transferTokenAmounts).deep.eq([]);
      expect(history[1].relayerFeeTokenAmount).deep.eq({
        tokenData: getTokenDataERC20(tokenAddress),
        tokenHash: tokenFormatted,
        amount: BigInt(1),
        outputType: OutputType.RelayerFee,
        walletSource: 'test wallet',
        memoText: undefined,
        hasValidPOIForActiveLists: true,
      });
      expect(history[1].changeTokenAmounts).deep.eq([
        {
          tokenData: getTokenDataERC20(tokenAddress),
          tokenHash: tokenFormatted,
          amount: BigInt('109424999999999999999999'),
          outputType: OutputType.Change,
          walletSource: 'test wallet',
          memoText: undefined,
          hasValidPOIForActiveLists: true,
        },
      ]);
      expect(history[1].unshieldTokenAmounts).deep.eq([
        {
          tokenData: getTokenDataERC20(tokenAddress),
          tokenHash: tokenFormatted,
          amount: BigInt('299250000000000000000'), // 300 minus fee
          recipientAddress: isV2Test() ? ethersWallet.address : ethersWallet.address.toLowerCase(),
          memoText: undefined,
          senderAddress: undefined,
          unshieldFee: '750000000000000000',
          hasValidPOIForActiveLists: true,
        },
      ]);

      // Check that no history exists for a high starting block.
      const historyHighStartingBlock = await wallet.getTransactionHistory(chain, 10000000);
      expect(historyHighStartingBlock.length).to.equal(0);
    },
  ).timeout(90000);

  it.only(
    '[HH] Should shield, max-unshield without relayer, generate POIs, and pull formatted spend/receive transaction history',
    async function run() {
      if (!isDefined(process.env.RUN_HARDHAT_TESTS)) {
        this.skip();
        return;
      }

      const initialBalance = await wallet.getBalanceERC20(txidVersion, chain, tokenAddress, [
        WalletBalanceBucket.Spendable,
      ]);
      expect(initialBalance).to.equal(undefined);

      const address = wallet.getAddress(chain);
      const shield = await shieldTestTokens(address, BigInt(110000) * DECIMALS_18);

      const balance = await wallet.getBalanceERC20(txidVersion, chain, tokenAddress, [
        WalletBalanceBucket.Spendable,
      ]);
      expect(balance).to.equal(BigInt('109725000000000000000000'));

      const tokenData = getTokenDataERC20(tokenAddress);

      // Create transaction
      const transactionBatch = new TransactionBatch(chain);
      transactionBatch.addUnshieldData({
        toAddress: ethersWallet.address,
        value: BigInt('109725000000000000000000'),
        tokenData,
      });

      const { provedTransactions } = await transactionBatch.generateTransactions(
        engine.prover,
        wallet,
        txidVersion,
        testEncryptionKey,
        () => {},
        true, // shouldGeneratePreTransactionPOIs
      );
      expect(provedTransactions.length).to.equal(1);
      expect(provedTransactions[0].nullifiers.length).to.equal(1);
      expect(provedTransactions[0].commitments.length).to.equal(1);

      TestPOINodeInterface.overridePOIsListStatus = TXOPOIListStatus.Missing;

      const transact = await RailgunVersionedSmartContracts.generateTransact(
        txidVersion,
        chain,
        provedTransactions,
      );

      const transactTx = await sendTransactionWithLatestNonce(ethersWallet, transact);
      const [transactReceipt] = await Promise.all([
        transactTx.wait(),
        promiseTimeout(awaitScan(wallet, chain), 15000, 'Timed out wallet1 scan'),
      ]);
      if (!transactReceipt) {
        throw new Error('No transaction receipt');
      }

      const newBalance = await wallet.getBalanceERC20(txidVersion, chain, tokenAddress, [
        WalletBalanceBucket.Spendable,
      ]);
      expect(newBalance).to.equal(0n, 'Failed to receive expected balance');

      const shieldCommitment = nToHex(
        ShieldNote.getShieldNoteHash(
          shield.notePublicKey,
          shield.tokenHash,
          BigInt('109725000000000000000000'), // Value after fee
        ),
        ByteLength.UINT_256,
      );
      const blindedCommitmentIn = getBlindedCommitmentForShieldOrTransact(
        shieldCommitment,
        shield.notePublicKey,
        getGlobalTreePosition(0, 0),
      );
      expect(blindedCommitmentIn).to.equal(
        '0x1add5dfd0299e9dc5af6fdfc0d86c0aaad29f9f9ca61674f67d3d185e28802e2',
      );
      const poiMerkleProofs = [blindedCommitmentIn].map(createDummyMerkleProof);

      // Generate POI
      await generateAndVerifyPOI(
        shield,
        transactReceipt,
        provedTransactions,
        {
          anyRailgunTxidMerklerootAfterTransaction: isV2Test()
            ? '185cc7d2c8e1c3954ee5421a6589cd05036708ff059b97b9c10e0261ad7d6875'
            : '1f16299e8b56dd3f3286d406c16942204af97328f423241daa1ae3429d3fac50', // Different boundParamsHash for V3 changes the railgun txid
          boundParamsHash: isV2Test()
            ? '0a4e7bed8287c629fd064665543dc71fdc09b0ab9df7d556f24a1f2f9f018dc7'
            : '1d2cb105439b5a5bb1b5b1a711242d0ab5e0acb71f36bc99ab6a25ab6a619712', // Different boundParamsHash for V3
          commitmentsOut: ['0x007aaf0cbee05066820873170e293e44df6766c29da69ac46fd05d4ff2c0a225'],
          npksOut: [],
          nullifiers: ['0x05802951a46d9e999151eb0eb9e4c7c1260b7ee88539011c207dc169c4dd17ee'],
          nullifyingKey:
            8368299126798249740586535953124199418524409103803955764525436743456763691384n,
          railgunTxidMerkleProofIndices:
            '0000000000000000000000000000000000000000000000000000000000000000',
          railgunTxidMerkleProofPathElements: [
            '0488f89b25bc7011eaf6a5edce71aeafb9fe706faa3c0a5cd9cbe868ae3b9ffc',
            '01c405064436affeae1fc8e30b2e417b4243bbb819adca3b55bb32efc3e43a4f',
            '0888d37652d10d1781db54b70af87b42a2916e87118f507218f9a42a58e85ed2',
            '183f531ead7217ebc316b4c02a2aad5ad87a1d56d4fb9ed81bf84f644549eaf5',
            '093c48f1ecedf2baec231f0af848a57a76c6cf05b290a396707972e1defd17df',
            '1437bb465994e0453357c17a676b9fdba554e215795ebc17ea5012770dfb77c7',
            '12359ef9572912b49f44556b8bbbfa69318955352f54cfa35cb0f41309ed445a',
            '2dc656dadc82cf7a4707786f4d682b0f130b6515f7927bde48214d37ec25a46c',
            '2500bdfc1592791583acefd050bc439a87f1d8e8697eb773e8e69b44973e6fdc',
            '244ae3b19397e842778b254cd15c037ed49190141b288ff10eb1390b34dc2c31',
            '0ca2b107491c8ca6e5f7e22403ea8529c1e349a1057b8713e09ca9f5b9294d46',
            '18593c75a9e42af27b5e5b56b99c4c6a5d7e7d6e362f00c8e3f69aeebce52313',
            '17aca915b237b04f873518947a1f440f0c1477a6ac79299b3be46858137d4bfb',
            '2726c22ad3d9e23414887e8233ee83cc51603f58c48a9c9e33cb1f306d4365c0',
            '08c5bd0f85cef2f8c3c1412a2b69ee943c6925ecf79798bb2b84e1b76d26871f',
            '27f7c465045e0a4d8bec7c13e41d793734c50006ca08920732ce8c3096261435',
          ],
          randomsIn: ['67c600e777b86d3a1e72a53092e9fe85'],
          spendingPublicKey: [
            15684838006997671713939066069845237677934334329285343229142447933587909549584n,
            11878614856120328179849762231924033298788609151532558727282528569229552954628n,
          ],
          token: '0000000000000000000000009fe46736679d2d9a65f0992f2272de9f3c7fa6e0',
          utxoPositionsIn: [0],
          utxoTreeIn: 0,
          utxoBatchGlobalStartPositionOut: 1n,
          railgunTxidIfHasUnshield: isV2Test()
            ? '0x018d6143a22e09c18ba2a713985bd1e43a095605d5d259d72d96da2cca604f3e'
            : '0x20c686c39f10a86713d553c1d8acef56508a06f15acad29562d6b8dac9138ac7', // Different boundParamsHash for V3 changes the railgun txid
          valuesIn: [109725000000000000000000n],
          valuesOut: [],

          poiMerkleroots: poiMerkleProofs.map((proof) => proof.root),
          poiInMerkleProofIndices: poiMerkleProofs.map((proof) => proof.indices),
          poiInMerkleProofPathElements: poiMerkleProofs.map((proof) => proof.elements),
        },
        MOCK_LIST_KEY,
        [],
      );

      // check the transactions log
      const history = await wallet.getTransactionHistory(chain, undefined);
      expect(history.length).to.equal(2);

      const tokenFormatted = formatToByteLength(tokenAddress, ByteLength.UINT_256, false);

      // Make sure nullifier events map to completed txid.
      const nullifiers = provedTransactions
        .map((transaction) => transaction.nullifiers)
        .flat() as string[];
      const completedTxid = await engine.getCompletedTxidFromNullifiers(
        txidVersion,
        chain,
        nullifiers,
      );
      expect(completedTxid).to.equal(transactTx.hash);

      // Check first output: Shield (receive only).
      expect(history[0].receiveTokenAmounts).deep.eq([
        {
          tokenData: getTokenDataERC20(tokenAddress),
          tokenHash: tokenFormatted,
          amount: BigInt('109725000000000000000000'),
          memoText: undefined,
          senderAddress: undefined,
          shieldFee: '275000000000000000000',
          balanceBucket: WalletBalanceBucket.Spent,
          hasValidPOIForActiveLists: true,
        },
      ]);
      expect(history[0].transferTokenAmounts).deep.eq([]);
      expect(history[0].relayerFeeTokenAmount).eq(undefined);
      expect(history[0].changeTokenAmounts).deep.eq([]);
      expect(history[0].unshieldTokenAmounts).deep.eq([]);

      // Check second output: Unshield (relayer fee + change).
      // NOTE: No receive token amounts should be logged by history.
      expect(history[1].receiveTokenAmounts).deep.eq(
        [],
        "Receive amount should be filtered out - it's the same as change output.",
      );
      expect(history[1].transferTokenAmounts).deep.eq([]);
      expect(history[1].relayerFeeTokenAmount).eq(undefined);
      expect(history[1].changeTokenAmounts).deep.eq([]); // No change output
      expect(history[1].unshieldTokenAmounts).deep.eq([
        {
          tokenData: getTokenDataERC20(tokenAddress),
          tokenHash: tokenFormatted,
          amount: BigInt('109450687500000000000000'), // balance minus fee
          recipientAddress: isV2Test() ? ethersWallet.address : ethersWallet.address.toLowerCase(),
          memoText: undefined,
          senderAddress: undefined,
          unshieldFee: '274312500000000000000',
          hasValidPOIForActiveLists: false,
        },
      ]);
    },
  ).timeout(120000);

  it('[HH] Should shield, transfer and update balance, and pull formatted spend/receive transaction history', async function run() {
    if (!isDefined(process.env.RUN_HARDHAT_TESTS)) {
      this.skip();
      return;
    }

    const initialBalance = await wallet.getBalanceERC20(txidVersion, chain, tokenAddress, [
      WalletBalanceBucket.Spendable,
    ]);
    expect(initialBalance).to.equal(undefined);

    const address = wallet.getAddress(chain);
    await shieldTestTokens(address, BigInt(110000) * DECIMALS_18);

    const balance = await wallet.getBalanceERC20(txidVersion, chain, tokenAddress, [
      WalletBalanceBucket.Spendable,
    ]);
    expect(balance).to.equal(BigInt('109725000000000000000000'));

    // Create transaction
    const transactionBatch = new TransactionBatch(chain);

    const memoText =
      'A really long memo with emojis 😐 👩🏾‍🔧 and other text, in order to test a major memo for a real live production use case.';

    const tokenData = getTokenDataERC20(tokenAddress);

    // Add output for Transfer
    transactionBatch.addOutput(
      TransactNote.createTransfer(
        wallet2.addressKeys,
        wallet.addressKeys,
        10n,
        tokenData,
        true, // showSenderAddressToRecipient
        OutputType.Transfer,
        memoText,
      ),
    );

    const relayerMemoText = 'A short memo with only 32 chars.';

    // Add output for mock Relayer
    transactionBatch.addOutput(
      TransactNote.createTransfer(
        wallet2.addressKeys,
        wallet.addressKeys,
        1n,
        tokenData,
        false, // showSenderAddressToRecipient
        OutputType.RelayerFee,
        relayerMemoText, // memoText
      ),
    );

    TestPOINodeInterface.overridePOIsListStatus = TXOPOIListStatus.Missing;

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

    const transactTx = await sendTransactionWithLatestNonce(ethersWallet, transact);
    await transactTx.wait();
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
    TestPOINodeInterface.overridePOIsListStatus = TXOPOIListStatus.Valid;
    await wallet.refreshPOIsForTXIDVersion(chain, txidVersion, true);
    await wallet2.refreshPOIsForAllTXIDVersions(chain, true);

    // BALANCE = shielded amount - 300(decimals) - 1
    const newBalance = await wallet.getBalanceERC20(txidVersion, chain, tokenAddress, [
      WalletBalanceBucket.Spendable,
    ]);
    expect(newBalance).to.equal(109724999999999999999989n, 'Failed to receive expected balance');

    const newBalance2 = await wallet2.getBalanceERC20(txidVersion, chain, tokenAddress, [
      WalletBalanceBucket.Spendable,
    ]);
    expect(newBalance2).to.equal(BigInt(11));

    // check the transactions log
    const history = await wallet.getTransactionHistory(chain, undefined);
    expect(history.length).to.equal(2);

    const tokenFormatted = formatToByteLength(tokenAddress, ByteLength.UINT_256, false);

    // Check first output: Shield (receive only).
    expect(history[0].receiveTokenAmounts).deep.eq([
      {
        tokenData: getTokenDataERC20(tokenAddress),
        tokenHash: tokenFormatted,
        amount: BigInt('109725000000000000000000'),
        memoText: undefined,
        senderAddress: undefined,
        shieldFee: '275000000000000000000',
        balanceBucket: WalletBalanceBucket.Spent,
        hasValidPOIForActiveLists: true,
      },
    ]);
    expect(history[0].transferTokenAmounts).deep.eq([]);
    expect(history[0].relayerFeeTokenAmount).eq(undefined);
    expect(history[0].changeTokenAmounts).deep.eq([]);
    expect(history[0].unshieldTokenAmounts).deep.eq([]);

    // Check second output: Unshield (relayer fee + change).
    // NOTE: No receive token amounts should be logged by history.
    expect(history[1].receiveTokenAmounts).deep.eq(
      [],
      "Receive amount should be filtered out - it's the same as change output.",
    );
    expect(history[1].transferTokenAmounts).deep.eq([
      {
        tokenData: getTokenDataERC20(tokenAddress),
        tokenHash: tokenFormatted,
        amount: BigInt(10),
        outputType: OutputType.Transfer,
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        walletSource: 'test wallet',
        recipientAddress: wallet2.getAddress(),
        memoText,
        // eslint-disable-next-line no-unneeded-ternary
        hasValidPOIForActiveLists: true,
      },
    ]);
    expect(history[1].relayerFeeTokenAmount).deep.eq({
      tokenData: getTokenDataERC20(tokenAddress),
      tokenHash: tokenFormatted,
      amount: BigInt(1),
      outputType: OutputType.RelayerFee,
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      walletSource: 'test wallet',
      memoText: relayerMemoText,
      // eslint-disable-next-line no-unneeded-ternary
      hasValidPOIForActiveLists: true,
    });
    expect(history[1].changeTokenAmounts).deep.eq([
      {
        tokenData: getTokenDataERC20(tokenAddress),
        tokenHash: tokenFormatted,
        amount: BigInt('109724999999999999999989'),
        outputType: OutputType.Change,
        walletSource: 'test wallet',
        memoText: undefined,
        // eslint-disable-next-line no-unneeded-ternary
        hasValidPOIForActiveLists: true,
      },
    ]);
    expect(history[1].unshieldTokenAmounts).deep.eq([]);

    const history2 = await wallet2.getTransactionHistory(chain, undefined);
    expect(history2.length).to.equal(1);
    expect(history2[0].receiveTokenAmounts).deep.eq([
      {
        tokenData: getTokenDataERC20(tokenAddress),
        tokenHash: tokenFormatted,
        amount: BigInt(10),
        memoText,
        senderAddress: wallet.getAddress(),
        shieldFee: undefined,
        balanceBucket: WalletBalanceBucket.Spendable,
        hasValidPOIForActiveLists: true,
      },
      {
        tokenData: getTokenDataERC20(tokenAddress),
        tokenHash: tokenFormatted,
        amount: BigInt(1),
        memoText: relayerMemoText,
        senderAddress: undefined,
        shieldFee: undefined,
        balanceBucket: WalletBalanceBucket.Spendable,
        hasValidPOIForActiveLists: true,
      },
    ]);
    expect(history2[0].transferTokenAmounts).deep.eq([]);
    expect(history2[0].relayerFeeTokenAmount).eq(undefined);
    expect(history2[0].changeTokenAmounts).deep.eq([]);
    expect(history2[0].unshieldTokenAmounts).deep.eq([]);
  }).timeout(90000);

  it('[HH] Should shield NFTs, transfer & unshield NFTs, and pull formatted spend/receive NFT history', async function run() {
    if (!isDefined(process.env.RUN_HARDHAT_TESTS)) {
      this.skip();
      return;
    }

    // Mint NFTs
    await mintNFTsID01ForTest(nft, ethersWallet);

    // Approve shields
    const approval = await nft.setApprovalForAll(
      RailgunVersionedSmartContracts.getShieldApprovalContract(txidVersion, chain).address,
      true,
    );
    await approval.wait();

    // Shield first NFT
    await shieldNFTForTest(txidVersion, wallet, ethersWallet, chain, random, nftAddress, '1');

    const history = await wallet.getTransactionHistory(chain, undefined);
    expect(history.length).to.equal(1);

    const tokenDataNFT0 = getTokenDataNFT(nftAddress, TokenType.ERC721, BigInt(0).toString());
    const tokenHashNFT0 = getTokenDataHash(tokenDataNFT0);

    const tokenDataNFT1 = getTokenDataNFT(nftAddress, TokenType.ERC721, BigInt(1).toString());
    const tokenHashNFT1 = getTokenDataHash(tokenDataNFT1);

    // Check first output: Shield (receive only).
    expect(history[0].receiveTokenAmounts).deep.eq([
      {
        tokenData: tokenDataNFT1,
        tokenHash: tokenHashNFT1,
        amount: BigInt(1),
        memoText: undefined,
        senderAddress: undefined,
        shieldFee: isV2Test() ? undefined : '0',
        balanceBucket: WalletBalanceBucket.Spendable,
        hasValidPOIForActiveLists: true,
      },
    ]);
    expect(history[0].transferTokenAmounts).deep.eq([]);
    expect(history[0].relayerFeeTokenAmount).eq(undefined);
    expect(history[0].changeTokenAmounts).deep.eq([]);
    expect(history[0].unshieldTokenAmounts).deep.eq([]);

    // Shield another NFT.
    const shield2 = await shieldNFTForTest(
      txidVersion,
      wallet,
      ethersWallet,
      chain,
      random,
      nftAddress,
      '0',
    );

    // Shield tokens for Relayer Fee.
    await shieldTestTokens(wallet.getAddress(), BigInt(110000) * DECIMALS_18);

    // Transfer NFT to another wallet.

    // Create transaction
    const transactionBatch = new TransactionBatch(chain);

    const memoText =
      'A really long memo with emojis 😐 👩🏾‍🔧 and other text, in order to test a major memo for a real live production use case.';

    // Add output for Transfer
    transactionBatch.addOutput(
      TransactNote.createERC721Transfer(
        wallet2.addressKeys,
        wallet.addressKeys,
        tokenDataNFT1,
        true, // showSenderAddressToRecipient
        memoText,
      ),
    );

    // Add output for NFT Unshield
    const unshieldNote = new UnshieldNoteNFT(
      ethersWallet.address,
      shield2.tokenData as NFTTokenData,
    );
    transactionBatch.addUnshieldData(unshieldNote.unshieldData);

    const relayerMemoText = 'A short memo with only 32 chars.';

    const tokenDataRelayerFee = getTokenDataERC20(erc20Address);

    // Add output for mock Relayer
    transactionBatch.addOutput(
      TransactNote.createTransfer(
        wallet2.addressKeys,
        wallet.addressKeys,
        20n,
        tokenDataRelayerFee,
        false, // showSenderAddressToRecipient
        OutputType.RelayerFee,
        relayerMemoText, // memoText
      ),
    );

    const { provedTransactions, preTransactionPOIsPerTxidLeafPerList } =
      await transactionBatch.generateTransactions(
        engine.prover,
        wallet,
        txidVersion,
        testEncryptionKey,
        () => {},
        true, // shouldGeneratePreTransactionPOIs
      );

    expect(Object.keys(preTransactionPOIsPerTxidLeafPerList).length).to.equal(1);
    expect(Object.keys(preTransactionPOIsPerTxidLeafPerList[MOCK_LIST_KEY]).length).to.equal(3);

    const transact = await railgunSmartWalletContract.transact(txidVersion,
      chain, provedTransactions);

    const transactTx = await sendTransactionWithLatestNonce(ethersWallet, transact);

    await transactTx.wait();
    if (isV2Test()) {
      await Promise.all([
        promiseTimeout(awaitMultipleScans(wallet, chain, 4), 15000, 'Timed out wallet1 scan'),
        promiseTimeout(awaitMultipleScans(wallet2, chain, 2), 15000, 'Timed out wallet2 scan'),
      ]);
    } else {
      await Promise.all([
        promiseTimeout(awaitScan(wallet, chain), 15000, 'Timed out wallet1 scan'),
        promiseTimeout(awaitScan(wallet2, chain), 15000, 'Timed out wallet2 scan'),
      ]);
    }
    await wallet.refreshPOIsForTXIDVersion(chain, txidVersion, true);
    await wallet2.refreshPOIsForAllTXIDVersions(chain, true);

    const historyAfterTransfer = await wallet.getTransactionHistory(chain, undefined);
    expect(historyAfterTransfer.length).to.equal(4);

    const relayerFeeTokenData = getTokenDataERC20(tokenAddress);
    const relayerFeeTokenHash = getTokenDataHash(relayerFeeTokenData);

    expect(historyAfterTransfer.length).to.equal(4, 'Expected 4 history records');
    expect(historyAfterTransfer[3].transferTokenAmounts.length).to.equal(1, 'Expected 1 transfer');

    expect(historyAfterTransfer[3].receiveTokenAmounts).deep.eq([]);
    expect(historyAfterTransfer[3].transferTokenAmounts).deep.eq([
      {
        tokenData: tokenDataNFT1,
        tokenHash: tokenHashNFT1,
        amount: BigInt(1),
        outputType: OutputType.Transfer,
        walletSource: 'test wallet',
        recipientAddress: wallet2.getAddress(),
        memoText,
        hasValidPOIForActiveLists: true,
      },
    ]);
    expect(historyAfterTransfer[3].relayerFeeTokenAmount).deep.eq({
      tokenData: relayerFeeTokenData,
      tokenHash: relayerFeeTokenHash,
      amount: BigInt(20),
      outputType: OutputType.RelayerFee,
      walletSource: 'test wallet',
      memoText: relayerMemoText,
      hasValidPOIForActiveLists: true,
    });
    expect(historyAfterTransfer[3].changeTokenAmounts).deep.eq([
      {
        tokenData: relayerFeeTokenData,
        tokenHash: relayerFeeTokenHash,
        amount: BigInt('109724999999999999999980'),
        outputType: OutputType.Change,
        walletSource: 'test wallet',
        memoText: undefined,
        hasValidPOIForActiveLists: true,
      },
    ]);
    expect(historyAfterTransfer[3].unshieldTokenAmounts).deep.eq([
      {
        tokenData: tokenDataNFT0,
        tokenHash: tokenHashNFT0,
        amount: BigInt(1),
        recipientAddress: isV2Test() ? ethersWallet.address : ethersWallet.address.toLowerCase(),
        memoText: undefined,
        senderAddress: undefined,
        unshieldFee: '0',
        // eslint-disable-next-line no-unneeded-ternary
        hasValidPOIForActiveLists: isV2Test() ? false : true,
      },
    ]);
  }).timeout(120000);

  it('Should set/get last synced block', async () => {
    const chainForSyncedBlock = {
      type: ChainType.EVM,
      id: 10010,
    };
    let lastSyncedBlock = await engine.getLastSyncedBlock(chainForSyncedBlock);
    expect(lastSyncedBlock).to.equal(undefined);
    await engine.setLastSyncedBlock(chainForSyncedBlock, 100);
    lastSyncedBlock = await engine.getLastSyncedBlock(chainForSyncedBlock);
    expect(lastSyncedBlock).to.equal(100);
    await engine.setLastSyncedBlock(chainForSyncedBlock, 100000);
    lastSyncedBlock = await engine.getLastSyncedBlock(chainForSyncedBlock);
    expect(lastSyncedBlock).to.equal(100000);
  });

  it('Should set/get utxo merkletree history version', async () => {
    const chainForSyncedBlock = {
      type: ChainType.EVM,
      id: 10010,
    };
    let lastSyncedBlock = await engine.getLastSyncedBlock(chainForSyncedBlock);
    expect(lastSyncedBlock).to.equal(undefined);
    await engine.setUTXOMerkletreeHistoryVersion(chainForSyncedBlock, 100);
    lastSyncedBlock = await engine.getUTXOMerkletreeHistoryVersion(chainForSyncedBlock);
    expect(lastSyncedBlock).to.equal(100);
    await engine.setUTXOMerkletreeHistoryVersion(chainForSyncedBlock, 100000);
    lastSyncedBlock = await engine.getUTXOMerkletreeHistoryVersion(chainForSyncedBlock);
    expect(lastSyncedBlock).to.equal(100000);
  });

  it('Should set/get txid merkletree history version', async () => {
    const chainForSyncedBlock = {
      type: ChainType.EVM,
      id: 10010,
    };
    let lastSyncedBlock = await engine.getLastSyncedBlock(chainForSyncedBlock);
    expect(lastSyncedBlock).to.equal(undefined);
    await engine.setTxidMerkletreeHistoryVersion(chainForSyncedBlock, 100);
    lastSyncedBlock = await engine.getTxidMerkletreeHistoryVersion(chainForSyncedBlock);
    expect(lastSyncedBlock).to.equal(100);
    await engine.setTxidMerkletreeHistoryVersion(chainForSyncedBlock, 100000);
    lastSyncedBlock = await engine.getTxidMerkletreeHistoryVersion(chainForSyncedBlock);
    expect(lastSyncedBlock).to.equal(100000);
  });

  afterEach(async () => {
    if (!isDefined(process.env.RUN_HARDHAT_TESTS)) {
      return;
    }

    await provider.send('evm_revert', [snapshot]);

    await txidMerkletree?.clearDataForMerkletree();

    transactNoteRandomStub?.restore();
    transactSenderRandomStub?.restore();
    aesGetRandomIVStub?.restore();
    poiGetListsCanGenerateSpentPOIsStub?.restore();

    await engine?.unload();
  });
});
