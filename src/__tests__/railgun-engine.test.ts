import chai, { expect } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { Contract, JsonRpcProvider, Wallet } from 'ethers';
import memdown from 'memdown';
import { groth16 } from 'snarkjs';
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
  mockQuickSync,
  sendTransactionWithLatestNonce,
  testArtifactsGetter,
} from '../test/helper.test';
import { ShieldNoteERC20 } from '../note/erc20/shield-note-erc20';
import { MerkleTree } from '../merkletree/merkletree';
import { ByteLength, formatToByteLength, hexToBigInt, hexToBytes, randomHex } from '../utils/bytes';
import { RailgunSmartWalletContract } from '../contracts/railgun-smart-wallet/railgun-smart-wallet';
import {
  CommitmentType,
  LegacyGeneratedCommitment,
  NFTTokenData,
  OutputType,
  TokenType,
} from '../models/formatted-types';
import { Groth16 } from '../prover/prover';
import { TestERC20 } from '../test/abi/typechain/TestERC20';
import { TestERC721 } from '../test/abi/typechain/TestERC721';
import { promiseTimeout } from '../utils/promises';
import { Chain, ChainType } from '../models/engine-types';
import { TransactNote } from '../note/transact-note';
import { MEMO_SENDER_RANDOM_NULL, TOKEN_SUB_ID_NULL } from '../models/transaction-constants';
import { getTokenDataERC20, getTokenDataHash, getTokenDataNFT } from '../note/note-util';
import { TransactionBatch } from '../transaction/transaction-batch';
import { UnshieldNoteNFT } from '../note/nft/unshield-note-nft';
import { ContractStore } from '../contracts/contract-store';
import { mintNFTsID01ForTest, shieldNFTForTest } from '../test/shared-test.test';
import { createPollingJsonRpcProviderForListeners } from '../provider/polling-util';
import { isDefined } from '../utils/is-defined';
import { PollingJsonRpcProvider } from '../provider/polling-json-rpc-provider';

chai.use(chaiAsPromised);

let provider: PollingJsonRpcProvider;
let chain: Chain;
let engine: RailgunEngine;
let ethersWallet: Wallet;
let snapshot: number;
let token: TestERC20;
let nft: TestERC721;
let wallet: RailgunWallet;
let wallet2: RailgunWallet;
let merkleTree: MerkleTree;
let tokenAddress: string;
let railgunSmartWalletContract: RailgunSmartWalletContract;

const erc20Address = config.contracts.rail;
const nftAddress = config.contracts.testERC721;

const testMnemonic = config.mnemonic;
const testEncryptionKey = config.encryptionKey;

const shieldTestTokens = async (railgunAddress: string, value: bigint) => {
  const mpk = RailgunEngine.decodeAddress(railgunAddress).masterPublicKey;
  const receiverViewingPublicKey = wallet.getViewingKeyPair().pubkey;
  const random = randomHex(16);
  const shield = new ShieldNoteERC20(mpk, random, value, await token.getAddress());

  const shieldPrivateKey = hexToBytes(randomHex(32));
  const shieldInput = await shield.serialize(shieldPrivateKey, receiverViewingPublicKey);

  // Create shield
  const shieldTx = await railgunSmartWalletContract.generateShield([shieldInput]);

  // Send shield on chain
  const tx = await sendTransactionWithLatestNonce(ethersWallet, shieldTx);
  await Promise.all([
    tx.wait(),
    promiseTimeout(awaitScan(wallet, chain), 10000, 'Timed out scanning after test token shield'),
  ]);
};

