/* globals describe it beforeEach afterEach */
import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';

import memdown from 'memdown';
import Database from '../../src/database';

import MerkleTree from '../../src/merkletree';
import type { TreePurpose } from '../../src/merkletree';

chai.use(chaiAsPromised);
const { expect } = chai;

// Database object
let db: Database;
let merkletree: MerkleTree;
let merkletreeNFT: MerkleTree;

describe('MerkleTree/Index', () => {
  beforeEach(async () => {
    // Create database
    db = new Database(memdown());
    merkletree = new MerkleTree(db, 0, 'erc20');
    merkletreeNFT = new MerkleTree(db, 0, 'erc721');
  });

  it('Should hash left/right correctly', () => {
    const vectors = [
      {
        left: '115cc0f5e7d690413df64c6b9662e9cf2a3617f2743245519e19607a4417189a',
        right: '2a92a4c8d7c21d97d946951043d11954de794cd506093dbbb97ada64c14b203b',
        result: '106dc6dc79863b23dc1a63c7ca40e8c22bb830e449b75a2286c7f7b0b87ae6c3',
      },
      {
        left: '0db945439b762ad08f144bcccc3746773b332e8a0045a11d87662dc227923df5',
        right: '09ce612d20912e20cde93cd2a03fcccdfdce5910242b555ff35b5373041bf329',
        result: '063c1c7dfb4b63255c492bb6b32d57eddddcb1c78cfb990e7b35416cf966ed79',
      },
      {
        left: '09cf3efaeb0190e482c9f9cf1534f17fbf0ed1537c26db9faf26f3d55140804d',
        right: '2651021f2d224338f1c9f408db74111c98e7381072b9fcd640bd4f748584e769',
        result: '1576a4dd906cab90e381775c1c9bb1d713f7f02c7ec0911a8bc38a1c4b0bf69e',
      },
    ];

    vectors.forEach((vector) => {
      expect(MerkleTree.hashLeftRight(vector.left, vector.right))
        .to.equal(vector.result);
    });
  });

  it('Should calculate zero values correctly', () => {
    const testVector = [
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
      '14fceeac99eb8419a2796d1958fc2050d489bf5a3eb170ef16a667060344ba90',
    ];

    const testVectorNFT = [
      '0488f89b25bc7011eaf6a5edce71aeafb9fe706faa3c0a5cd9cbe868ae3b9ffc',
      '01c405064436affeae1fc8e30b2e417b4243bbb819adca3b55bb32efc3e43a4f',
      '0888d37652d10d1781db54b70af87b42a2916e87118f507218f9a42a58e85ed2',
      '183f531ead7217ebc316b4c02a2aad5ad87a1d56d4fb9ed81bf84f644549eaf5',
      '093c48f1ecedf2baec231f0af848a57a76c6cf05b290a396707972e1defd17df',
      '1437bb465994e0453357c17a676b9fdba554e215795ebc17ea5012770dfb77c7',
      '12359ef9572912b49f44556b8bbbfa69318955352f54cfa35cb0f41309ed445a',
      '2dc656dadc82cf7a4707786f4d682b0f130b6515f7927bde48214d37ec25a46c',
      '2500bdfc1592791583acefd050bc439a87f1d8e8697eb773e8e69b44973e6fdc',
    ];

    expect(merkletree.zeroValues).to.deep.equal(testVector);
    expect(merkletreeNFT.zeroValues).to.deep.equal(testVectorNFT);
  });

  it('Should get DB paths correctly', () => {
    type Vector = {
      chainID: number;
      purpose: TreePurpose;
      treeNumber: number;
      level: number;
      index: number;
      result: string[];
    }

    const vectors: Vector[] = [
      {
        chainID: 0,
        purpose: 'erc20',
        treeNumber: 0,
        level: 1,
        index: 5,
        result: [
          '0000000000000000000000000000000000000000000000000000000000000000',
          '000000000000000000000000000000006d65726b6c65747265652d6572633230',
          '0000000000000000000000000000000000000000000000000000000000000000',
          '0000000000000000000000000000000000000000000000000000000000000001',
          '0000000000000000000000000000000000000000000000000000000000000005',
        ],
      },
      {
        chainID: 4,
        purpose: 'erc20',
        treeNumber: 2,
        level: 7,
        index: 10,
        result: [
          '0000000000000000000000000000000000000000000000000000000000000004',
          '000000000000000000000000000000006d65726b6c65747265652d6572633230',
          '0000000000000000000000000000000000000000000000000000000000000002',
          '0000000000000000000000000000000000000000000000000000000000000007',
          '000000000000000000000000000000000000000000000000000000000000000a',
        ],
      },
      {
        chainID: 3,
        purpose: 'erc721',
        treeNumber: 1,
        level: 9,
        index: 14,
        result: [
          '0000000000000000000000000000000000000000000000000000000000000003',
          '0000000000000000000000000000006d65726b6c65747265652d657263373231',
          '0000000000000000000000000000000000000000000000000000000000000001',
          '0000000000000000000000000000000000000000000000000000000000000009',
          '000000000000000000000000000000000000000000000000000000000000000e',
        ],
      },
    ];

    vectors.forEach((vector) => {
      const merkletreeVectorTest = new MerkleTree(db, vector.chainID, vector.purpose);

      expect(merkletreeVectorTest.getTreeDBPrefix(vector.treeNumber))
        .to.deep.equal(vector.result.slice(0, 3));

      expect(merkletreeVectorTest.getNodeDBPath(vector.treeNumber, vector.level, vector.index))
        .to.deep.equal(vector.result);
    });
  });

  it('Should get empty merkle root correctly', async () => {
    expect(await merkletree.getRoot(0)).to.equal('14fceeac99eb8419a2796d1958fc2050d489bf5a3eb170ef16a667060344ba90');
    expect(await merkletreeNFT.getRoot(0)).to.equal('2500bdfc1592791583acefd050bc439a87f1d8e8697eb773e8e69b44973e6fdc');
  });

  it('Should update merkle tree correctly', async () => {
    expect(await merkletree.getRoot(0)).to.equal('14fceeac99eb8419a2796d1958fc2050d489bf5a3eb170ef16a667060344ba90');

    await merkletree.insertLeaves(0, [
      '0000000000000000000000000000000000000000000000000000000000000001',
      '0000000000000000000000000000000000000000000000000000000000000002',
      '0000000000000000000000000000000000000000000000000000000000000003',
    ], 0);

    expect(await merkletree.getRoot(0)).to.equal('2e1f312e4ead9cd1594ffa4c020578c155ea0552b3d96136ae68b83efa15d912');

    await merkletree.insertLeaves(0, [
      '0000000000000000000000000000000000000000000000000000000000000004',
    ], 3);

    expect(await merkletree.getRoot(0)).to.equal('2f4c02f094b5c881b9a2d25539d50bc839652b96acb147b81181922064b25f29');

    await merkletree.insertLeaves(0, [
      '0000000000000000000000000000000000000000000000000000000000000005',
    ], 4);

    expect(await merkletree.getRoot(0)).to.equal('1ad4d800e15fac5591e35bd7a92e4dbc4af312958d9629d84e73e6c338f5da81');

    await merkletree.insertLeaves(0, [
      'ab2f9d1ebd74c3e1f1ccee452a80ae27a94f14a542a4fd8b0c9ad9a1b7f9ffe5',
      '8902638fe6fc05e4f1cd7c06940d6217591a0ccb003ed45198782fbff38e9f2d',
      '19889087c2ff4c4a164060a832a3ba11cce0c2e2dbd42da10c57101efb966fcd',
      '9f5e8310e384c6a0840699951d67810c6d90fd3f265bda66e9385fcb7142373d',
      '4c71361b89e9b6b55b094a0f0de4451d8306786b2626d67b3810c9b61fbf45b6',
      'b2eabd832f0bb9d8b42399a56821a565eec64669d7a55b828c8af2a541b044d6',
      '817e6732d170352ea6517c9640757570d4ea71c660603f9d7a060b2f2eb27be6',
    ], 5);

    expect(await merkletree.getRoot(0)).to.equal('1955726bb6619868e0435b3342b33644c8ecc9579bcbc31b41e0175d766a1e5c');
  });

  it('Should queue tree updates correctly', async () => {
    expect(await merkletree.getRoot(0)).to.equal('14fceeac99eb8419a2796d1958fc2050d489bf5a3eb170ef16a667060344ba90');

    await merkletree.queueLeaves(0, [
      'ab2f9d1ebd74c3e1f1ccee452a80ae27a94f14a542a4fd8b0c9ad9a1b7f9ffe5',
      '8902638fe6fc05e4f1cd7c06940d6217591a0ccb003ed45198782fbff38e9f2d',
      '19889087c2ff4c4a164060a832a3ba11cce0c2e2dbd42da10c57101efb966fcd',
      '9f5e8310e384c6a0840699951d67810c6d90fd3f265bda66e9385fcb7142373d',
      '4c71361b89e9b6b55b094a0f0de4451d8306786b2626d67b3810c9b61fbf45b6',
      'b2eabd832f0bb9d8b42399a56821a565eec64669d7a55b828c8af2a541b044d6',
      '817e6732d170352ea6517c9640757570d4ea71c660603f9d7a060b2f2eb27be6',
    ], 5);

    expect(await merkletree.getRoot(0)).to.equal('14fceeac99eb8419a2796d1958fc2050d489bf5a3eb170ef16a667060344ba90');

    await merkletree.queueLeaves(0, [
      '0000000000000000000000000000000000000000000000000000000000000004',
    ], 3);

    expect(await merkletree.getRoot(0)).to.equal('14fceeac99eb8419a2796d1958fc2050d489bf5a3eb170ef16a667060344ba90');

    await merkletree.queueLeaves(0, [
      '0000000000000000000000000000000000000000000000000000000000000001',
      '0000000000000000000000000000000000000000000000000000000000000002',
      '0000000000000000000000000000000000000000000000000000000000000003',
    ], 0);

    expect(await merkletree.getRoot(0)).to.equal('2f4c02f094b5c881b9a2d25539d50bc839652b96acb147b81181922064b25f29');

    await Promise.all([
      merkletree.queueLeaves(0, [
        '0000000000000000000000000000000000000000000000000000000000000005',
      ], 4),
      merkletree.queueLeaves(0, [
        '0000000000000000000000000000000000000000000000000000000000000005',
      ], 4),
    ]);

    expect(await merkletree.getRoot(0)).to.equal('1955726bb6619868e0435b3342b33644c8ecc9579bcbc31b41e0175d766a1e5c');
  });

  afterEach(() => {
    // Clean up database
    db.level.close();
  });
});
