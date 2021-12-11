/* globals describe it beforeEach */
import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';

// @ts-ignore
import artifacts from 'railgun-artifacts';

import {
  Prover,
  Artifacts,
  Circuits,
  ERC20PrivateInputs,
} from '../../src/prover';

chai.use(chaiAsPromised);
const { expect } = chai;

// eslint-disable-next-line no-unused-vars
let prover: Prover;

async function artifactsGetter(circuit: Circuits): Promise<Artifacts> {
  if (circuit === 'erc20small') {
    return artifacts.small;
  }

  return artifacts.large;
}

const erc20TestVector: ERC20PrivateInputs = {
  type: 'erc20',
  adaptID: '03b075046b71ff5f8e0792de4b82ddc979fcb3b8c03abe12972e65c57759fb46',
  tokenField: '01',
  depositAmount: '03',
  withdrawAmount: '00',
  outputTokenField: '01',
  outputEthAddress: '00',
  randomIn: [
    '1322dbe7ddedffef09d00f350cdabe3c8f4dd38d5c47982fd63a87b943a4865d',
    '12ddbcebd7661561b5a23d964ea285e259e4a64e8091b7ab6401f1fe6ba45878',
  ],
  valuesIn: ['01', '02'],
  spendingKeys: [
    '0ee1c30f9380bf75eac1786522c6420fad0a56a83239e5bbd06795254891dc81',
    '0bcf28cfd8ed0291e58e9c2fb8dee877eaa1d9730d82e55775ab923cb24e7de2',
  ],
  treeNumber: '00',
  merkleRoot: '2f6c4330831c18d7c2589b8decb033a240411a7081d74f91518c49fb834193c9',
  nullifiers: [
    '1bca2b3dd7bb7ef965dbff2bdb277983c6cfd31506261262c10a08b856b52338',
    '050c649d5025621f09f0e9b6e522ae7685f373fadc35bd895f82ca0ffa752c3a',
  ],
  pathElements: [[
    '2a6bc1761046f6f98b517a6bf37be53b70e3d1a64723dfb9533f5ebeec9e6f35',
    '14161d95010e13b2196155530ed9c9de91d561604b016902fe86cd2d865b3dce',
    '0179b793d6bb41b634f2e2e0773b5f2e180f7df14729432e987007f74c2637e4',
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
  ], [
    '1ba9d86628b33235662e01592aa4ae97db7320a1cb5320145866ebfc2ce6b05f',
    '14161d95010e13b2196155530ed9c9de91d561604b016902fe86cd2d865b3dce',
    '0179b793d6bb41b634f2e2e0773b5f2e180f7df14729432e987007f74c2637e4',
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
  ]],
  pathIndices: ['00', '01'],
  recipientPK: [
    '2c250462016b4d1f61f020db75c0649d6e5f3aaa1a685cd8280bd7f8f147d413',
    '3e12d6088b4a5ca9646c127952d4ac640ea8b65422bc4844fd92da95b9b7ae81',
    '518fea0f27545cdbcef0933fcdfa224fb19227edb8f01102450f6a3169e4c110',
  ],
  randomOut: [
    '1a7b8877fcf59d5cef0c3bd67e54b4dff3a33298faefe2746713276666274c3b',
    '148ddd8f81585c4f76d7ecac9bb57839accee5ac8f6d948256e2d13425aaaee8',
    '26f0ecffb3094ac66866314018155b0980fb7ae886945cb4dc74b4325590eba9',
  ],
  valuesOut: ['01', '02', '03'],
  commitmentsOut: [
    '29e4809eb2d8ef7858864f5d4c0e1de765ac1d5d732c207fb474dbbecc010bc5',
    '2fc6c08afd44ab9fc3e104ae5db9b3723fd1ed073a3b3bf2da682935788c6360',
    '2adc28c56eedb6203e8d290963023c4435f3a7ff749410df339ea4a02133623b',
  ],
  ciphertextHash: '2f7d57a19b96d0d856b4ed3e274a146b8cacb2762397532069bb946a494703a0',
};