describe('RailgunEngine', function test() {
  this.timeout(20000);

  beforeEach(async () => {
    engine = new RailgunEngine(
      'Test Wallet',
      memdown(),
      testArtifactsGetter,
      mockQuickSync,
      undefined, // engineDebugger
      undefined, // skipMerkletreeScans
    );
    engine.prover.setSnarkJSGroth16(groth16 as Groth16);

    if (!isDefined(process.env.RUN_HARDHAT_TESTS)) {
      return;
    }

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

    const balance = await token.balanceOf(ethersWallet.address);
    await token.approve(config.contracts.proxy, balance);

    wallet = await engine.createWalletFromMnemonic(testEncryptionKey, testMnemonic);
    wallet2 = await engine.createWalletFromMnemonic(testEncryptionKey, testMnemonic, 1);
    const pollingProvider = await createPollingJsonRpcProviderForListeners(provider);
    await engine.loadNetwork(
      chain,
      config.contracts.proxy,
      config.contracts.relayAdapt,
      provider,
      pollingProvider,
      24,
    );
    await engine.scanHistory(chain);
    merkleTree = engine.merkletrees[chain.type][chain.id];
    railgunSmartWalletContract = ContractStore.railgunSmartWalletContracts[chain.type][chain.id];
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

  it('[HH] Should show balance after shield and rescan', async function run() {
    if (!isDefined(process.env.RUN_HARDHAT_TESTS)) {
      this.skip();
      return;
    }

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
    };
    // Override root validator
    merkleTree.rootValidator = () => Promise.resolve(true);
    await merkleTree.queueLeaves(0, 0, [commitment]);
    await merkleTree.updateTrees();

    await wallet.scanBalances(chain, undefined);
    const balance = await wallet.getBalance(chain, tokenAddress);
    const value = hexToBigInt(commitment.preImage.value);
    expect(balance).to.equal(value);

    await wallet.fullRescanBalances(chain, undefined);
    const balanceRescan = await wallet.getBalance(chain, tokenAddress);
    expect(balanceRescan).to.equal(value);

    await wallet.clearScannedBalances(chain);
    const balanceClear = await wallet.getBalance(chain, tokenAddress);
    expect(balanceClear).to.equal(undefined);
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
    };
    // Override root validator
    merkleTree.rootValidator = () => Promise.resolve(true);
    await merkleTree.queueLeaves(0, 0, [commitment]);
    await merkleTree.updateTrees();

    await wallet.scanBalances(chain, undefined);
    const balance = await wallet.getBalance(chain, tokenAddress);
    const value = hexToBigInt(commitment.preImage.value);
    expect(balance).to.equal(value);

    const walletDetails = await wallet.getWalletDetails(chain);
    expect(walletDetails.creationTree).to.equal(0);
    expect(walletDetails.creationTreeHeight).to.equal(0);

    await wallet.fullRescanBalances(chain, undefined);
    const balanceRescan = await wallet.getBalance(chain, tokenAddress);
    expect(balanceRescan).to.equal(value);

    await wallet.clearScannedBalances(chain);
    const balanceCleared = await wallet.getBalance(chain, tokenAddress);
    expect(balanceCleared).to.equal(undefined);

    const walletDetailsCleared = await wallet.getWalletDetails(chain);
    expect(walletDetailsCleared.creationTree).to.equal(0); // creationTree should not get reset on clear
    expect(walletDetailsCleared.creationTreeHeight).to.equal(0); // creationTreeHeight should not get reset on clear
    expect(walletDetailsCleared.treeScannedHeights.length).to.equal(0);
  });

  it('[HH] Should shield, unshield and update balance, and pull formatted spend/receive transaction history', async function run() {
    if (!isDefined(process.env.RUN_HARDHAT_TESTS)) {
      this.skip();
      return;
    }

    const initialBalance = await wallet.getBalance(chain, tokenAddress);
    expect(initialBalance).to.equal(undefined);

    const address = wallet.getAddress(chain);
    await shieldTestTokens(address, BigInt(110000) * DECIMALS_18);

    const balance = await wallet.getBalance(chain, tokenAddress);
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
        randomHex(16),
        1n,
        tokenData,
        wallet.getViewingKeyPair(),
        false, // showSenderAddressToRecipient
        OutputType.RelayerFee,
        undefined, // memoText
      ),
    );

    const transactions = await transactionBatch.generateTransactions(
      engine.prover,
      wallet,
      testEncryptionKey,
      () => {},
    );
    const transact = await railgunSmartWalletContract.transact(transactions);

    const transactTx = await sendTransactionWithLatestNonce(ethersWallet, transact);
    await transactTx.wait();
    await Promise.all([
      promiseTimeout(awaitMultipleScans(wallet, chain, 2), 15000, 'Timed out wallet1 scan'),
      promiseTimeout(awaitMultipleScans(wallet2, chain, 2), 15000, 'Timed out wallet2 scan'),
    ]);

    // BALANCE = shielded amount - 300(decimals) - 1
    const newBalance = await wallet.getBalance(chain, tokenAddress);
    expect(newBalance).to.equal(109424999999999999999999n, 'Failed to receive expected balance');

    const newBalance2 = await wallet2.getBalance(chain, tokenAddress);
    expect(newBalance2).to.equal(BigInt(1));

    // check the transactions log
    const history = await wallet.getTransactionHistory(chain, undefined);
    expect(history.length).to.equal(2);

    const tokenFormatted = formatToByteLength(tokenAddress, ByteLength.UINT_256, false);

    // Make sure nullifier events map to completed txid.
    const nullifiers = transactions.map((transaction) => transaction.nullifiers).flat() as string[];
    const completedTxid = await engine.getCompletedTxidFromNullifiers(chain, nullifiers);
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
    expect(history[1].relayerFeeTokenAmount).deep.eq({
      tokenData: getTokenDataERC20(tokenAddress),
      tokenHash: tokenFormatted,
      amount: BigInt(1),
      noteAnnotationData: {
        outputType: OutputType.RelayerFee,
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        senderRandom: history[1].relayerFeeTokenAmount!.noteAnnotationData!.senderRandom,
        walletSource: 'test wallet',
      },
      memoText: undefined,
    });
    expect(history[1].changeTokenAmounts).deep.eq([
      {
        tokenData: getTokenDataERC20(tokenAddress),
        tokenHash: tokenFormatted,
        amount: BigInt('109424999999999999999999'),
        noteAnnotationData: {
          outputType: OutputType.Change,
          senderRandom: MEMO_SENDER_RANDOM_NULL,
          walletSource: 'test wallet',
        },
        memoText: undefined,
      },
    ]);
    expect(history[1].unshieldTokenAmounts).deep.eq([
      {
        tokenData: getTokenDataERC20(tokenAddress),
        tokenHash: tokenFormatted,
        amount: BigInt('299250000000000000000'), // 300 minus fee
        recipientAddress: ethersWallet.address,
        memoText: undefined,
        senderAddress: undefined,
        unshieldFee: '750000000000000000',
      },
    ]);

    // Check that no history exists for a high starting block.
    const historyHighStartingBlock = await wallet.getTransactionHistory(chain, 10000000);
    expect(historyHighStartingBlock.length).to.equal(0);
  }).timeout(90000);

  it('[HH] Should shield, max-unshield without relayer, and pull formatted spend/receive transaction history', async function run() {
    if (!isDefined(process.env.RUN_HARDHAT_TESTS)) {
      this.skip();
      return;
    }

    const initialBalance = await wallet.getBalance(chain, tokenAddress);
    expect(initialBalance).to.equal(undefined);

    const address = wallet.getAddress(chain);
    await shieldTestTokens(address, BigInt(110000) * DECIMALS_18);

    const balance = await wallet.getBalance(chain, tokenAddress);
    expect(balance).to.equal(BigInt('109725000000000000000000'));

    const tokenData = getTokenDataERC20(tokenAddress);

    // Create transaction
    const transactionBatch = new TransactionBatch(chain);
    transactionBatch.addUnshieldData({
      toAddress: ethersWallet.address,
      value: BigInt('109725000000000000000000'),
      tokenData,
    });

    const transactions = await transactionBatch.generateTransactions(
      engine.prover,
      wallet,
      testEncryptionKey,
      () => {},
    );
    expect(transactions.length).to.equal(1);
    expect(transactions[0].nullifiers.length).to.equal(1);
    expect(transactions[0].commitments.length).to.equal(1);
    const transact = await railgunSmartWalletContract.transact(transactions);

    const transactTx = await sendTransactionWithLatestNonce(ethersWallet, transact);
    await Promise.all([
      transactTx.wait(),
      promiseTimeout(awaitScan(wallet, chain), 15000, 'Timed out wallet1 scan'),
    ]);

    const newBalance = await wallet.getBalance(chain, tokenAddress);
    expect(newBalance).to.equal(0n, 'Failed to receive expected balance');

    // check the transactions log
    const history = await wallet.getTransactionHistory(chain, undefined);
    expect(history.length).to.equal(2);

    const tokenFormatted = formatToByteLength(tokenAddress, ByteLength.UINT_256, false);

    // Make sure nullifier events map to completed txid.
    const nullifiers = transactions.map((transaction) => transaction.nullifiers).flat() as string[];
    const completedTxid = await engine.getCompletedTxidFromNullifiers(chain, nullifiers);
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
        recipientAddress: ethersWallet.address,
        memoText: undefined,
        senderAddress: undefined,
        unshieldFee: '274312500000000000000',
      },
    ]);
  }).timeout(90000);

  it('[HH] Should shield, transfer and update balance, and pull formatted spend/receive transaction history', async function run() {
    if (!isDefined(process.env.RUN_HARDHAT_TESTS)) {
      this.skip();
      return;
    }

    const initialBalance = await wallet.getBalance(chain, tokenAddress);
    expect(initialBalance).to.equal(undefined);

    const address = wallet.getAddress(chain);
    await shieldTestTokens(address, BigInt(110000) * DECIMALS_18);

    const balance = await wallet.getBalance(chain, tokenAddress);
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
        randomHex(16),
        10n,
        tokenData,
        wallet.getViewingKeyPair(),
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
        randomHex(16),
        1n,
        tokenData,
        wallet.getViewingKeyPair(),
        false, // showSenderAddressToRecipient
        OutputType.RelayerFee,
        relayerMemoText, // memoText
      ),
    );

    const transactions = await transactionBatch.generateTransactions(
      engine.prover,
      wallet,
      testEncryptionKey,
      () => {},
    );
    const transact = await railgunSmartWalletContract.transact(transactions);

    const transactTx = await sendTransactionWithLatestNonce(ethersWallet, transact);
    await transactTx.wait();
    await Promise.all([
      promiseTimeout(awaitMultipleScans(wallet, chain, 2), 15000, 'Timed out wallet1 scan'),
      promiseTimeout(awaitMultipleScans(wallet2, chain, 2), 15000, 'Timed out wallet2 scan'),
    ]);

    // BALANCE = shielded amount - 300(decimals) - 1
    const newBalance = await wallet.getBalance(chain, tokenAddress);
    expect(newBalance).to.equal(109724999999999999999989n, 'Failed to receive expected balance');

    const newBalance2 = await wallet2.getBalance(chain, tokenAddress);
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
        noteAnnotationData: {
          outputType: OutputType.Transfer,
          // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
          senderRandom: history[1].transferTokenAmounts[0].noteAnnotationData!.senderRandom,
          walletSource: 'test wallet',
        },
        recipientAddress: wallet2.getAddress(),
        memoText,
      },
    ]);
    expect(history[1].relayerFeeTokenAmount).deep.eq({
      tokenData: getTokenDataERC20(tokenAddress),
      tokenHash: tokenFormatted,
      amount: BigInt(1),
      noteAnnotationData: {
        outputType: OutputType.RelayerFee,
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        senderRandom: history[1].relayerFeeTokenAmount!.noteAnnotationData!.senderRandom,
        walletSource: 'test wallet',
      },
      memoText: relayerMemoText,
    });
    expect(history[1].changeTokenAmounts).deep.eq([
      {
        tokenData: getTokenDataERC20(tokenAddress),
        tokenHash: tokenFormatted,
        amount: BigInt('109724999999999999999989'),
        noteAnnotationData: {
          outputType: OutputType.Change,
          senderRandom: MEMO_SENDER_RANDOM_NULL,
          walletSource: 'test wallet',
        },
        memoText: undefined,
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
      },
      {
        tokenData: getTokenDataERC20(tokenAddress),
        tokenHash: tokenFormatted,
        amount: BigInt(1),
        memoText: relayerMemoText,
        senderAddress: undefined,
        shieldFee: undefined,
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
    const approval = await nft.setApprovalForAll(railgunSmartWalletContract.address, true);
    await approval.wait();

    // Shield first NFT
    await shieldNFTForTest(
      wallet,
      ethersWallet,
      railgunSmartWalletContract,
      chain,
      randomHex(16),
      nftAddress,
      '1',
    );

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
        shieldFee: undefined,
      },
    ]);
    expect(history[0].transferTokenAmounts).deep.eq([]);
    expect(history[0].relayerFeeTokenAmount).eq(undefined);
    expect(history[0].changeTokenAmounts).deep.eq([]);
    expect(history[0].unshieldTokenAmounts).deep.eq([]);

    // Shield another NFT.
    const shield2 = await shieldNFTForTest(
      wallet,
      ethersWallet,
      railgunSmartWalletContract,
      chain,
      randomHex(16),
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
        randomHex(16),
        tokenDataNFT1,
        wallet.getViewingKeyPair(),
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
        randomHex(16),
        20n,
        tokenDataRelayerFee,
        wallet.getViewingKeyPair(),
        false, // showSenderAddressToRecipient
        OutputType.RelayerFee,
        relayerMemoText, // memoText
      ),
    );

    const transactions = await transactionBatch.generateTransactions(
      engine.prover,
      wallet,
      testEncryptionKey,
      () => {},
    );
    const transact = await railgunSmartWalletContract.transact(transactions);

    const transactTx = await sendTransactionWithLatestNonce(ethersWallet, transact);
    await transactTx.wait();
    await Promise.all([
      promiseTimeout(awaitMultipleScans(wallet, chain, 4), 15000, 'Timed out wallet1 scan'),
      promiseTimeout(awaitMultipleScans(wallet2, chain, 2), 15000, 'Timed out wallet2 scan'),
    ]);

    const historyAfterTransfer = await wallet.getTransactionHistory(chain, undefined);
    expect(historyAfterTransfer.length).to.equal(4);

    const relayerFeeTokenData = getTokenDataERC20(tokenAddress);
    const relayerFeeTokenHash = getTokenDataHash(relayerFeeTokenData);

    expect(historyAfterTransfer.length).to.equal(4, 'Expected 4 history records');
    expect(historyAfterTransfer[3].transferTokenAmounts.length).to.equal(
      1,
      'Expected at least 1 transfer',
    );

    expect(historyAfterTransfer[3].receiveTokenAmounts).deep.eq([]);
    expect(historyAfterTransfer[3].transferTokenAmounts).deep.eq([
      {
        tokenData: tokenDataNFT1,
        tokenHash: tokenHashNFT1,
        amount: BigInt(1),
        noteAnnotationData: {
          outputType: OutputType.Transfer,
          senderRandom:
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            historyAfterTransfer[3].transferTokenAmounts[0].noteAnnotationData!.senderRandom,
          walletSource: 'test wallet',
        },
        recipientAddress: wallet2.getAddress(),
        memoText,
      },
    ]);
    expect(historyAfterTransfer[3].relayerFeeTokenAmount).deep.eq({
      tokenData: relayerFeeTokenData,
      tokenHash: relayerFeeTokenHash,
      amount: BigInt(20),
      noteAnnotationData: {
        outputType: OutputType.RelayerFee,
        senderRandom:
          // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
          historyAfterTransfer[3].relayerFeeTokenAmount!.noteAnnotationData!.senderRandom,
        walletSource: 'test wallet',
      },
      memoText: relayerMemoText,
    });
    expect(historyAfterTransfer[3].changeTokenAmounts).deep.eq([
      {
        tokenData: relayerFeeTokenData,
        tokenHash: relayerFeeTokenHash,
        amount: BigInt('109724999999999999999980'),
        noteAnnotationData: {
          outputType: OutputType.Change,
          senderRandom: MEMO_SENDER_RANDOM_NULL,
          walletSource: 'test wallet',
        },
        memoText: undefined,
      },
    ]);
    expect(historyAfterTransfer[3].unshieldTokenAmounts).deep.eq([
      {
        tokenData: tokenDataNFT0,
        tokenHash: tokenHashNFT0,
        amount: BigInt(1),
        recipientAddress: ethersWallet.address,
        memoText: undefined,
        senderAddress: undefined,
        unshieldFee: '0',
      },
    ]);
  }).timeout(90000);

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

  it('Should set/get merkletree history version', async () => {
    const chainForSyncedBlock = {
      type: ChainType.EVM,
      id: 10010,
    };
    let lastSyncedBlock = await engine.getLastSyncedBlock(chainForSyncedBlock);
    expect(lastSyncedBlock).to.equal(undefined);
    await engine.setMerkletreeHistoryVersion(chainForSyncedBlock, 100);
    lastSyncedBlock = await engine.getMerkletreeHistoryVersion(chainForSyncedBlock);
    expect(lastSyncedBlock).to.equal(100);
    await engine.setMerkletreeHistoryVersion(chainForSyncedBlock, 100000);
    lastSyncedBlock = await engine.getMerkletreeHistoryVersion(chainForSyncedBlock);
    expect(lastSyncedBlock).to.equal(100000);
  });

  afterEach(async () => {
    if (!isDefined(process.env.RUN_HARDHAT_TESTS)) {
      return;
    }
    await engine.unload();
    await provider.send('evm_revert', [snapshot]);
  });
});
