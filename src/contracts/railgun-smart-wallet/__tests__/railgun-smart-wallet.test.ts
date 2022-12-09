/// <reference types="../../../types/global" />
import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { ethers } from 'ethers';
import memdown from 'memdown';
import { groth16 } from 'snarkjs';
import { TransactionReceipt } from '@ethersproject/abstract-provider';
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
import { artifactsGetter, awaitScan, DECIMALS_18 } from '../../../test/helper.test';
import {
  Nullifier,
  OutputType,
  TokenType,
  TransactCommitment,
} from '../../../models/formatted-types';
import {
  CommitmentEvent,
  EngineEvent,
  MerkletreeHistoryScanEventData,
  UnshieldStoredEvent,
} from '../../../models/event-types';
import { Memo } from '../../../note/memo';
import { ViewOnlyWallet } from '../../../wallet/view-only-wallet';
import { Groth16 } from '../../../prover/prover';
import { ERC20, TestERC721 } from '../../../typechain-types';
import { promiseTimeout } from '../../../utils/promises';
import { Chain, ChainType } from '../../../models/engine-types';
import { RailgunEngine } from '../../../railgun-engine';
import { RailgunSmartWalletContract } from '../railgun-smart-wallet';
import { MEMO_SENDER_RANDOM_NULL } from '../../../models/transaction-constants';
import { TransactNote } from '../../../note/transact-note';
import { ShieldNoteERC20 } from '../../../note/erc20/shield-note-erc20';
import { ShieldNoteNFT } from '../../../note/nft/shield-note-nft';
import { TransactionBatch } from '../../../transaction/transaction-batch';
import { UnshieldNoteERC20 } from '../../../note/erc20/unshield-note-erc20';
import { getTokenDataERC20, getTokenDataHash } from '../../../note/note-util';
import { NFTTokenDataGetter } from '../../../nft/nft-token-data-getter';

chai.use(chaiAsPromised);
const { expect } = chai;

let provider: ethers.providers.JsonRpcProvider;
let chain: Chain;
let engine: RailgunEngine;
let etherswallet: ethers.Wallet;
let snapshot: number;
let token: ERC20;
let nft: TestERC721;
let railgunSmartWalletContract: RailgunSmartWalletContract;
let wallet: RailgunWallet;
let wallet2: RailgunWallet;
let viewOnlyWallet: ViewOnlyWallet;

const testMnemonic = config.mnemonic;
const testEncryptionKey = config.encryptionKey;

const TOKEN_ADDRESS = config.contracts.rail;
const NFT_ADDRESS = config.contracts.nft;
const RANDOM = randomHex(16);
const VALUE = BigInt(10000) * DECIMALS_18;

let testShield: (value?: bigint) => Promise<[TransactionReceipt, unknown]>;

