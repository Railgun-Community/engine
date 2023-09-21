import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import memdown from 'memdown';
import { Chain, ChainType } from '../../models/engine-types';
import { Database } from '../../database/database';
import { RailgunTxidMerkletree } from '../railgun-txid-merkletree';
import { RailgunTransaction } from '../../models';
import {
  createRailgunTransactionWithID,
  getRailgunTransactionID,
} from '../../transaction/railgun-txid';

chai.use(chaiAsPromised);
const { expect } = chai;

// Database object
let db: Database;
let merkletree: RailgunTxidMerkletree;

const chain: Chain = {
  type: 0,
  id: 0,
};

describe('Railgun Txid Merkletree', () => {
  beforeEach(async () => {
    // Create database
    db = new Database(memdown());
    merkletree = await RailgunTxidMerkletree.createForPOINode(db, chain);
  });

  it('Should get Txid merkletree DB paths', async () => {
    type Vector = {
      chain: Chain;
      treeNumber: number;
      level: number;
      index: number;
      result: string[];
    };

    const vectors: Vector[] = [
      {
        chain: { type: ChainType.EVM, id: 0 },
        treeNumber: 0,
        level: 1,
        index: 5,
        result: [
          '0000000000000000007261696c67756e2d7472616e73616374696f6e2d696473',
          '0000000000000000000000000000000000000000000000000000000000000000',
          '0000000000000000000000000000000000000000000000000000000000000000',
          '0000000000000000000000000000000000000000000000000000000000000001',
          '0000000000000000000000000000000000000000000000000000000000000005',
        ],
      },
      {
        chain: { type: ChainType.EVM, id: 4 },
        treeNumber: 2,
        level: 7,
        index: 10,
        result: [
          '0000000000000000007261696c67756e2d7472616e73616374696f6e2d696473',
          '0000000000000000000000000000000000000000000000000000000000000004',
          '0000000000000000000000000000000000000000000000000000000000000002',
          '0000000000000000000000000000000000000000000000000000000000000007',
          '000000000000000000000000000000000000000000000000000000000000000a',
        ],
      },
    ];

    await Promise.all(
      vectors.map(async (vector) => {
        const merkletreeVectorTest = await RailgunTxidMerkletree.createForPOINode(db, vector.chain);

        expect(merkletreeVectorTest.getTreeDBPrefix(vector.treeNumber)).to.deep.equal(
          vector.result.slice(0, 3),
        );

        expect(
          merkletreeVectorTest.getNodeHashDBPath(vector.treeNumber, vector.level, vector.index),
        ).to.deep.equal(vector.result);
      }),
    );
  });

  it('Should update railgun txid merkle tree correctly', async () => {
    expect(await merkletree.getRoot(0)).to.equal(
      '14fceeac99eb8419a2796d1958fc2050d489bf5a3eb170ef16a667060344ba90',
    );

    const railgunTransactions: RailgunTransaction[] = [
      {
        graphID: '0x00',
        commitments: ['0x01', '0x02'],
        nullifiers: ['0x03', '0x04'],
        boundParamsHash: '0x05',
        blockNumber: 0,
      },
      {
        graphID: '0x10',
        commitments: ['0x11', '0x12'],
        nullifiers: ['0x13', '0x14'],
        boundParamsHash: '0x15',
        blockNumber: 0,
      },
    ];
    const railgunTransactionsWithTxids = railgunTransactions.map(createRailgunTransactionWithID);

    await merkletree.queueRailgunTransactions(railgunTransactionsWithTxids, 1);
    expect(await merkletree.getTreeLength(0)).to.equal(0);

    await merkletree.updateTreesFromWriteQueue();

    expect(await merkletree.getTreeLength(0)).to.equal(2);
    expect(await merkletree.getRoot(0)).to.equal(
      '1081c0077932089cfac896f19df70bdfd6d4daed346afc8779af0f13476a4353',
    );

    expect(await merkletree.getHistoricalMerkleroot(0, 0)).to.equal(
      '18b67a3ae2c2abf315897a8a2f47e9df50ee757e1760b9eeec1ad9272c2dec48',
    );
    expect(await merkletree.getHistoricalMerkleroot(0, 1)).to.equal(
      '1081c0077932089cfac896f19df70bdfd6d4daed346afc8779af0f13476a4353',
    );

    // Ensure stored hash is correct
    const railgunTransaction = await merkletree.getRailgunTransaction(0, 0);
    const hash: string = getRailgunTransactionID(railgunTransactions[0]).toString();
    expect(hash).to.equal(
      '17950133044911973828130962356772411646037989291035973150567495873917534644512',
    );
    expect(railgunTransaction).to.deep.equal({
      ...railgunTransactions[0],
      hash,
    });

    expect(
      await merkletree.getRailgunTxidsForNullifiers(['0x03', '0x0103', '0x0213', '0x1111111']),
    ).to.deep.equal({
      '0x0103': undefined,
      '0x0213': undefined,
      '0x03': '17950133044911973828130962356772411646037989291035973150567495873917534644512',
      '0x1111111': undefined,
    });
    expect(
      await merkletree.getRailgunTxidsForCommitments(['0x01', '0x0101', '0x0211', '0x1111111']),
    ).to.deep.equal({
      '0x0101': undefined,
      '0x0211': undefined,
      '0x01': '17950133044911973828130962356772411646037989291035973150567495873917534644512',
      '0x1111111': undefined,
    });

    expect(
      await merkletree.getRailgunTxidCurrentMerkletreeData(
        '17950133044911973828130962356772411646037989291035973150567495873917534644512',
      ),
    ).to.deep.equal({
      railgunTransaction: {
        graphID: '0x00',
        commitments: ['0x01', '0x02'],
        nullifiers: ['0x03', '0x04'],
        boundParamsHash: '0x05',
        blockNumber: 0,
        hash: '17950133044911973828130962356772411646037989291035973150567495873917534644512',
      },
      currentTxidIndexForTree: 1,
      currentMerkleProofForTree: {
        elements: [
          '17950133044911973828130962356772411646037989291035973150567495873917534644512',
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
        ],
        indices: '01',
        leaf: '11934703375483089280244820234609091536431576513800209926563596616012901678112',
        root: '1081c0077932089cfac896f19df70bdfd6d4daed346afc8779af0f13476a4353',
      },
    });

    expect(
      await merkletree.getRailgunTransactionByTxid(
        '17950133044911973828130962356772411646037989291035973150567495873917534644512',
      ),
    ).to.deep.equal({
      graphID: '0x00',
      commitments: ['0x01', '0x02'],
      nullifiers: ['0x03', '0x04'],
      boundParamsHash: '0x05',
      blockNumber: 0,
      hash: '17950133044911973828130962356772411646037989291035973150567495873917534644512',
    });

    // Make sure new constructed tree inherits db values
    const merkletree2 = await RailgunTxidMerkletree.createForPOINode(db, chain);
    const treeLength2 = await merkletree2.getTreeLength(0);
    expect(treeLength2).to.equal(2);

    const moreRailgunTransactions: RailgunTransaction[] = [
      {
        graphID: '0x02',
        commitments: ['0x0101', '0x0102'],
        nullifiers: ['0x0103', '0x0104'],
        boundParamsHash: '0x0105',
        blockNumber: 0,
      },
      {
        graphID: '0x13',
        commitments: ['0x0211', '0x0212'],
        nullifiers: ['0x0213', '0x0214'],
        boundParamsHash: '0x0215',
        blockNumber: 0,
      },
    ];
    const moreRailgunTransactionsWithTxids = moreRailgunTransactions.map(
      createRailgunTransactionWithID,
    );

    await merkletree.queueRailgunTransactions(moreRailgunTransactionsWithTxids, undefined);
    await merkletree.updateTreesFromWriteQueue();

    expect(
      await merkletree.getRailgunTxidsForNullifiers(['0x03', '0x0103', '0x0213', '0x1111111']),
    ).to.deep.equal({
      '0x0103': '16202346701867999176730450400871741378312930716998375241294817425983735234446',
      '0x0213': '13108638026526642281447854845434934239544749734798020789855247093078646267284',
      '0x03': '17950133044911973828130962356772411646037989291035973150567495873917534644512',
      '0x1111111': undefined,
    });
    expect(
      await merkletree.getRailgunTxidsForCommitments(['0x01', '0x0101', '0x0211', '0x1111111']),
    ).to.deep.equal({
      '0x0101': '16202346701867999176730450400871741378312930716998375241294817425983735234446',
      '0x0211': '13108638026526642281447854845434934239544749734798020789855247093078646267284',
      '0x01': '17950133044911973828130962356772411646037989291035973150567495873917534644512',
      '0x1111111': undefined,
    });

    // Current root (4 elements)
    expect(await merkletree.getRoot(0)).to.equal(
      '1c8badf499b6d43aa80c098c5b0351f7ae22683b4a862e774737b5fa1bffaa37',
    );

    // Rebuild entire tree and check that merkleroot is the same
    await merkletree.rebuildAndWriteTree(0);
    expect(await merkletree.getRoot(0)).to.equal(
      '1c8badf499b6d43aa80c098c5b0351f7ae22683b4a862e774737b5fa1bffaa37',
    );

    await merkletree.clearLeavesAfterTxidIndex(0);

    // Current tree root (1 element)
    expect(await merkletree.getRoot(0)).to.equal(
      '18b67a3ae2c2abf315897a8a2f47e9df50ee757e1760b9eeec1ad9272c2dec48',
    );

    // DB historical roots
    expect(await merkletree.getHistoricalMerklerootForTxidIndex(0)).to.equal(
      '18b67a3ae2c2abf315897a8a2f47e9df50ee757e1760b9eeec1ad9272c2dec48',
    );
    expect(await merkletree.getHistoricalMerklerootForTxidIndex(1)).to.equal(undefined);
    expect(await merkletree.getHistoricalMerklerootForTxidIndex(2)).to.equal(undefined);
  }).timeout(20000);

  it('Should get next tree and index', async () => {
    expect(RailgunTxidMerkletree.nextTreeAndIndex(0, 0)).to.deep.equal({ tree: 0, index: 1 });
    expect(RailgunTxidMerkletree.nextTreeAndIndex(1, 65535)).to.deep.equal({ tree: 2, index: 0 });
  });

  it('Should get tree and index from txidIndex', async () => {
    expect(RailgunTxidMerkletree.getTreeAndIndexFromTxidIndex(9)).to.deep.equal({
      tree: 0,
      index: 9,
    });
    expect(RailgunTxidMerkletree.getTreeAndIndexFromTxidIndex(65535)).to.deep.equal({
      tree: 0,
      index: 65535,
    });
    expect(RailgunTxidMerkletree.getTreeAndIndexFromTxidIndex(65536)).to.deep.equal({
      tree: 1,
      index: 0,
    });
  });
});
