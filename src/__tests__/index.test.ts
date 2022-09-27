import chai, { expect } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { ethers } from 'ethers';
import memdown from 'memdown';
import { groth16 } from 'snarkjs';
import { Note, RailgunEngine } from '..';
import { abi as erc20Abi } from '../test/erc20-abi.test';
import { config } from '../test/config.test';
import { Wallet } from '../wallet/wallet';
import {
  artifactsGetter,
  awaitScan,
  DECIMALS_18,
  getEthersWallet,
  mockQuickSync,
} from '../test/helper.test';
import { ERC20Deposit } from '../note/erc20-deposit';
import { MerkleTree } from '../merkletree';
import { formatToByteLength, hexToBigInt, randomHex } from '../utils/bytes';
import { RailgunProxyContract } from '../contracts/railgun-proxy';
import { ZERO_ADDRESS } from '../utils/constants';
import { GeneratedCommitment, OutputType, TokenType } from '../models/formatted-types';
import { TransactionBatch } from '../transaction/transaction-batch';
import { Groth16 } from '../prover';
import { ERC20 } from '../typechain-types';
import { promiseTimeout } from '../utils/promises';
import { MEMO_SENDER_BLINDING_KEY_NULL } from '../transaction/constants';
import { Chain, ChainType } from '../models/engine-types';

chai.use(chaiAsPromised);

let provider: ethers.providers.JsonRpcProvider;
let chain: Chain;
let engine: RailgunEngine;
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
  const mpk = RailgunEngine.decodeAddress(address).masterPublicKey;
  const vpk = wallet.getViewingKeyPair().privateKey;
  const random = randomHex(16);
  const deposit = new ERC20Deposit(mpk, random, value, token.address);

  const depositInput = deposit.serialize(vpk);

  // Create deposit
  const depositTx = await proxyContract.generateDeposit([depositInput]);

  // Send deposit on chain
  await etherswallet.sendTransaction(depositTx);
  await expect(awaitScan(wallet, chain)).to.be.fulfilled;
};

