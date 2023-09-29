/* eslint-disable no-await-in-loop */
import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import memdown from 'memdown';
import { Chain, ChainType } from '../../models/engine-types';
import { Database } from '../../database/database';
import { RailgunTxidMerkletree } from '../railgun-txid-merkletree';
import { RailgunTransaction, TXIDVersion } from '../../models';
import {
  createRailgunTransactionWithID,
  getRailgunTransactionID,
} from '../../transaction/railgun-txid';
import { ByteLength, nToHex } from '../../utils/bytes';
import { verifyMerkleProof } from '../merkle-proof';

chai.use(chaiAsPromised);
const { expect } = chai;

// Database object
let db: Database;
let merkletreePOINode: RailgunTxidMerkletree;
let merkletreeWallet: RailgunTxidMerkletree;

const chain: Chain = {
  type: 0,
  id: 0,
};

const poiLaunchBlock = 3;

describe('Railgun Txid Merkletree', () => {
  beforeEach(async () => {
    // Create database
    db = new Database(memdown());

    merkletreePOINode = await RailgunTxidMerkletree.createForPOINode(db, chain, poiLaunchBlock);
    expect(merkletreePOINode.shouldStoreMerkleroots).to.equal(true);

    merkletreeWallet = await RailgunTxidMerkletree.createForWallet(
      db,
      chain,
      poiLaunchBlock,
      async () => true,
    );
    expect(merkletreeWallet.shouldStoreMerkleroots).to.equal(false);
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
        const merkletreeVectorTest = await RailgunTxidMerkletree.createForPOINode(
          db,
          vector.chain,
          undefined,
        );

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
    // eslint-disable-next-line no-restricted-syntax
    for (const merkletree of [merkletreePOINode, merkletreeWallet]) {
      await merkletree.clearLeavesFromDB();

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
      const railgunTransactionsWithTxids = railgunTransactions.map((railgunTransaction) =>
        createRailgunTransactionWithID(railgunTransaction, TXIDVersion.V2_PoseidonMerkle),
      );

      await merkletree.queueRailgunTransactions(railgunTransactionsWithTxids, 1);
      expect(await merkletree.getTreeLength(0)).to.equal(0);

      await merkletree.updateTreesFromWriteQueue();

      expect(await merkletree.getTreeLength(0)).to.equal(2);
      expect(await merkletree.getRoot(0)).to.equal(
        '283e5b75a4db7a6083eff5c01e9e8e4f12612bd56229e7e795acc492a8d7f99e',
      );

      if (merkletree.shouldStoreMerkleroots) {
        expect(await merkletree.getHistoricalMerkleroot(0, 0)).to.equal(
          '0748198251a6d8d8958ddb5f0d79ecdb1034f3073bb98378c262d130f7507bf3',
        );
        expect(await merkletree.getHistoricalMerkleroot(0, 1)).to.equal(
          '283e5b75a4db7a6083eff5c01e9e8e4f12612bd56229e7e795acc492a8d7f99e',
        );
      } else {
        expect(await merkletree.getHistoricalMerkleroot(0, 0)).to.equal(undefined);
        expect(await merkletree.getHistoricalMerkleroot(0, 1)).to.equal(undefined);
      }

      expect(await merkletree.getRailgunTxidsForCommitments(['0x11'])).to.deep.equal({
        '0x11': '024357abc258ce12110ea30877928463b0308ffe740e005558ef87f152cd0426',
      });
      expect(
        await merkletree.getTxidIndexByRailgunTxid(railgunTransactionsWithTxids[0].hash),
      ).to.equal(0);
      expect(
        await merkletree.getTxidIndexByRailgunTxid(railgunTransactionsWithTxids[1].hash),
      ).to.equal(1);

      // Ensure stored hash is correct
      const railgunTransaction = await merkletree.getRailgunTransaction(0, 0);
      const hash = getRailgunTransactionID(railgunTransactions[0]);
      expect(hash).to.equal(
        14287123277508529327750979990773096097618894834009087566098724348137357265894n,
      );
      expect(railgunTransaction).to.deep.equal({
        ...railgunTransactions[0],
        hash: nToHex(hash, ByteLength.UINT_256),
        txidVersion: TXIDVersion.V2_PoseidonMerkle,
      });

      expect(
        await merkletree.getRailgunTxidsForCommitments(['0x01', '0x0101', '0x0211', '0x1111111']),
      ).to.deep.equal({
        '0x0101': undefined,
        '0x0211': undefined,
        '0x01': '1f9639a75d9aa09f959fb0f347da9a3afcbb09851c5cb398100d1721b5ed4be6',
        '0x1111111': undefined,
      });

      expect(
        await merkletree.getRailgunTransactionByTxid(
          '1f9639a75d9aa09f959fb0f347da9a3afcbb09851c5cb398100d1721b5ed4be6',
        ),
      ).to.deep.equal({
        graphID: '0x00',
        commitments: ['0x01', '0x02'],
        nullifiers: ['0x03', '0x04'],
        boundParamsHash: '0x05',
        blockNumber: 0,
        hash: '1f9639a75d9aa09f959fb0f347da9a3afcbb09851c5cb398100d1721b5ed4be6',
      });

      // Make sure new constructed tree inherits db values
      const merkletree2 = await RailgunTxidMerkletree.createForPOINode(db, chain, undefined);
      const treeLength2 = await merkletree2.getTreeLength(0);
      expect(treeLength2).to.equal(2);

      const moreRailgunTransactions: RailgunTransaction[] = [
        {
          graphID: '0x02',
          commitments: ['0x0101', '0x0102'],
          nullifiers: ['0x0103', '0x0104'],
          boundParamsHash: '0x0105',
          blockNumber: 2,
        },
        {
          graphID: '0x13',
          commitments: ['0x0211', '0x0212'],
          nullifiers: ['0x0213', '0x0214'],
          boundParamsHash: '0x0215',
          blockNumber: 3, // Will be after POI Launch block
        },
      ];
      const moreRailgunTransactionsWithTxids = moreRailgunTransactions.map((railgunTransaction2) =>
        createRailgunTransactionWithID(railgunTransaction2, TXIDVersion.V2_PoseidonMerkle),
      );

      await merkletree.queueRailgunTransactions(moreRailgunTransactionsWithTxids, undefined);
      await merkletree.updateTreesFromWriteQueue();

      if (merkletree.shouldSavePOILaunchSnapshot) {
        // merkleproof with POI Launch snapshot
        const currentMerkletreeData = await merkletree.getRailgunTxidCurrentMerkletreeData(
          railgunTransactionsWithTxids[0].hash,
        );
        expect(currentMerkletreeData).to.deep.equal({
          railgunTransaction: {
            graphID: '0x00',
            commitments: ['0x01', '0x02'],
            nullifiers: ['0x03', '0x04'],
            boundParamsHash: '0x05',
            blockNumber: 0,
            hash: '1f9639a75d9aa09f959fb0f347da9a3afcbb09851c5cb398100d1721b5ed4be6',
          },
          currentTxidIndexForTree: 3,
          currentMerkleProofForTree: {
            elements: [
              '024357abc258ce12110ea30877928463b0308ffe740e005558ef87f152cd0426',
              '1c058e29d7c82743e1c45ed609838c456a485dd5396eda8932867510b4a8b821',
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
            indices: '0000000000000000000000000000000000000000000000000000000000000000',
            leaf: '1f9639a75d9aa09f959fb0f347da9a3afcbb09851c5cb398100d1721b5ed4be6',
            root: '1e06edcab28e43ef5cf7eaf9a798d1ef44073701585a4d2c709e74e7468a1810',
          },
        });

        expect(currentMerkletreeData.railgunTransaction.hash).to.equal(
          currentMerkletreeData.currentMerkleProofForTree.leaf,
        );
        expect(verifyMerkleProof(currentMerkletreeData.currentMerkleProofForTree)).to.equal(true);

        const { root } = currentMerkletreeData.currentMerkleProofForTree;
        const currentRoot = await merkletree.getRoot(0);
        expect(root).to.not.equal(currentRoot);
      } else {
        // merkleproof without POI Launch snapshot
        const currentMerkletreeData = await merkletree.getRailgunTxidCurrentMerkletreeData(
          railgunTransactionsWithTxids[0].hash,
        );

        expect(currentMerkletreeData).to.deep.equal({
          railgunTransaction: {
            graphID: '0x00',
            commitments: ['0x01', '0x02'],
            nullifiers: ['0x03', '0x04'],
            boundParamsHash: '0x05',
            blockNumber: 0,
            hash: '1f9639a75d9aa09f959fb0f347da9a3afcbb09851c5cb398100d1721b5ed4be6',
          },
          currentTxidIndexForTree: 3,
          currentMerkleProofForTree: {
            elements: [
              '024357abc258ce12110ea30877928463b0308ffe740e005558ef87f152cd0426',
              '2acf0a0ecba043251913a90ea5f3d661d928d9290c077ad24c19ccb671772f0d',
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
            indices: '0000000000000000000000000000000000000000000000000000000000000000',
            leaf: '1f9639a75d9aa09f959fb0f347da9a3afcbb09851c5cb398100d1721b5ed4be6',
            root: '0cab5647420c4befab5bca435c46872a60987cfd18b4066ce37ebb1ef518e007',
          },
        });

        expect(currentMerkletreeData.railgunTransaction.hash).to.equal(
          currentMerkletreeData.currentMerkleProofForTree.leaf,
        );
        expect(verifyMerkleProof(currentMerkletreeData.currentMerkleProofForTree)).to.equal(true);

        const { root } = currentMerkletreeData.currentMerkleProofForTree;
        const currentRoot = await merkletree.getRoot(0);
        expect(root).to.equal(currentRoot);
      }

      if (merkletree.shouldSavePOILaunchSnapshot) {
        const poiLaunchNode = await merkletree.getPOILaunchSnapshotNode(0);
        expect(poiLaunchNode).to.deep.equal({
          index: 2,
          hash: await merkletree.getNodeHash(0, 0, 2),
        });
      } else {
        const poiLaunchNode = await merkletree.getPOILaunchSnapshotNode(0);
        expect(poiLaunchNode).to.equal(undefined);
      }

      // Current root (4 elements)
      expect(await merkletree.getRoot(0)).to.equal(
        '0cab5647420c4befab5bca435c46872a60987cfd18b4066ce37ebb1ef518e007',
      );

      // Rebuild entire tree and check that merkleroot is the same
      await merkletree.rebuildAndWriteTree(0);
      expect(await merkletree.getRoot(0)).to.equal(
        '0cab5647420c4befab5bca435c46872a60987cfd18b4066ce37ebb1ef518e007',
      );

      await merkletree.clearLeavesAfterTxidIndex(0);

      // Current tree root (1 element)
      expect(await merkletree.getRoot(0)).to.equal(
        '0748198251a6d8d8958ddb5f0d79ecdb1034f3073bb98378c262d130f7507bf3',
      );

      if (merkletree.shouldStoreMerkleroots) {
        // DB historical roots
        expect(await merkletree.getHistoricalMerklerootForTxidIndex(0)).to.equal(
          '0748198251a6d8d8958ddb5f0d79ecdb1034f3073bb98378c262d130f7507bf3',
        );
        expect(await merkletree.getHistoricalMerklerootForTxidIndex(1)).to.equal(undefined);
        expect(await merkletree.getHistoricalMerklerootForTxidIndex(2)).to.equal(undefined);
      } else {
        expect(await merkletree.getHistoricalMerklerootForTxidIndex(0)).to.equal(undefined);
      }
    }
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
