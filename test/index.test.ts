/* globals describe it beforeEach, afterEach */
import chai, { expect } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { ethers } from 'ethers';
import memdown from 'memdown';
import { groth16 } from 'snarkjs';
import { Lepton, Note } from '../src';
import { abi as erc20abi } from './erc20abi.test';
import { config } from './config.test';
import { Wallet } from '../src/wallet/wallet';
import { artifactsGetter, awaitScan, DECIMALS_18, getEthersWallet, mockQuickSync } from './helper';
import { ERC20Deposit } from '../src/note/erc20-deposit';
import { MerkleTree } from '../src/merkletree';
import { formatToByteLength, hexToBigInt, randomHex } from '../src/utils/bytes';
import { RailgunProxyContract } from '../src/contracts/railgun-proxy';
import { ZERO_ADDRESS } from '../src/utils/constants';
import { GeneratedCommitment, OutputType, TokenType } from '../src/models/formatted-types';
import { TransactionBatch } from '../src/transaction/transaction-batch';
import { Memo } from '../src/note/memo';
import { Groth16 } from '../src/prover';
import { ERC20 } from '../src/typechain-types';
import { promiseTimeout } from '../src/utils/promises';
import { MEMO_SENDER_BLINDING_KEY_NULL } from '../src/transaction/constants';

chai.use(chaiAsPromised);

let provider: ethers.providers.JsonRpcProvider;
let chainID: number;
let lepton: Lepton;
let etherswallet: ethers.Wallet;
let snapshot: number;
let token: ERC20;
let wallet: Wallet;
let wallet2: Wallet;
let merkleTree: MerkleTree;
let tokenAddress: string;
let proxyContract: RailgunProxyContract;

const testMnemonic = config.mnemonic;
const testEncryptionKey = config.encryptionKey;

const makeTestDeposit = async (address: string, value: bigint) => {
  const mpk = Lepton.decodeAddress(address).masterPublicKey;
  const vpk = wallet.getViewingKeyPair().privateKey;
  const random = randomHex(16);
  const deposit = new ERC20Deposit(mpk, random, value, token.address);

  const depositInput = deposit.serialize(vpk);

  // Create deposit
  const depositTx = await proxyContract.generateDeposit([depositInput]);

  // Send deposit on chain
  await etherswallet.sendTransaction(depositTx);
  await expect(awaitScan(wallet, chainID)).to.be.fulfilled;
};