describe.only('RailgunEngine', function test() {
  this.timeout(240000);

  beforeEach(async () => {
    engine = new RailgunEngine('Test Wallet', memdown(), artifactsGetter, mockQuickSync);
    engine.prover.setGroth16(groth16 as Groth16);

    if (!process.env.RUN_HARDHAT_TESTS) {
      return;
    }

    // EngineDebug.init(console); // uncomment for logs
    provider = new ethers.providers.JsonRpcProvider(config.rpc);
    chain = {
      type: ChainType.EVM,
      id: (await provider.getNetwork()).chainId,
    };

    etherswallet = getEthersWallet(config.mnemonic, provider);

    snapshot = (await provider.send('evm_snapshot', [])) as number;
    token = new ethers.Contract(config.contracts.rail, erc20Abi, etherswallet) as ERC20;
    tokenAddress = formatToByteLength(token.address, 32, false);

    const balance = await token.balanceOf(etherswallet.address);
    await token.approve(config.contracts.proxy, balance);

    wallet = await engine.createWalletFromMnemonic(testEncryptionKey, testMnemonic);
    wallet2 = await engine.createWalletFromMnemonic(testEncryptionKey, testMnemonic, 1);
    await engine.loadNetwork(
      chain,
      config.contracts.proxy,
      config.contracts.relayAdapt,
      provider,
      24,
    );
    merkleTree = engine.merkletrees[chain.type][chain.id].erc20;
    proxyContract = engine.proxyContracts[chain.type][chain.id];
  });

  it('[HH] Should load existing wallets', async function run() {
    if (!process.env.RUN_HARDHAT_TESTS) {
      this.skip();
      return;
    }

    engine.unloadWallet(wallet.id);
    await engine.loadExistingWallet(testEncryptionKey, wallet.id);
    expect(engine.wallets[wallet.id].id).to.equal(wallet.id);
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
      blockNumber: 0,
    };
    // Override root validator
    merkleTree.validateRoot = () => Promise.resolve(true);
    await merkleTree.queueLeaves(0, 0, [commitment]);

    await wallet.scanBalances(chain);
    const balance = await wallet.getBalance(chain, tokenAddress);
    const value = hexToBigInt(commitment.preImage.value);
    expect(balance).to.equal(value);

    await wallet.fullRescanBalances(chain);
    const balanceRescan = await wallet.getBalance(chain, tokenAddress);
    expect(balanceRescan).to.equal(value);

    await wallet.clearScannedBalances(chain);
    const balanceClear = await wallet.getBalance(chain, tokenAddress);
    expect(balanceClear).to.equal(undefined);
  });

  it('[HH] Should deposit, withdraw and update balance, and pull formatted spend/receive transaction history', async function run() {
    if (!process.env.RUN_HARDHAT_TESTS) {
      this.skip();
      return;
    }

    const initialBalance = await wallet.getBalance(chain, tokenAddress);
    expect(initialBalance).to.equal(undefined);

    const address = wallet.getAddress(chain);
    await makeTestDeposit(address, BigInt(110000) * DECIMALS_18);

    const balance = await wallet.getBalance(chain, tokenAddress);
    expect(balance).to.equal(BigInt('109725000000000000000000'));

    // Create transaction
    const transactionBatch = new TransactionBatch(config.contracts.rail, TokenType.ERC20, chain);
    transactionBatch.setWithdraw(
      etherswallet.address,
      BigInt(300) * DECIMALS_18,
      true, // allowOverride
    );

    // Add output for mock Relayer (artifacts require 2+ outputs, including withdraw)
    const senderBlindingKey = randomHex(15);
    transactionBatch.addOutput(
      Note.create(
        wallet2.addressKeys,
        randomHex(16),
        1n,
        tokenAddress,
        wallet.getViewingKeyPair(),
        senderBlindingKey,
        OutputType.RelayerFee,
        undefined, // memoText
      ),
    );

    const serializedTransactions = await transactionBatch.generateSerializedTransactions(
      engine.prover,
      wallet,
      testEncryptionKey,
      () => {},
    );
    const transact = await proxyContract.transact(serializedTransactions);

    const transactTx = await etherswallet.sendTransaction(transact);
    await transactTx.wait();
    await Promise.all([
      promiseTimeout(awaitScan(wallet, chain), 15000, 'Timed out wallet1 scan'),
      promiseTimeout(awaitScan(wallet2, chain), 15000, 'Timed out wallet2 scan'),
    ]);

    // BALANCE = deposited amount - 300(decimals) - 1
    const newBalance = await wallet.getBalance(chain, tokenAddress);
    expect(newBalance).to.equal(109424999999999999999999n, 'Failed to receive expected balance');

    const newBalance2 = await wallet2.getBalance(chain, tokenAddress);
    expect(newBalance2).to.equal(BigInt(1));

    // check the transactions log
    const history = await wallet.getTransactionHistory(chain);
    expect(history.length).to.equal(2);

    const tokenFormatted = formatToByteLength(tokenAddress, 32, false);

    // Check first output: Shield (receive only).
    expect(history[0].receiveTokenAmounts).deep.eq([
      {
        token: tokenFormatted,
        amount: BigInt('109725000000000000000000'),
        memoText: undefined,
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
        walletSource: 'test wallet',
      },
      memoText: undefined,
    });
    expect(history[1].changeTokenAmounts).deep.eq([
      {
        token: tokenFormatted,
        amount: BigInt('109424999999999999999999'),
        noteExtraData: {
          outputType: OutputType.Change,
          senderBlindingKey: MEMO_SENDER_BLINDING_KEY_NULL,
          walletSource: 'test wallet',
        },
        memoText: undefined,
      },
    ]);
  }).timeout(90000);

  it('[HH] Should deposit, transfer and update balance, and pull formatted spend/receive transaction history', async function run() {
    if (!process.env.RUN_HARDHAT_TESTS) {
      this.skip();
      return;
    }

    const initialBalance = await wallet.getBalance(chain, tokenAddress);
    expect(initialBalance).to.equal(undefined);

    const address = wallet.getAddress(chain);
    await makeTestDeposit(address, BigInt(110000) * DECIMALS_18);

    const balance = await wallet.getBalance(chain, tokenAddress);
    expect(balance).to.equal(BigInt('109725000000000000000000'));

    // Create transaction
    const transactionBatch = new TransactionBatch(config.contracts.rail, TokenType.ERC20, chain);

    const memoText =
      'A really long memo with emojis 😐 👩🏾‍🔧 and other text, in order to test a major memo for a real live production use case.';

    // Add output for Transfer
    const senderBlindingKey = randomHex(15);
    transactionBatch.addOutput(
      Note.create(
        wallet2.addressKeys,
        randomHex(16),
        10n,
        tokenAddress,
        wallet.getViewingKeyPair(),
        senderBlindingKey,
        OutputType.Transfer,
        memoText,
      ),
    );

    const relayerMemoText = 'A short memo with only 32 chars.';

    // Add output for mock Relayer (artifacts require 2+ outputs, including withdraw)
    const senderBlindingKey2 = randomHex(15);
    transactionBatch.addOutput(
      Note.create(
        wallet2.addressKeys,
        randomHex(16),
        1n,
        tokenAddress,
        wallet.getViewingKeyPair(),
        senderBlindingKey2,
        OutputType.RelayerFee,
        relayerMemoText, // memoText
      ),
    );

    const serializedTransactions = await transactionBatch.generateSerializedTransactions(
      engine.prover,
      wallet,
      testEncryptionKey,
      () => {},
    );
    const transact = await proxyContract.transact(serializedTransactions);

    const transactTx = await etherswallet.sendTransaction(transact);
    await transactTx.wait();
    await Promise.all([
      promiseTimeout(awaitScan(wallet, chain), 15000, 'Timed out wallet1 scan'),
      promiseTimeout(awaitScan(wallet2, chain), 15000, 'Timed out wallet2 scan'),
    ]);

    // BALANCE = deposited amount - 300(decimals) - 1
    const newBalance = await wallet.getBalance(chain, tokenAddress);
    expect(newBalance).to.equal(109724999999999999999989n, 'Failed to receive expected balance');

    const newBalance2 = await wallet2.getBalance(chain, tokenAddress);
    expect(newBalance2).to.equal(BigInt(11));

    // check the transactions log
    const history = await wallet.getTransactionHistory(chain);
    expect(history.length).to.equal(2);

    const tokenFormatted = formatToByteLength(tokenAddress, 32, false);

    // Check first output: Shield (receive only).
    expect(history[0].receiveTokenAmounts).deep.eq([
      {
        token: tokenFormatted,
        amount: BigInt('109725000000000000000000'),
        memoText: undefined,
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
          walletSource: 'test wallet',
        },
        recipientAddress: wallet2.getAddress(),
        memoText,
      },
    ]);
    expect(history[1].relayerFeeTokenAmount).deep.eq({
      token: tokenFormatted,
      amount: BigInt(1),
      noteExtraData: {
        outputType: OutputType.RelayerFee,
        senderBlindingKey: senderBlindingKey2,
        walletSource: 'test wallet',
      },
      memoText: relayerMemoText,
    });
    expect(history[1].changeTokenAmounts).deep.eq([
      {
        token: tokenFormatted,
        amount: BigInt('109724999999999999999989'),
        noteExtraData: {
          outputType: OutputType.Change,
          senderBlindingKey: MEMO_SENDER_BLINDING_KEY_NULL,
          walletSource: 'test wallet',
        },
        memoText: undefined,
      },
    ]);

    const history2 = await wallet2.getTransactionHistory(chain);
    expect(history2.length).to.equal(1);
    expect(history2[0].receiveTokenAmounts).deep.eq([
      {
        token: tokenFormatted,
        amount: BigInt(10),
        memoText,
      },
      {
        token: tokenFormatted,
        amount: BigInt(1),
        memoText: relayerMemoText,
      },
    ]);
    expect(history2[0].transferTokenAmounts).deep.eq([]);
    expect(history2[0].relayerFeeTokenAmount).eq(undefined);
    expect(history2[0].changeTokenAmounts).deep.eq([]);
  }).timeout(90000);

  it('Should set/get last synced block', async () => {
    const chainForSyncedBlock = {
      type: ChainType.EVM,
      id: 10010,
    };
    let lastSyncedBlock = await engine.getLastSyncedBlock(chainForSyncedBlock);
    expect(lastSyncedBlock).to.equal(undefined);
    await engine.setLastSyncedBlock(100, chainForSyncedBlock);
    lastSyncedBlock = await engine.getLastSyncedBlock(chainForSyncedBlock);
    expect(lastSyncedBlock).to.equal(100);
    await engine.setLastSyncedBlock(100000, chainForSyncedBlock);
    lastSyncedBlock = await engine.getLastSyncedBlock(chainForSyncedBlock);
    expect(lastSyncedBlock).to.equal(100000);
  });

  afterEach(async () => {
    if (!process.env.RUN_HARDHAT_TESTS) {
      return;
    }
    engine.unload();
    await provider.send('evm_revert', [snapshot]);
  });
});
