/* globals describe it beforeEach, afterEach */
import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';

import BN from 'bn.js';
import { ethers } from 'ethers';
import memdown from 'memdown';
// @ts-ignore
import artifacts from 'railgun-artifacts';

import { Lepton, ERC20Note, ERC20Transaction } from '../src';

import { abi as erc20abi } from './erc20abi.test';
import { config } from './config.test';
import { babyjubjub, bytes } from '../src/utils';
import type { Artifacts, Circuits } from '../src/prover';

chai.use(chaiAsPromised);
const { expect } = chai;

let provider: ethers.providers.JsonRpcProvider;
let chainID: number;
let lepton: Lepton;
let etherswallet: ethers.Wallet;
let snapshot: number;
let token: ethers.Contract;
let walletID: string;

const testMnemonic = 'test test test test test test test test test test test junk';
const testEncryptionKey = '01';

async function artifactsGetter(circuit: Circuits): Promise<Artifacts> {
  if (circuit === 'erc20small') {
    return artifacts.small;
  }
  return artifacts.large;
}

// eslint-disable-next-line func-names
describe('Lepton', function () {
  this.timeout(240000);

  beforeEach(async () => {
    provider = new ethers.providers.JsonRpcProvider(config.rpc);
    chainID = (await provider.getNetwork()).chainId;

    const { privateKey } = ethers.utils.HDNode.fromMnemonic(config.mnemonic)
      .derivePath(ethers.utils.defaultPath);

    etherswallet = new ethers.Wallet(privateKey, provider);

    snapshot = await provider.send('evm_snapshot', []);
    token = new ethers.Contract(config.contracts.rail, erc20abi, etherswallet);

    const balance = await token.balanceOf(etherswallet.address);
    await token.approve(config.contracts.proxy, balance);

    lepton = new Lepton(memdown(), artifactsGetter);
    walletID = await lepton.createWalletFromMnemonic(testEncryptionKey, testMnemonic);
    await lepton.loadNetwork(chainID, config.contracts.proxy, provider, 0);
  });

  it('Should load existing wallets', async () => {
    lepton.unloadWallet(walletID);
    await lepton.loadExistingWallet(testEncryptionKey, walletID);
    expect(lepton.wallets[walletID].id).to.equal(walletID);
  });

  it('Should deposit, transact and update balance', async () => {
    const address = (await lepton.wallets[walletID].addresses(chainID))[0];

    // Create deposit
    const deposit = await lepton.contracts[chainID].generateDeposit([
      new ERC20Note(
        Lepton.decodeAddress(address).publicKey,
        '1e686e7506b0f4f21d6991b4cb58d39e77c31ed0577a986750c8dce8804af5b9',
        new BN('11000000000000000000000000', 10),
        config.contracts.rail,
      ),
    ]);

    // Send deposit on chain
    const awaiter = new Promise((resolve) => lepton.wallets[walletID].once('scanned', resolve));
    etherswallet.sendTransaction(deposit);
    await awaiter;

    // Create transaction
    const transaction = new ERC20Transaction(config.contracts.rail, chainID);
    transaction.outputs = [
      new ERC20Note(
        babyjubjub.privateKeyToPublicKey(babyjubjub.seedToPrivateKey(bytes.random(32))),
        '1e686e7506b0f4f21d6991b4cb58d39e77c31ed0577a986750c8dce8804af5b9',
        new BN('300', 10),
        config.contracts.rail,
      ),
    ];
    transaction.withdraw = new BN(300);
    transaction.withdrawAddress = config.contracts.treasury;

    const transact = await lepton.contracts[chainID].transact([
      await transaction.prove(lepton.prover, lepton.wallets[walletID], testEncryptionKey),
    ]);

    // Send transact on chain
    const awaiter2 = new Promise((resolve) => lepton.wallets[walletID].once('scanned', resolve));
    etherswallet.sendTransaction(transact);
    await awaiter2;

    expect(
      Object.values(await lepton.wallets[walletID].balances(chainID))[0].balance.toString(10),
    ).to.equal('10999999999999999999999400');
  }).timeout(120000);

  afterEach(async () => {
    lepton.unload();
    await provider.send('evm_revert', [snapshot]);
  });
});