// eslint-disable-next-line func-names
describe('Lepton', function () {
  this.timeout(240000);

  beforeEach(async () => {
    lepton = new Lepton(memdown(), artifactsGetter, mockQuickSync);
    lepton.prover.setGroth16(groth16 as Groth16);

    if (!process.env.RUN_HARDHAT_TESTS) {
      return;
    }

    // LeptonDebug.init(console); // uncomment for logs
    provider = new ethers.providers.JsonRpcProvider(config.rpc);
    chainID = (await provider.getNetwork()).chainId;

    etherswallet = getEthersWallet(config.mnemonic, provider);

    snapshot = (await provider.send('evm_snapshot', [])) as number;
    token = new ethers.Contract(config.contracts.rail, erc20abi, etherswallet) as ERC20;
    tokenAddress = formatToByteLength(token.address, 32, false);

    const balance = await token.balanceOf(etherswallet.address);
    await token.approve(config.contracts.proxy, balance);

    wallet = await lepton.createWalletFromMnemonic(testEncryptionKey, testMnemonic);
    wallet2 = await lepton.createWalletFromMnemonic(testEncryptionKey, testMnemonic, 1);
    await lepton.loadNetwork(
      chainID,
      config.contracts.proxy,
      config.contracts.relayAdapt,
      provider,
      24,
    );
    merkleTree = lepton.merkletree[chainID].erc20;
    proxyContract = lepton.proxyContracts[chainID];
  });

  it('[HH] Should load existing wallets', async function run() {
    if (!process.env.RUN_HARDHAT_TESTS) {
      this.skip();
      return;
    }

    lepton.unloadWallet(wallet.id);
    await lepton.loadExistingWallet(testEncryptionKey, wallet.id);
    expect(lepton.wallets[wallet.id].id).to.equal(wallet.id);
  });

  it('[HH] Should show balance after deposit and rescan', async function run() {
    if (!process.env.RUN_HARDHAT_TESTS) {
      this.skip();
      return;
    }

    const commitment: GeneratedCommitment = {
      hash: '14308448bcb19ecff96805fe3d00afecf82b18fa6f8297b42cf2aadc23f412e6',
      txid: '0x0543be0699a7eac2b75f23b33d435aacaeb0061f63e336230bcc7559a1852f33',
      preImage: {
        npk: '0xc24ea33942c0fb9acce5dbada73137ad3257a6f2e1be8f309c1fe9afc5410a',
        token: {
          tokenType: TokenType.ERC20,
          tokenAddress: `0x${tokenAddress}`,
          tokenSubID: ZERO_ADDRESS,
        },
        value: '9138822709a9fc231cba6',
      },
      encryptedRandom: [
        '0xb47a353e294711ff73cf086f97ee1ed29b853b67c353bc2371b87fe72c716cc6',
        '0x3d321af08b8fa7a8f70379407706b752',
      ],
    };
    // Override root validator
    merkleTree.validateRoot = () => Promise.resolve(true);
    await merkleTree.queueLeaves(0, 0, [commitment]);

    await wallet.scanBalances(chainID);
    const balance = await wallet.getBalance(chainID, tokenAddress);
    const value = hexToBigInt(commitment.preImage.value);
    expect(balance).to.equal(value);

    await wallet.fullRescanBalances(chainID);
    const balanceRescan = await wallet.getBalance(chainID, tokenAddress);
    expect(balanceRescan).to.equal(value);

    await wallet.clearScannedBalances(chainID);
    const balanceClear = await wallet.getBalance(chainID, tokenAddress);
    expect(balanceClear).to.equal(undefined);
  });

  it('[HH] Should deposit, withdraw and update balance, and pull formatted spend/receive transaction history', async function run() {
    if (!process.env.RUN_HARDHAT_TESTS) {
      this.skip();
      return;
    }

    const initialBalance = await wallet.getBalance(chainID, tokenAddress);
    expect(initialBalance).to.equal(undefined);

    const address = wallet.getAddress(chainID);
    await makeTestDeposit(address, BigInt(110000) * DECIMALS_18);

    const balance = await wallet.getBalance(chainID, tokenAddress);
    expect(balance).to.equal(BigInt('109725000000000000000000'));

    // Create transaction
    const transactionBatch = new TransactionBatch(config.contracts.rail, TokenType.ERC20, chainID);
    transactionBatch.setWithdraw(
      etherswallet.address,
      BigInt(300) * DECIMALS_18,
      true, // allowOverride
    );

    // Add output for mock Relayer (artifacts require 2+ outputs, including withdraw)
    const senderBlindingKey = randomHex(15);
    const memoFieldRelayerFee = Memo.createMemoField(
      {
        outputType: OutputType.RelayerFee,
        senderBlindingKey,
      },
      wallet.getViewingKeyPair().privateKey,
    );
    transactionBatch.addOutput(
      new Note(wallet2.addressKeys, randomHex(16), 1n, tokenAddress, memoFieldRelayerFee),
    );

    const serializedTransactions = await transactionBatch.generateSerializedTransactions(
      lepton.prover,
      wallet,
      testEncryptionKey,
      () => {},
    );
    const transact = await proxyContract.transact(serializedTransactions);

    const transactTx = await etherswallet.sendTransaction(transact);
    await transactTx.wait();
    await Promise.all([
      promiseTimeout(awaitScan(wallet, chainID), 15000, 'Timed out wallet1 scan'),
      promiseTimeout(awaitScan(wallet2, chainID), 15000, 'Timed out wallet2 scan'),
    ]);

    // BALANCE = deposited amount - 300(decimals) - 1
    const newBalance = await wallet.getBalance(chainID, tokenAddress);
    expect(newBalance).to.equal(109424999999999999999999n, 'Failed to receive expected balance');

    const newBalance2 = await wallet2.getBalance(chainID, tokenAddress);
    expect(newBalance2).to.equal(BigInt(1));

    // check the transactions log
    const history = await wallet.getTransactionHistory(chainID);
    expect(history.length).to.equal(2);

    const tokenFormatted = formatToByteLength(tokenAddress, 32, false);

    // Check first output: Shield (receive only).
    expect(history[0].receiveTokenAmounts).deep.eq([
      {
        token: tokenFormatted,
        amount: BigInt('109725000000000000000000'),
      },
    ]);
    expect(history[0].transferTokenAmounts).deep.eq([]);
    expect(history[0].relayerFeeTokenAmount).eq(undefined);
    expect(history[0].changeTokenAmounts).deep.eq([]);

    // Check second output: Withdraw (relayer fee + change).
    // NOTE: No receive token amounts should be logged by history.
    expect(history[1].receiveTokenAmounts).deep.eq(
      [],
      "Receive amount should be filtered out - it's the same as change output.",
    );
    expect(history[1].transferTokenAmounts).deep.eq([]);
    expect(history[1].relayerFeeTokenAmount).deep.eq({
      token: tokenFormatted,
      amount: BigInt(1),
      noteExtraData: {
        outputType: OutputType.RelayerFee,
        senderBlindingKey,
      },
    });
    expect(history[1].changeTokenAmounts).deep.eq([
      {
        token: tokenFormatted,
        amount: BigInt('109424999999999999999999'),
        noteExtraData: {
          outputType: OutputType.Change,
          senderBlindingKey: MEMO_SENDER_BLINDING_KEY_NULL,
        },
      },
    ]);
  }).timeout(90000);

  it('[HH] Should deposit, transfer and update balance, and pull formatted spend/receive transaction history', async function run() {
    if (!process.env.RUN_HARDHAT_TESTS) {
      this.skip();
      return;
    }

    const initialBalance = await wallet.getBalance(chainID, tokenAddress);
    expect(initialBalance).to.equal(undefined);

    const address = wallet.getAddress(chainID);
    await makeTestDeposit(address, BigInt(110000) * DECIMALS_18);

    const balance = await wallet.getBalance(chainID, tokenAddress);
    expect(balance).to.equal(BigInt('109725000000000000000000'));

    // Create transaction
    const transactionBatch = new TransactionBatch(config.contracts.rail, TokenType.ERC20, chainID);

    // Add output for Transfer
    const senderBlindingKey = randomHex(15);
    const memoFieldTransfer = Memo.createMemoField(
      {
        outputType: OutputType.Transfer,
        senderBlindingKey,
      },
      wallet.getViewingKeyPair().privateKey,
    );
    transactionBatch.addOutput(
      new Note(wallet2.addressKeys, randomHex(16), 10n, tokenAddress, memoFieldTransfer),
    );

    // Add output for mock Relayer (artifacts require 2+ outputs, including withdraw)
    const senderBlindingKey2 = randomHex(15);
    const memoFieldRelayerFee = Memo.createMemoField(
      {
        outputType: OutputType.RelayerFee,
        senderBlindingKey: senderBlindingKey2,
      },
      wallet.getViewingKeyPair().privateKey,
    );
    transactionBatch.addOutput(
      new Note(wallet2.addressKeys, randomHex(16), 1n, tokenAddress, memoFieldRelayerFee),
    );

    const serializedTransactions = await transactionBatch.generateSerializedTransactions(
      lepton.prover,
      wallet,
      testEncryptionKey,
      () => {},
    );
    const transact = await proxyContract.transact(serializedTransactions);

    const transactTx = await etherswallet.sendTransaction(transact);
    await transactTx.wait();
    await Promise.all([
      promiseTimeout(awaitScan(wallet, chainID), 15000, 'Timed out wallet1 scan'),
      promiseTimeout(awaitScan(wallet2, chainID), 15000, 'Timed out wallet2 scan'),
    ]);

    // BALANCE = deposited amount - 300(decimals) - 1
    const newBalance = await wallet.getBalance(chainID, tokenAddress);
    expect(newBalance).to.equal(109724999999999999999989n, 'Failed to receive expected balance');

    const newBalance2 = await wallet2.getBalance(chainID, tokenAddress);
    expect(newBalance2).to.equal(BigInt(11));

    // check the transactions log
    const history = await wallet.getTransactionHistory(chainID);
    expect(history.length).to.equal(2);

    const tokenFormatted = formatToByteLength(tokenAddress, 32, false);

    // Check first output: Shield (receive only).
    expect(history[0].receiveTokenAmounts).deep.eq([
      {
        token: tokenFormatted,
        amount: BigInt('109725000000000000000000'),
      },
    ]);
    expect(history[0].transferTokenAmounts).deep.eq([]);
    expect(history[0].relayerFeeTokenAmount).eq(undefined);
    expect(history[0].changeTokenAmounts).deep.eq([]);

    // Check second output: Withdraw (relayer fee + change).
    // NOTE: No receive token amounts should be logged by history.
    expect(history[1].receiveTokenAmounts).deep.eq(
      [],
      "Receive amount should be filtered out - it's the same as change output.",
    );
    expect(history[1].transferTokenAmounts).deep.eq([
      {
        token: tokenFormatted,
        amount: BigInt(10),
        noteExtraData: {
          outputType: OutputType.Transfer,
          senderBlindingKey,
        },
        recipientAddress: wallet2.getAddress(0),
      },
    ]);
    expect(history[1].relayerFeeTokenAmount).deep.eq({
      token: tokenFormatted,
      amount: BigInt(1),
      noteExtraData: {
        outputType: OutputType.RelayerFee,
        senderBlindingKey: senderBlindingKey2,
      },
    });
    expect(history[1].changeTokenAmounts).deep.eq([
      {
        token: tokenFormatted,
        amount: BigInt('109724999999999999999989'),
        noteExtraData: {
          outputType: OutputType.Change,
          senderBlindingKey: MEMO_SENDER_BLINDING_KEY_NULL,
        },
      },
    ]);
  }).timeout(90000);

  it('Should set/get last synced block', async () => {
    const chainIDForSyncedBlock = 10010;
    let lastSyncedBlock = await lepton.getLastSyncedBlock(chainIDForSyncedBlock);
    expect(lastSyncedBlock).to.equal(undefined);
    await lepton.setLastSyncedBlock(100, chainIDForSyncedBlock);
    lastSyncedBlock = await lepton.getLastSyncedBlock(chainIDForSyncedBlock);
    expect(lastSyncedBlock).to.equal(100);
    await lepton.setLastSyncedBlock(100000, chainIDForSyncedBlock);
    lastSyncedBlock = await lepton.getLastSyncedBlock(chainIDForSyncedBlock);
    expect(lastSyncedBlock).to.equal(100000);
  });

  afterEach(async () => {
    if (!process.env.RUN_HARDHAT_TESTS) {
      return;
    }
    lepton.unload();
    await provider.send('evm_revert', [snapshot]);
  });
});
