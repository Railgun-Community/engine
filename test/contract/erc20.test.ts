/* globals describe it beforeEach afterEach */
import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';

import BN from 'bn.js';
import { ethers } from 'ethers';

import { abi as erc20abi } from '../erc20abi.test';
import { config } from '../config.test';

import { ERC20RailgunContract } from '../../src/contract';
import { ERC20Note } from '../../src/note';
import type { Commitment } from '../../src/merkletree';

chai.use(chaiAsPromised);
const { expect } = chai;

let provider: ethers.providers.JsonRpcProvider;
let etherswallet: ethers.Wallet;
let snapshot: number;
let token: ethers.Contract;
let contract: ERC20RailgunContract;

// eslint-disable-next-line func-names
describe('Contract/Index', function () {
  this.timeout(60000);

  beforeEach(async () => {
    provider = new ethers.providers.JsonRpcProvider(config.rpc);

    const { privateKey } = ethers.utils.HDNode.fromMnemonic(config.mnemonic)
      .derivePath(ethers.utils.defaultPath);
    etherswallet = new ethers.Wallet(privateKey, provider);

    snapshot = await provider.send('evm_snapshot', []);
    token = new ethers.Contract(config.contracts.rail, erc20abi, etherswallet);
    contract = new ERC20RailgunContract(config.contracts.proxy, provider);

    const balance = await token.balanceOf(etherswallet.address);
    await token.approve(contract.address, balance);
  });

  it('Should retrieve merkle root from contract', async () => {
    expect(await contract.merkleRoot()).to.equal('14fceeac99eb8419a2796d1958fc2050d489bf5a3eb170ef16a667060344ba90');
  });

  it('Should return valid merkle roots', async () => {
    expect(await contract.validateRoot(0, '14fceeac99eb8419a2796d1958fc2050d489bf5a3eb170ef16a667060344ba90')).to.equal(true);
    expect(await contract.validateRoot(0, '09981e69d3ecf345fb3e2e48243889aa4ff906423d6a686005cac572a3a9632d')).to.equal(false);
  });

  it('Should create serialized transactions', async () => {
    // Create deposit
    const deposit = await contract.generateDeposit([
      new ERC20Note(
        'c95956104f69131b1c269c30688d3afedd0c3a155d270e862ea4c1f89a603a1b',
        '1e686e7506b0f4f21d6991b4cb58d39e77c31ed0577a986750c8dce8804af5b9',
        new BN('11000000000000000000000000', 10),
        '5FbDB2315678afecb367f032d93F642f64180aa3',
      ),
    ]);

    // Send deposit on chain
    await (await etherswallet.sendTransaction(deposit)).wait();

    // Check merkle root changed
    expect(await contract.merkleRoot()).to.equal('221bd44d30e46b3064f91c82c0a2ef8b733e67ddfe8373d2f30a7fad7c557654');

    // NOTE: HARDCODED PROOF BUNDLE IS ONLY VALID FOR TOKEN AT
    // ADDRESS 0x5FbDB2315678afecb367f032d93F642f64180aa3
    // IF THE ADDRESS CHANGES THIS PROOF WILL NEED TO BE REPLACED
    // Create transact
    const transact = await contract.transact([{
      proof: {
        a: [
          '29ce6b0fcf5c73710d87cb20e4439f1b2bf10707fcf2f3692141735871521258',
          '108ce6fe0c948c10f045492c13410518612507e9333e5906f43f4b1fab6a69e4',
        ],
        b: [
          [
            '5a73dff9016b623b2e9bbf9b6ee34f91aee75cf4dc02861eef35771bde53408',
            '7072f64e100bf164c3e047f55a89ea24a5c9dc639f099d78da28f44d03ef3c3',
          ],
          [
            '2829222e8a58b6e9458edff9e39ded18e758199273420057081e8f968eb0f899',
            '18638a259baeccb0ae8cd26268358dc79ec2282541de344d8ce75f64375eefba',
          ],
        ],
        c: [
          '2f0071d3f00bcbd47ba4d25ddae7346ffc6645faeae5a8739385296598ef62aa',
          '1c9903b32b73a4a7cf2658ca59bb386c568bb2ca6fbc8c2938a5cb2f3c7436c2',
        ],
      },
      adaptID: {
        contract: '00',
        parameters: '00',
      },
      deposit: '0',
      withdraw: '0',
      token: '00',
      withdrawAddress: '00',
      tree: '0',
      merkleroot: '221bd44d30e46b3064f91c82c0a2ef8b733e67ddfe8373d2f30a7fad7c557654',
      nullifiers: [
        '15f75defeb0075ee0e898acc70780d245ab1c19b33cfd2b855dd66faee94a5e0',
        '266fc6f8a963d83763ec82a8070632656f55066ca401fa441f612b7d172bc12a',
      ],
      commitments: [
        {
          hash: '071ed0d73cc20a7d27c7c22483bcdba033643d44d8d03c078fa3fa16a7dd097f',
          ciphertext: [
            '00000000000000000000000000000000d7247d5631212bee0b51866926877598',
            '4b789405e585c6f2857af13d276c8ffd8c7a00c6d2313f3c4dd3f2525bede758',
            'aea06be91ad4c327feed94bed517bb4eb097d45d1f8b38ec780bf8f0491d773f',
            '476b7c59c28ee3e45a03a2b87932621488ad757f396d6266eba61d81a8c91811',
            '9c492fc96e871739d7f1f41985c527ffbd0912a1e82b40c89c4a2ac02ab22749',
            '09c77d5004f3f8ef0c18a52651acc10a5863ff7ab22cf4ced3f05f9dfe64f699',
          ],
          senderPublicKey: '87c4536d7d66880e9845dc92501356e4cef35c08b01d1607c8ef42d718ad271a',
        },
        {
          hash: '2a3b8277031d4a439233c2e79dd94a84a482e9608fce1c7eeb7e5ee0bace7917',
          ciphertext: [
            '000000000000000000000000000000006fc4cbaf2f0c765dd1668e3913cd8b67',
            'c02528fbe1e0be53c5f05766cb297ca5877d61dbf28883c617d273845554e326',
            '3d8d7c0d57faede152ddcd06f0bd652fea9ea43540687e3b4234872d78e70136',
            '8ea041edc1392b03438c3b63783ae64b081b5fa60ed80f3cf9379ea3374b8bbc',
            '8165f5272781829110fc8cfa88ba6147d05f3bb5efc730097bb4529f26eb9fb1',
            '6003d4743640ad0982fb4d6b41a29aa1eea8716bedd53c82f0cf3a3035691fa4',
          ],
          senderPublicKey: 'd957924ce81d1b2a6fef3658aadd41bc9ac2142c93f289722cd2f006d4b52c1d',
        },
        {
          hash: '2bc4940dd867f281cfd0c19ca3311def6fb8d9086b9ab59028ac58002f906e0f',
          ciphertext: [
            '0000000000000000000000000000000024986061b81240648fcc532f64c1243e',
            '1a19243bf727f03e59cf77e6a2ac6a0e5e0a6b5b986acd591cfbcba713ad1957',
            'b4f66062caf4a0dcbd5e54420b979e1fb0489e2f9af10314e6496881a16e3a9c',
            '9df9c33274ecfc62cf39aa5b93e3354de064c5a4b88a17b2681a18ba061a4d4d',
            '4c02d9dbeae3e72aeea7190348efeb94a663b1261f4c0e05099d0b5626d4fc65',
            '5c30564738fef175c47fd4856ff2418d7a62d1cbee47e79fab63199f0a54015a',
          ],
          senderPublicKey: '1e455cb30b1a973453914b8ba23e567f7bf09dbe07c0c5bae0d108f016f04b04',
        },
      ],
    }]);

    // Send transact on chain
    await (await etherswallet.sendTransaction(transact)).wait();

    // Check merkle root changed
    expect(await contract.merkleRoot()).to.equal('a443b492ccf3b2362cca069c2d0450f0ffd41286b270470a497a9627c76598');
  });

  it('Should parse tree update events', async () => {
    let result;

    contract.treeUpdates((tree: number, startPosition: number, leaves: Commitment[]) => {
      result = {
        tree,
        startPosition,
        leaves,
      };
    });

    // Create deposit
    const deposit = await contract.generateDeposit([
      new ERC20Note(
        'c95956104f69131b1c269c30688d3afedd0c3a155d270e862ea4c1f89a603a1b',
        '1e686e7506b0f4f21d6991b4cb58d39e77c31ed0577a986750c8dce8804af5b9',
        new BN('11000000000000000000000000', 10),
        '5FbDB2315678afecb367f032d93F642f64180aa3',
      ),
    ]);

    // Send deposit on chain
    etherswallet.sendTransaction(deposit);

    // Wait for events to fire
    await new Promise((resolve) => contract.contract.once('GeneratedCommitmentBatch', resolve));

    // Check result
    // @ts-ignore
    expect(result.tree).to.equal(0);
    // @ts-ignore
    expect(result.startPosition).to.equal(0);
    // @ts-ignore
    expect(result.leaves.length).to.equal(1);

    // NOTE: HARDCODED PROOF BUNDLE IS ONLY VALID FOR TOKEN AT
    // ADDRESS 0x5FbDB2315678afecb367f032d93F642f64180aa3
    // IF THE ADDRESS CHANGES THIS PROOF WILL NEED TO BE REPLACED
    // Create transact
    const transact = await contract.transact([{
      proof: {
        a: [
          '29ce6b0fcf5c73710d87cb20e4439f1b2bf10707fcf2f3692141735871521258',
          '108ce6fe0c948c10f045492c13410518612507e9333e5906f43f4b1fab6a69e4',
        ],
        b: [
          [
            '5a73dff9016b623b2e9bbf9b6ee34f91aee75cf4dc02861eef35771bde53408',
            '7072f64e100bf164c3e047f55a89ea24a5c9dc639f099d78da28f44d03ef3c3',
          ],
          [
            '2829222e8a58b6e9458edff9e39ded18e758199273420057081e8f968eb0f899',
            '18638a259baeccb0ae8cd26268358dc79ec2282541de344d8ce75f64375eefba',
          ],
        ],
        c: [
          '2f0071d3f00bcbd47ba4d25ddae7346ffc6645faeae5a8739385296598ef62aa',
          '1c9903b32b73a4a7cf2658ca59bb386c568bb2ca6fbc8c2938a5cb2f3c7436c2',
        ],
      },
      adaptID: {
        contract: '00',
        parameters: '00',
      },
      deposit: '0',
      withdraw: '0',
      token: '00',
      withdrawAddress: '00',
      tree: '0',
      merkleroot: '221bd44d30e46b3064f91c82c0a2ef8b733e67ddfe8373d2f30a7fad7c557654',
      nullifiers: [
        '15f75defeb0075ee0e898acc70780d245ab1c19b33cfd2b855dd66faee94a5e0',
        '266fc6f8a963d83763ec82a8070632656f55066ca401fa441f612b7d172bc12a',
      ],
      commitments: [
        {
          hash: '071ed0d73cc20a7d27c7c22483bcdba033643d44d8d03c078fa3fa16a7dd097f',
          ciphertext: [
            '00000000000000000000000000000000d7247d5631212bee0b51866926877598',
            '4b789405e585c6f2857af13d276c8ffd8c7a00c6d2313f3c4dd3f2525bede758',
            'aea06be91ad4c327feed94bed517bb4eb097d45d1f8b38ec780bf8f0491d773f',
            '476b7c59c28ee3e45a03a2b87932621488ad757f396d6266eba61d81a8c91811',
            '9c492fc96e871739d7f1f41985c527ffbd0912a1e82b40c89c4a2ac02ab22749',
            '09c77d5004f3f8ef0c18a52651acc10a5863ff7ab22cf4ced3f05f9dfe64f699',
          ],
          senderPublicKey: '87c4536d7d66880e9845dc92501356e4cef35c08b01d1607c8ef42d718ad271a',
        },
        {
          hash: '2a3b8277031d4a439233c2e79dd94a84a482e9608fce1c7eeb7e5ee0bace7917',
          ciphertext: [
            '000000000000000000000000000000006fc4cbaf2f0c765dd1668e3913cd8b67',
            'c02528fbe1e0be53c5f05766cb297ca5877d61dbf28883c617d273845554e326',
            '3d8d7c0d57faede152ddcd06f0bd652fea9ea43540687e3b4234872d78e70136',
            '8ea041edc1392b03438c3b63783ae64b081b5fa60ed80f3cf9379ea3374b8bbc',
            '8165f5272781829110fc8cfa88ba6147d05f3bb5efc730097bb4529f26eb9fb1',
            '6003d4743640ad0982fb4d6b41a29aa1eea8716bedd53c82f0cf3a3035691fa4',
          ],
          senderPublicKey: 'd957924ce81d1b2a6fef3658aadd41bc9ac2142c93f289722cd2f006d4b52c1d',
        },
        {
          hash: '2bc4940dd867f281cfd0c19ca3311def6fb8d9086b9ab59028ac58002f906e0f',
          ciphertext: [
            '0000000000000000000000000000000024986061b81240648fcc532f64c1243e',
            '1a19243bf727f03e59cf77e6a2ac6a0e5e0a6b5b986acd591cfbcba713ad1957',
            'b4f66062caf4a0dcbd5e54420b979e1fb0489e2f9af10314e6496881a16e3a9c',
            '9df9c33274ecfc62cf39aa5b93e3354de064c5a4b88a17b2681a18ba061a4d4d',
            '4c02d9dbeae3e72aeea7190348efeb94a663b1261f4c0e05099d0b5626d4fc65',
            '5c30564738fef175c47fd4856ff2418d7a62d1cbee47e79fab63199f0a54015a',
          ],
          senderPublicKey: '1e455cb30b1a973453914b8ba23e567f7bf09dbe07c0c5bae0d108f016f04b04',
        },
      ],
    }]);

    // Send transact on chain
    etherswallet.sendTransaction(transact);

    // Wait for events to fire
    await new Promise((resolve) => contract.contract.once('CommitmentBatch', resolve));

    // Check result
    // @ts-ignore
    expect(result.tree).to.equal(0);
    // @ts-ignore
    expect(result.startPosition).to.equal(1);
    // @ts-ignore
    expect(result.leaves.length).to.equal(3);
  }).timeout(30000);

  afterEach(async () => {
    contract.unload();
    await provider.send('evm_revert', [snapshot]);
  });
});