describe('Prover/Index', () => {
  beforeEach(async () => {
    prover = new Prover(artifactsGetter);
  });

  it('Should calculate inputs hash', async () => {
    expect(Prover.hashInputs(erc20TestVector)).to.equal('2d0eaa4d90dd738bf8a7232f4c1be0634f4f38a06bb3c17bd07d7f5c35e00601');
  });

  it('Should convert private inputs to public inputs', async () => {
    expect(Prover.privateToPublicInputs(erc20TestVector)).to.deep.equal({
      type: 'erc20',
      adaptID: '03b075046b71ff5f8e0792de4b82ddc979fcb3b8c03abe12972e65c57759fb46',
      depositAmount: '03',
      withdrawAmount: '00',
      outputTokenField: '01',
      outputEthAddress: '00',
      treeNumber: '00',
      merkleRoot: '2f6c4330831c18d7c2589b8decb033a240411a7081d74f91518c49fb834193c9',
      nullifiers: [
        '1bca2b3dd7bb7ef965dbff2bdb277983c6cfd31506261262c10a08b856b52338',
        '050c649d5025621f09f0e9b6e522ae7685f373fadc35bd895f82ca0ffa752c3a',
      ],
      commitmentsOut: [
        '29e4809eb2d8ef7858864f5d4c0e1de765ac1d5d732c207fb474dbbecc010bc5',
        '2fc6c08afd44ab9fc3e104ae5db9b3723fd1ed073a3b3bf2da682935788c6360',
        '2adc28c56eedb6203e8d290963023c4435f3a7ff749410df339ea4a02133623b',
      ],
      ciphertextHash: '2f7d57a19b96d0d856b4ed3e274a146b8cacb2762397532069bb946a494703a0',
    });
  });

  it('Should format private inputs', async () => {
    expect(Prover.formatPrivateInputs(erc20TestVector)).to.deep.equal({
      hashOfInputs: '0x2d0eaa4d90dd738bf8a7232f4c1be0634f4f38a06bb3c17bd07d7f5c35e00601',
      adaptID: '0x03b075046b71ff5f8e0792de4b82ddc979fcb3b8c03abe12972e65c57759fb46',
      tokenField: '0x01',
      depositAmount: '0x03',
      withdrawAmount: '0x00',
      outputTokenField: '0x01',
      outputEthAddress: '0x00',
      randomIn: [
        '0x1322dbe7ddedffef09d00f350cdabe3c8f4dd38d5c47982fd63a87b943a4865d',
        '0x12ddbcebd7661561b5a23d964ea285e259e4a64e8091b7ab6401f1fe6ba45878',
      ],
      valuesIn: ['0x01', '0x02'],
      spendingKeys: [
        '0x0ee1c30f9380bf75eac1786522c6420fad0a56a83239e5bbd06795254891dc81',
        '0x0bcf28cfd8ed0291e58e9c2fb8dee877eaa1d9730d82e55775ab923cb24e7de2',
      ],
      treeNumber: '0x00',
      merkleRoot: '0x2f6c4330831c18d7c2589b8decb033a240411a7081d74f91518c49fb834193c9',
      nullifiers: [
        '0x1bca2b3dd7bb7ef965dbff2bdb277983c6cfd31506261262c10a08b856b52338',
        '0x050c649d5025621f09f0e9b6e522ae7685f373fadc35bd895f82ca0ffa752c3a',
      ],
      pathElements: [[
        '0x2a6bc1761046f6f98b517a6bf37be53b70e3d1a64723dfb9533f5ebeec9e6f35',
        '0x14161d95010e13b2196155530ed9c9de91d561604b016902fe86cd2d865b3dce',
        '0x0179b793d6bb41b634f2e2e0773b5f2e180f7df14729432e987007f74c2637e4',
        '0x183f531ead7217ebc316b4c02a2aad5ad87a1d56d4fb9ed81bf84f644549eaf5',
        '0x093c48f1ecedf2baec231f0af848a57a76c6cf05b290a396707972e1defd17df',
        '0x1437bb465994e0453357c17a676b9fdba554e215795ebc17ea5012770dfb77c7',
        '0x12359ef9572912b49f44556b8bbbfa69318955352f54cfa35cb0f41309ed445a',
        '0x2dc656dadc82cf7a4707786f4d682b0f130b6515f7927bde48214d37ec25a46c',
        '0x2500bdfc1592791583acefd050bc439a87f1d8e8697eb773e8e69b44973e6fdc',
        '0x244ae3b19397e842778b254cd15c037ed49190141b288ff10eb1390b34dc2c31',
        '0x0ca2b107491c8ca6e5f7e22403ea8529c1e349a1057b8713e09ca9f5b9294d46',
        '0x18593c75a9e42af27b5e5b56b99c4c6a5d7e7d6e362f00c8e3f69aeebce52313',
        '0x17aca915b237b04f873518947a1f440f0c1477a6ac79299b3be46858137d4bfb',
        '0x2726c22ad3d9e23414887e8233ee83cc51603f58c48a9c9e33cb1f306d4365c0',
        '0x08c5bd0f85cef2f8c3c1412a2b69ee943c6925ecf79798bb2b84e1b76d26871f',
        '0x27f7c465045e0a4d8bec7c13e41d793734c50006ca08920732ce8c3096261435',
      ], [
        '0x1ba9d86628b33235662e01592aa4ae97db7320a1cb5320145866ebfc2ce6b05f',
        '0x14161d95010e13b2196155530ed9c9de91d561604b016902fe86cd2d865b3dce',
        '0x0179b793d6bb41b634f2e2e0773b5f2e180f7df14729432e987007f74c2637e4',
        '0x183f531ead7217ebc316b4c02a2aad5ad87a1d56d4fb9ed81bf84f644549eaf5',
        '0x093c48f1ecedf2baec231f0af848a57a76c6cf05b290a396707972e1defd17df',
        '0x1437bb465994e0453357c17a676b9fdba554e215795ebc17ea5012770dfb77c7',
        '0x12359ef9572912b49f44556b8bbbfa69318955352f54cfa35cb0f41309ed445a',
        '0x2dc656dadc82cf7a4707786f4d682b0f130b6515f7927bde48214d37ec25a46c',
        '0x2500bdfc1592791583acefd050bc439a87f1d8e8697eb773e8e69b44973e6fdc',
        '0x244ae3b19397e842778b254cd15c037ed49190141b288ff10eb1390b34dc2c31',
        '0x0ca2b107491c8ca6e5f7e22403ea8529c1e349a1057b8713e09ca9f5b9294d46',
        '0x18593c75a9e42af27b5e5b56b99c4c6a5d7e7d6e362f00c8e3f69aeebce52313',
        '0x17aca915b237b04f873518947a1f440f0c1477a6ac79299b3be46858137d4bfb',
        '0x2726c22ad3d9e23414887e8233ee83cc51603f58c48a9c9e33cb1f306d4365c0',
        '0x08c5bd0f85cef2f8c3c1412a2b69ee943c6925ecf79798bb2b84e1b76d26871f',
        '0x27f7c465045e0a4d8bec7c13e41d793734c50006ca08920732ce8c3096261435',
      ]],
      pathIndices: ['0x00', '0x01'],
      recipientPK: [
        [
          '0x17c56cf028b0bec412eece0ef70ca2423638b1c21e1bd3a3a78cce9a9dbba1c6',
          '0x13d447f1f8d70b28d85c681aaa3a5f6e9d64c075db20f0611f4d6b016204252c',
        ], [
          '0x304a98f1fe7d8bf92257b7536dcfe749cdda2b094879c3eb39fe7485057583e7',
          '0x01aeb7b995da92fd4448bc2254b6a80e64acd45279126c64a95c4a8b08d6123e',
        ], [
          '0x0437475e917458be45bb44f401af0d501f8f72a683e928ec645f0cfb19429ded',
          '0x10c1e469316a0f450211f0b8ed2792b14f22facd3f93f0cedb5c54270fea8f51',
        ],
      ],
      randomOut: [
        '0x1a7b8877fcf59d5cef0c3bd67e54b4dff3a33298faefe2746713276666274c3b',
        '0x148ddd8f81585c4f76d7ecac9bb57839accee5ac8f6d948256e2d13425aaaee8',
        '0x26f0ecffb3094ac66866314018155b0980fb7ae886945cb4dc74b4325590eba9',
      ],
      valuesOut: ['0x01', '0x02', '0x03'],
      commitmentsOut: [
        '0x29e4809eb2d8ef7858864f5d4c0e1de765ac1d5d732c207fb474dbbecc010bc5',
        '0x2fc6c08afd44ab9fc3e104ae5db9b3723fd1ed073a3b3bf2da682935788c6360',
        '0x2adc28c56eedb6203e8d290963023c4435f3a7ff749410df339ea4a02133623b',
      ],
      ciphertextHash: '0x2f7d57a19b96d0d856b4ed3e274a146b8cacb2762397532069bb946a494703a0',
    });
  });

  it('Should calculate proofs', async () => {
    expect((await prover.prove('erc20small', erc20TestVector)).inputs).to.deep.equal({
      type: 'erc20',
      adaptID: '03b075046b71ff5f8e0792de4b82ddc979fcb3b8c03abe12972e65c57759fb46',
      depositAmount: '03',
      withdrawAmount: '00',
      outputTokenField: '01',
      outputEthAddress: '00',
      treeNumber: '00',
      merkleRoot: '2f6c4330831c18d7c2589b8decb033a240411a7081d74f91518c49fb834193c9',
      nullifiers: [
        '1bca2b3dd7bb7ef965dbff2bdb277983c6cfd31506261262c10a08b856b52338',
        '050c649d5025621f09f0e9b6e522ae7685f373fadc35bd895f82ca0ffa752c3a',
      ],
      commitmentsOut: [
        '29e4809eb2d8ef7858864f5d4c0e1de765ac1d5d732c207fb474dbbecc010bc5',
        '2fc6c08afd44ab9fc3e104ae5db9b3723fd1ed073a3b3bf2da682935788c6360',
        '2adc28c56eedb6203e8d290963023c4435f3a7ff749410df339ea4a02133623b',
      ],
      ciphertextHash: '2f7d57a19b96d0d856b4ed3e274a146b8cacb2762397532069bb946a494703a0',
    });

    const erc20TestVectorInvalid = erc20TestVector;
    erc20TestVectorInvalid.tokenField = '02';

    await expect(prover.prove('erc20small', erc20TestVectorInvalid)).to.eventually.be.rejectedWith('Proof generation failed');
  }).timeout(120000);
});
