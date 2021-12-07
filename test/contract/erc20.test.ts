/* globals describe it beforeEach afterEach */
import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';

import { ethers } from 'ethers';

import { abi as erc20abi } from '../erc20abi.test';
import { config } from '../config.test';

import { ERC20RailgunContract } from '../../src/contract';
import { ERC20Note } from '../../src/note';

chai.use(chaiAsPromised);
const { expect } = chai;

let provider: ethers.providers.JsonRpcProvider;
let wallet: ethers.Wallet;
let snapshot: number;
let token: ethers.Contract;
let contract: ERC20RailgunContract;

describe('Contract/Index', () => {
  beforeEach(async () => {
    provider = new ethers.providers.JsonRpcProvider(config.rpc);

    const { privateKey } = ethers.utils.HDNode.fromMnemonic(config.mnemonic)
      .derivePath(ethers.utils.defaultPath);
    wallet = new ethers.Wallet(privateKey, provider);

    snapshot = await provider.send('evm_snapshot', []);
    token = new ethers.Contract(config.contracts.rail, erc20abi, wallet);
    contract = new ERC20RailgunContract(config.contracts.proxy, provider);

    const balance = await token.balanceOf(wallet.address);
    await token.approve(contract.address, balance);
  });

  it('Should retrieve merkle root from contract', async () => {
    expect(await contract.merkleRoot()).to.equal('14fceeac99eb8419a2796d1958fc2050d489bf5a3eb170ef16a667060344ba90');
  }).timeout(30000);

  it('Should return valid merkle roots', async () => {
    expect(await contract.validateRoot(0, '14fceeac99eb8419a2796d1958fc2050d489bf5a3eb170ef16a667060344ba90')).to.equal(true);
    expect(await contract.validateRoot(0, '09981e69d3ecf345fb3e2e48243889aa4ff906423d6a686005cac572a3a9632d')).to.equal(false);
  });

  it('Should parse tree update events', async () => {
    let result;

    contract.treeUpdates((res) => {
      result = res;
    });

    const transaction = await contract.generateDeposit(
      [
        new ERC20Note(
          '09981e69d3ecf345fb3e2e48243889aa4ff906423d6a686005cac572a3a9632d',
          '09f4c002178ea5c93820d44e8e83409fe6dcc9ed710f6d5c7b0817e173799d04',
          '01',
          config.contracts.rail,
        ),
      ],
    );

    // Send transaction on chain
    wallet.sendTransaction(transaction);

    // Wait for events to fire
    await new Promise((resolve) => contract.contract.once('GeneratedCommitmentBatch', resolve));

    // Check result
    expect(result).to.deep.equal({
      tree: 0,
      startingIndex: 0,
      commitments: [
        {
          pubkey: '09981e69d3ecf345fb3e2e48243889aa4ff906423d6a686005cac572a3a9632d',
          random: '09f4c002178ea5c93820d44e8e83409fe6dcc9ed710f6d5c7b0817e173799d04',
          amount: '01',
          token: config.contracts.rail,
        },
      ],
    });
  }).timeout(30000);

  afterEach(async () => {
    contract.unload();
    await provider.send('evm_revert', [snapshot]);
  });
});