describe('Railgun Smart Wallet', function runTests() {
  this.timeout(60000);

  beforeEach(async () => {
    engine = new RailgunEngine('Test Proxy', memdown(), artifactsGetter, undefined);
    engine.prover.setSnarkJSGroth16(groth16 as Groth16);

    if (!process.env.RUN_HARDHAT_TESTS) {
      return;
    }

    provider = new ethers.providers.JsonRpcProvider(config.rpc);
    chain = {
      type: ChainType.EVM,
      id: (await provider.getNetwork()).chainId,
    };
    await engine.loadNetwork(
      chain,
      config.contracts.proxy,
      config.contracts.relayAdapt,
      provider,
      0,
    );
    await engine.scanHistory(chain);
    railgunSmartWalletContract = engine.railgunSmartWalletContracts[chain.type][chain.id];

    const { privateKey } = ethers.utils.HDNode.fromMnemonic(config.mnemonic).derivePath(
      ethers.utils.defaultPath,
    );
    etherswallet = new ethers.Wallet(privateKey, provider);
    snapshot = (await provider.send('evm_snapshot', [])) as number;

    token = new ethers.Contract(TOKEN_ADDRESS, erc20Abi, etherswallet) as ERC20;
    const balance = await token.balanceOf(etherswallet.address);
    await token.approve(railgunSmartWalletContract.address, balance);

    nft = new ethers.Contract(NFT_ADDRESS, erc721Abi, etherswallet) as TestERC721;

    wallet = await engine.createWalletFromMnemonic(testEncryptionKey, testMnemonic, 0);
    wallet2 = await engine.createWalletFromMnemonic(testEncryptionKey, testMnemonic, 1);
    viewOnlyWallet = await engine.createViewOnlyWalletFromShareableViewingKey(
      testEncryptionKey,
      await wallet.generateShareableViewingKey(),
      undefined, // creationBlockNumbers
    );

    // fn to create shield tx for tests
    // tx should be complete and balances updated after await
    testShield = async (
      value: bigint = BigInt(110000) * DECIMALS_18,
    ): Promise<[TransactionReceipt, unknown]> => {
      // Create shield
      const shield = new ShieldNoteERC20(wallet.masterPublicKey, RANDOM, value, TOKEN_ADDRESS);
      const shieldPrivateKey = hexToBytes(randomHex(32));
      const shieldInput = await shield.serialize(
        shieldPrivateKey,
        wallet.getViewingKeyPair().pubkey,
      );

      const shieldTx = await railgunSmartWalletContract.generateShield([shieldInput]);

      // Send shield on chain
      const tx = await etherswallet.sendTransaction(shieldTx);
      return Promise.all([tx.wait(), awaitScan(wallet, chain)]);
    };
  });

  it('[HH] Should retrieve merkle root from contract', async function run() {
    if (!process.env.RUN_HARDHAT_TESTS) {
      this.skip();
      return;
    }

    expect(await railgunSmartWalletContract.merkleRoot()).to.equal(
      '14fceeac99eb8419a2796d1958fc2050d489bf5a3eb170ef16a667060344ba90',
    );
  });

  it('[HH] Should return gas estimate for dummy transaction', async function run() {
    if (!process.env.RUN_HARDHAT_TESTS) {
      this.skip();
      return;
    }
    await testShield();

    const transactionBatch = new TransactionBatch(chain);

    const tokenData = getTokenDataERC20(TOKEN_ADDRESS);
    const tokenHash = getTokenDataHash(tokenData);

    transactionBatch.addOutput(
      TransactNote.createTransfer(
        wallet2.addressKeys,
        wallet.addressKeys,
        RANDOM,
        300n,
        tokenHash,
        wallet.getViewingKeyPair(),
        false, // showSenderAddressToRecipient
        OutputType.Transfer,
        undefined, // memoText
      ),
    );
    const tx = await railgunSmartWalletContract.transact(
      await transactionBatch.generateDummyTransactions(engine.prover, wallet, testEncryptionKey),
    );

    tx.from = '0x000000000000000000000000000000000000dEaD';

    expect((await provider.estimateGas(tx)).toNumber()).to.be.greaterThanOrEqual(0);
  });

  it('[HH] Should return valid merkle roots', async function run() {
    if (!process.env.RUN_HARDHAT_TESTS) {
      this.skip();
      return;
    }
    expect(
      await railgunSmartWalletContract.validateRoot(
        0,
        '0x14fceeac99eb8419a2796d1958fc2050d489bf5a3eb170ef16a667060344ba90',
      ),
    ).to.equal(true);
    expect(
      await railgunSmartWalletContract.validateRoot(
        0,
        '0x09981e69d3ecf345fb3e2e48243889aa4ff906423d6a686005cac572a3a9632d',
      ),
    ).to.equal(false);
  });

  it('[HH] Should return fees', async function run() {
    if (!process.env.RUN_HARDHAT_TESTS) {
      this.skip();
      return;
    }
    const fees = await railgunSmartWalletContract.fees();
    expect(fees).to.be.an('object');
    expect(fees.shield).to.be.a('string');
    expect(fees.unshield).to.be.a('string');
    expect(fees.nft).to.be.a('string');
  });

  it('[HH] Should find shield, transact and unshield as historical events', async function run() {
    if (!process.env.RUN_HARDHAT_TESTS) {
      this.skip();
      return;
    }

    let resultEvent!: Optional<CommitmentEvent>;
    const eventsListener = async (commitmentEvent: CommitmentEvent) => {
      resultEvent = commitmentEvent;
    };
    let resultNullifiers: Nullifier[] = [];
    const nullifiersListener = async (nullifiers: Nullifier[]) => {
      resultNullifiers.push(...nullifiers);
    };
    let resultUnshields: UnshieldStoredEvent[] = [];
    const unshieldListener = async (unshields: UnshieldStoredEvent[]) => {
      resultUnshields.push(...unshields);
    };

    let startingBlock = await provider.getBlockNumber();

    // Add a secondary listener.
    railgunSmartWalletContract.treeUpdates(eventsListener, nullifiersListener, unshieldListener);

    // Subscribe to Nullified event
    const resultNullifiers2: Nullifier[] = [];
    const nullifiersListener2 = (nullifiers: Nullifier[]) => {
      resultNullifiers2.push(...nullifiers);
    };
    railgunSmartWalletContract.on(EngineEvent.ContractNullifierReceived, nullifiersListener2);

    const [txResponse] = await testShield();

    // Listeners should have been updated automatically by contract events.

    expect(resultEvent).to.be.an('object', 'No event in history for shield');
    expect((resultEvent as CommitmentEvent).txid).to.equal(hexlify(txResponse.transactionHash));
    expect(resultNullifiers.length).to.equal(0);

    resultEvent = undefined;
    resultNullifiers = [];
    resultUnshields = [];

    let latestBlock = (await provider.getBlock('latest')).number;

    await railgunSmartWalletContract.getHistoricalEvents(
      chain,
      startingBlock,
      latestBlock,
      eventsListener,
      nullifiersListener,
      unshieldListener,
      async () => {},
    );

    // Listeners should have been updated by historical event scan.

    expect(resultEvent).to.be.an('object', 'No event in history for shield');
    expect((resultEvent as unknown as CommitmentEvent).txid).to.equal(
      hexlify(txResponse.transactionHash),
    );
    expect(resultNullifiers.length).to.equal(0);
    expect(resultUnshields.length).to.equal(0);

    startingBlock = await provider.getBlockNumber();

    const transactionBatch = new TransactionBatch(chain);

    const tokenData = getTokenDataERC20(TOKEN_ADDRESS);
    const tokenHash = getTokenDataHash(tokenData);

    transactionBatch.addOutput(
      TransactNote.createTransfer(
        wallet2.addressKeys,
        wallet.addressKeys,
        RANDOM,
        300n,
        tokenHash,
        wallet.getViewingKeyPair(),
        false, // showSenderAddressToRecipient
        OutputType.RelayerFee,
        undefined, // memoText
      ),
    );
    transactionBatch.addUnshieldData({
      toAddress: etherswallet.address,
      value: 100n,
      tokenData,
      tokenHash,
    });
    const serializedTxs = await transactionBatch.generateTransactions(
      engine.prover,
      wallet,
      testEncryptionKey,
      () => {},
    );
    const transact = await railgunSmartWalletContract.transact(serializedTxs);

    // Send transact on chain
    const txTransact = await etherswallet.sendTransaction(transact);
    const [txResponseTransact] = await Promise.all([
      txTransact.wait(),
      promiseTimeout(awaitScan(wallet, chain), 15000, 'Timed out wallet1 scan'),
      promiseTimeout(awaitScan(viewOnlyWallet, chain), 15000, 'Timed out wallet1 scan'),
    ]);

    expect(await wallet.getBalance(chain, TOKEN_ADDRESS)).equal(109724999999999999999600n);
    expect(await viewOnlyWallet.getBalance(chain, TOKEN_ADDRESS)).equal(109724999999999999999600n);

    // Event should have been scanned by automatic contract events:

    const txid = hexlify(txResponseTransact.transactionHash);
    expect((resultEvent as unknown as CommitmentEvent).txid).to.equal(txid);
    expect(resultNullifiers[0].txid).to.equal(txid);
    expect(resultNullifiers2[0].txid).to.equal(txid);
    expect(resultUnshields.length).to.equal(1);
    expect(resultUnshields[0].txid).to.equal(txid);

    resultEvent = undefined;
    resultNullifiers = [];

    latestBlock = (await provider.getBlock('latest')).number;

    await railgunSmartWalletContract.getHistoricalEvents(
      chain,
      startingBlock,
      latestBlock,
      eventsListener,
      nullifiersListener,
      unshieldListener,
      async () => {},
    );

    // Event should have been scanned by historical event scan.

    expect((resultEvent as unknown as CommitmentEvent).txid).to.equal(
      hexlify(txResponseTransact.transactionHash),
    );
    expect(resultNullifiers.length).to.equal(1);
  }).timeout(120000);

  it('[HH] Should scan and rescan history for events', async function run() {
    if (!process.env.RUN_HARDHAT_TESTS) {
      this.skip();
      return;
    }

    await testShield();

    const tree = 0;

    const merkletree = engine.merkletrees[chain.type][chain.id];

    expect(await merkletree.getTreeLength(tree)).to.equal(1);
    let historyScanCompletedForChain!: Chain;
    const historyScanListener = (data: MerkletreeHistoryScanEventData) => {
      historyScanCompletedForChain = data.chain;
    };
    engine.on(EngineEvent.MerkletreeHistoryScanComplete, historyScanListener);
    await engine.scanHistory(chain);
    expect(historyScanCompletedForChain).to.equal(chain);
    expect(await engine.getStartScanningBlock(chain)).to.be.above(0);

    await engine.clearSyncedMerkletreeLeaves(chain);
    expect(await merkletree.getTreeLength(tree)).to.equal(0);
    expect(await engine.getStartScanningBlock(chain)).to.equal(0);

    await engine.fullRescanMerkletreesAndWallets(chain);
    expect(await merkletree.getTreeLength(tree)).to.equal(1);
  });

  it('[HH] Should get note hashes', async function run() {
    if (!process.env.RUN_HARDHAT_TESTS) {
      this.skip();
      return;
    }
    const unshield = new UnshieldNoteERC20(etherswallet.address, 100n, token.address);
    const contractHash = await railgunSmartWalletContract.hashCommitment(unshield.preImage);

    expect(hexlify(contractHash)).to.equal(unshield.hashHex);
  });

  it('[HH] Should shield erc20', async function run() {
    if (!process.env.RUN_HARDHAT_TESTS) {
      this.skip();
      return;
    }

    let result!: CommitmentEvent;
    railgunSmartWalletContract.treeUpdates(
      async (commitmentEvent: CommitmentEvent) => {
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

    const awaiterShield = awaitScan(wallet, chain);

    // Send shield on chain
    await (await etherswallet.sendTransaction(shieldTx)).wait();

    // Wait for events to fire
    await new Promise((resolve) =>
      railgunSmartWalletContract.contract.once(
        railgunSmartWalletContract.contract.filters.Shield(),
        resolve,
      ),
    );

    await expect(awaiterShield).to.be.fulfilled;

    // Check result
    expect(result.treeNumber).to.equal(0);
    expect(result.startPosition).to.equal(0);
    expect(result.commitments.length).to.equal(1);

    const merkleRootAfterShield = await railgunSmartWalletContract.merkleRoot();

    // Check merkle root changed
    expect(merkleRootAfterShield).not.to.equal(merkleRootBefore);
  });

  it.only('[HH] Should shield erc721', async function run() {
    if (!process.env.RUN_HARDHAT_TESTS) {
      this.skip();
      return;
    }

    let result!: CommitmentEvent;
    railgunSmartWalletContract.treeUpdates(
      async (commitmentEvent: CommitmentEvent) => {
        result = commitmentEvent;
      },
      async () => {},
      async () => {},
    );
    const merkleRootBefore = await railgunSmartWalletContract.merkleRoot();

    // Mint NFTs with tokenIDs 0 and 1 into public balance.
    const nftBalanceBeforeMint = await nft.balanceOf(etherswallet.address);
    expect(nftBalanceBeforeMint.toHexString()).to.equal('0x00');
    const mintTx0 = await nft.mint(etherswallet.address, 0);
    await mintTx0.wait();
    const mintTx1 = await nft.mint(etherswallet.address, 1);
    await mintTx1.wait();
    const nftBalanceAfterMint = await nft.balanceOf(etherswallet.address);
    expect(nftBalanceAfterMint.toHexString()).to.equal('0x02');
    const tokenOwner = await nft.ownerOf(1);
    expect(tokenOwner).to.equal(etherswallet.address);
    const tokenURI = await nft.tokenURI(1);
    expect(tokenURI).to.equal('');

    // Approve shield
    const approval = await nft.approve(railgunSmartWalletContract.address, 1);
    await approval.wait();

    // Create shield
    const shield = new ShieldNoteNFT(
      wallet.masterPublicKey,
      RANDOM,
      NFT_ADDRESS,
      TokenType.ERC721,
      BigInt(1).toString(),
    );
    const shieldPrivateKey = hexToBytes(randomHex(32));
    const shieldInput = await shield.serialize(shieldPrivateKey, wallet.getViewingKeyPair().pubkey);

    const shieldTx = await railgunSmartWalletContract.generateShield([shieldInput]);

    const awaiterShield = awaitScan(wallet, chain);

    // Send shield on chain
    await (await etherswallet.sendTransaction(shieldTx)).wait();

    // Wait for events to fire
    await new Promise((resolve) =>
      railgunSmartWalletContract.contract.once(
        railgunSmartWalletContract.contract.filters.Shield(),
        resolve,
      ),
    );

    await expect(awaiterShield).to.be.fulfilled;

    // Check tokenData stored in contract.
    const { tokenHash } = shield;
    const onChainTokenData = await engine.getNFTTokenDataForChain(chain, tokenHash);
    expect(onChainTokenData.tokenAddress.toLowerCase()).to.equal(NFT_ADDRESS.toLowerCase());
    expect(onChainTokenData.tokenSubID).to.equal(formatToByteLength('01', ByteLength.UINT_256));
    expect(onChainTokenData.tokenType).to.equal(TokenType.ERC721);

    // Check that NFT Token Data Cache has data for this hash.
    const nftTokenDataGetter = new NFTTokenDataGetter(engine.db, railgunSmartWalletContract);
    const cachedNFTTokenData = await nftTokenDataGetter.getCachedNFTTokenData(tokenHash);
    expect(cachedNFTTokenData).to.deep.equal(onChainTokenData);

    // Check result
    expect(result.treeNumber).to.equal(0);
    expect(result.startPosition).to.equal(0);
    expect(result.commitments.length).to.equal(1);

    const merkleRootAfterShield = await railgunSmartWalletContract.merkleRoot();

    // Check merkle root changed
    expect(merkleRootAfterShield).not.to.equal(merkleRootBefore);
  });

  it('[HH] Should create transactions and parse tree updates', async function run() {
    if (!process.env.RUN_HARDHAT_TESTS) {
      this.skip();
      return;
    }

    await testShield(1000n);
    const merkleRootAfterShield = await railgunSmartWalletContract.merkleRoot();

    let result!: CommitmentEvent;
    railgunSmartWalletContract.treeUpdates(
      async (commitmentEvent: CommitmentEvent) => {
        result = commitmentEvent;
      },
      async () => {},
      async () => {},
    );
    // Create transaction
    const transactionBatch = new TransactionBatch(chain);

    const tokenData = getTokenDataERC20(TOKEN_ADDRESS);
    const tokenHash = getTokenDataHash(tokenData);

    transactionBatch.addOutput(
      TransactNote.createTransfer(
        wallet2.addressKeys,
        wallet.addressKeys,
        RANDOM,
        300n,
        tokenHash,
        wallet.getViewingKeyPair(),
        true, // showSenderAddressToRecipient
        OutputType.RelayerFee,
        undefined, // memoText
      ),
    );
    transactionBatch.addUnshieldData({
      toAddress: etherswallet.address,
      value: 100n,
      tokenData,
      tokenHash,
    });

    // Create transact
    const transact = await railgunSmartWalletContract.transact(
      await transactionBatch.generateTransactions(
        engine.prover,
        wallet,
        testEncryptionKey,
        () => {},
      ),
    );

    // Send transact on chain
    await (await etherswallet.sendTransaction(transact)).wait();

    // Wait for events to fire
    await new Promise((resolve) =>
      railgunSmartWalletContract.contract.once(
        railgunSmartWalletContract.contract.filters.Transact(),
        resolve,
      ),
    );

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
      walletSource: 'test proxy',
    });
    expect(
      Memo.decryptNoteAnnotationData(
        (result.commitments as TransactCommitment[])[1].ciphertext.annotationData,
        wallet.getViewingKeyPair().privateKey,
      ),
    ).to.deep.equal({
      outputType: OutputType.Change,
      senderRandom: MEMO_SENDER_RANDOM_NULL,
      walletSource: 'test proxy',
    });
  }).timeout(120000);

  afterEach(async () => {
    if (!process.env.RUN_HARDHAT_TESTS) {
      return;
    }
    engine.unload();
    await provider.send('evm_revert', [snapshot]);
  });
});
