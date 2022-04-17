/* globals describe it beforeEach, afterEach */
import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';

import BN from 'bn.js';
import { ethers } from 'ethers';
import memdown from 'memdown';

import { Lepton, Note, Transaction } from '../src';

import { abi as erc20abi } from './erc20abi.test';
import { config } from './config.test';
import { babyjubjub, bytes } from '../src/utils';
import { ScannedEventData, Wallet } from '../src/wallet';
import { artifactsGetter } from './helper';
import { Deposit } from '../src/note/deposit';

chai.use(chaiAsPromised);
const { expect } = chai;

let provider: ethers.providers.JsonRpcProvider;
let chainID: number;
let lepton: Lepton;
let etherswallet: ethers.Wallet;
let snapshot: number;
let token: ethers.Contract;
let walletID: string;
let wallet: Wallet;

const testMnemonic = config.mnemonic;
const testEncryptionKey = config.encryptionKey;
const { log } = console;

// eslint-disable-next-line func-names
describe('Lepton', function () {
  this.timeout(240000);

  beforeEach(async () => {
    lepton = new Lepton(memdown(), artifactsGetter);
    if (!process.env.RUN_HARDHAT_TESTS) {
      return;
    }

    provider = new ethers.providers.JsonRpcProvider(config.rpc);
    chainID = (await provider.getNetwork()).chainId;
    log(chainID);

    const { privateKey } = ethers.utils.HDNode.fromMnemonic(config.mnemonic).derivePath(
      ethers.utils.defaultPath,
    );
    etherswallet = new ethers.Wallet(privateKey, provider);
    snapshot = await provider.send('evm_snapshot', []);
    token = new ethers.Contract(config.contracts.rail, erc20abi, etherswallet);

    const balance = await token.balanceOf(etherswallet.address);
    await token.approve(config.contracts.proxy, balance);

    walletID = await lepton.createWalletFromMnemonic(testEncryptionKey, testMnemonic);
    wallet = lepton.wallets[walletID];
    await lepton.loadNetwork(chainID, config.contracts.proxy, provider, 0);
  });

  it('[HH] Should load existing wallets', async function run() {
    if (!process.env.RUN_HARDHAT_TESTS) {
      this.skip();
      return;
    }

    lepton.unloadWallet(walletID);
    await lepton.loadExistingWallet(testEncryptionKey, walletID);
    expect(lepton.wallets[walletID].id).to.equal(walletID);
  });

  it('[HH] Should show balance after deposit', async function run() {
    if (!process.env.RUN_HARDHAT_TESTS) {
      this.skip();
      return;
    }

    const commitment = {
      hash: '14308448bcb19ecff96805fe3d00afecf82b18fa6f8297b42cf2aadc23f412e6',
      txid: '0x0543be0699a7eac2b75f23b33d435aacaeb0061f63e336230bcc7559a1852f33',
      data: {
        npk: '0xc24ea33942c0fb9acce5dbada73137ad3257a6f2e1be8f309c1fe9afc5410a',
        token: {
          tokenType: '0',
          tokenAddress: '0x5FbDB2315678afecb367f032d93F642f64180aa3',
          tokenSubID: '0',
        },
        hash: '14308448bcb19ecff96805fe3d00afecf82b18fa6f8297b42cf2aadc23f412e6',
        value: '9138822709a9fc231cba6',
        encryptedRandom: [
          '0xa51425928f4d6be74808a67732a56085e53d58e18b91faed635049462aab883e',
          '0x26e8e14696fe12fe8279764a0d8f22a9703ebc366b53a0cc253aa26c7b9bf884',
        ],
      },
    };
    lepton.merkletree[chainID].erc20.queueLeaves(0, 0, [commitment]);
    const balances = await wallet.balances(chainID);
    expect(balances[token.address]).to.equal(commitment.data.value);
  });

  it('[HH] Should deposit, transact and update balance', async function run() {
    if (!process.env.RUN_HARDHAT_TESTS) {
      this.skip();
      return;
    }

    const address = await lepton.wallets[walletID].getAddress(chainID);

    const mpk = Lepton.decodeAddress(address).masterPublicKey;
    const vpk = await lepton.wallets[walletID].getViewingPrivateKey();
    const value = 11000000000000000000000000n;
    const deposit = new Deposit(mpk, babyjubjub.random(), value, config.contracts.rail);

    const { preImage, encryptedRandom } = deposit.serialize(vpk);
    // log(preImage, encryptedRandom);
    // Create deposit
    const depositTx = await lepton.contracts[chainID].generateDeposit(
      [preImage],
      [encryptedRandom],
    );

    // Send deposit on chain
    const awaiterDeposit = new Promise((resolve, reject) =>
      lepton.wallets[walletID].once('scanned', ({ chainID: returnedChainID }: ScannedEventData) =>
        returnedChainID === chainID ? resolve(returnedChainID) : reject(),
      ),
    );
    await etherswallet.sendTransaction(depositTx);
    await expect(awaiterDeposit).to.be.fulfilled;
    const balances = await wallet.balances(chainID);
    log(balances);
    expect(balances[token.address]).to.equal(deposit.value);

    // Create transaction
    const transaction = new Transaction(config.contracts.rail, chainID);
    transaction.outputs = [
      new Note(
        babyjubjub.privateKeyToPubKey(babyjubjub.seedToPrivateKey(bytes.random(32))),
        '0x1e686e7506b0f4f21d6991b4cb58d39e77c31ed0577a986750c8dce8804af5b9',
        new BN('300', 10),
        config.contracts.rail,
      ),
    ];
    transaction.withdraw(await etherswallet.getAddress(), 300n);
    transaction.withdrawAddress = config.contracts.treasury;

    const proof = await transaction.prove(
      lepton.prover,
      lepton.wallets[walletID],
      testEncryptionKey,
    );
    const transact = await lepton.contracts[chainID].transact([proof]);

    // Send transact on chain
    const awaiterTransact = new Promise((resolve, reject) =>
      lepton.wallets[walletID].once('scanned', ({ chainID: returnedChainID }: ScannedEventData) =>
        returnedChainID === chainID ? resolve(returnedChainID) : reject(),
      ),
    );
    etherswallet.sendTransaction(transact);
    await expect(awaiterTransact).to.be.fulfilled;

    expect(
      Object.values(await lepton.wallets[walletID].balances(chainID))[0].balance.toString(10),
    ).to.equal('10999999999999999999999400');
  }).timeout(0); // 90000);

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
