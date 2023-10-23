/* eslint-disable no-await-in-loop */
import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import memdown from 'memdown';
import { poseidon } from 'circomlibjs';
import { Chain, ChainType } from '../../models/engine-types';
import { Database } from '../../database/database';
import { TXIDMerkletree } from '../txid-merkletree';
import { RailgunTransaction, TXIDVersion } from '../../models';
import {
  calculateRailgunTransactionVerificationHash,
  createRailgunTransactionWithHash,
  getRailgunTransactionID,
} from '../../transaction/railgun-txid';
import { ByteLength, nToHex } from '../../utils/bytes';
import { verifyMerkleProof } from '../merkle-proof';
import { getTokenDataERC20 } from '../../note/note-util';
import { config } from '../../test/config.test';
import { TREE_DEPTH } from '../../models/merkletree-types';
import { POI } from '../../poi/poi';

chai.use(chaiAsPromised);
const { expect } = chai;

// Database object
let db: Database;
let merkletreePOINode: TXIDMerkletree;
let merkletreeWallet: TXIDMerkletree;

const chain: Chain = {
  type: 0,
  id: 0,
};

const poiLaunchBlock = 3;

describe('txid-merkletree', () => {
  beforeEach(async () => {
    // Create database
    db = new Database(memdown());

    POI.setLaunchBlock(chain, poiLaunchBlock);

    merkletreePOINode = await TXIDMerkletree.createForPOINode(
      db,
      chain,
      TXIDVersion.V2_PoseidonMerkle,
      poiLaunchBlock,
    );
    expect(merkletreePOINode.shouldStoreMerkleroots).to.equal(true);

    merkletreeWallet = await TXIDMerkletree.createForWallet(
      db,
      chain,
      TXIDVersion.V2_PoseidonMerkle,
      poiLaunchBlock,
      async () => true,
    );
    expect(merkletreeWallet.shouldStoreMerkleroots).to.equal(false);
  });

  it('Should get Txid merkletree DB paths', async () => {
    type Vector = {
      chain: Chain;
      poiLaunchBlock: number;
      treeNumber: number;
      level: number;
      index: number;
      result: string[];
    };

    POI.setLaunchBlock({ type: ChainType.EVM, id: 0 }, 10);
    POI.setLaunchBlock({ type: ChainType.EVM, id: 4 }, 11);

    const vectors: Vector[] = [
      {
        chain: { type: ChainType.EVM, id: 0 },
        poiLaunchBlock: 10,
        treeNumber: 0,
        level: 1,
        index: 5,
        result: [
          '0000000000000000007261696c67756e2d7472616e73616374696f6e2d696473',
          '0000000000000000000000000000000000000000000000000000000000000000',
          '0000000000000000000000000000000000000000000000000000000000005632',
          '0000000000000000000000000000000000000000000000000000000000000000',
          '0000000000000000000000000000000000000000000000000000000000000001',
          '0000000000000000000000000000000000000000000000000000000000000005',
        ],
      },
      {
        chain: { type: ChainType.EVM, id: 4 },
        poiLaunchBlock: 11,
        treeNumber: 2,
        level: 7,
        index: 10,
        result: [
          '0000000000000000007261696c67756e2d7472616e73616374696f6e2d696473',
          '0000000000000000000000000000000000000000000000000000000000000004',
          '0000000000000000000000000000000000000000000000000000000000005632',
          '0000000000000000000000000000000000000000000000000000000000000002',
          '0000000000000000000000000000000000000000000000000000000000000007',
          '000000000000000000000000000000000000000000000000000000000000000a',
        ],
      },
    ];

    await Promise.all(
      vectors.map(async (vector) => {
        const merkletreeVectorTest = await TXIDMerkletree.createForPOINode(
          db,
          vector.chain,
          TXIDVersion.V2_PoseidonMerkle,
          vector.poiLaunchBlock,
        );

        expect(merkletreeVectorTest.getTreeDBPrefix(vector.treeNumber)).to.deep.equal(
          vector.result.slice(0, 4),
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
      await merkletree.clearDataForMerkletree();

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
          unshield: {
            tokenData: getTokenDataERC20(config.contracts.rail),
            toAddress: '0x1234',
            value: '0x01',
          },
          timestamp: 1_000_000,
          txid: '00',
          utxoTreeIn: 0,
          utxoTreeOut: 0,
          utxoBatchStartPositionOut: 0,
          verificationHash: 'test',
        },
        {
          graphID: '0x10',
          commitments: ['0x11', '0x12'],
          nullifiers: ['0x13', '0x14'],
          boundParamsHash: '0x15',
          unshield: undefined,
          timestamp: 1_000_000,
          txid: '00',
          blockNumber: 0,
          utxoTreeIn: 0,
          utxoTreeOut: 0,
          utxoBatchStartPositionOut: 2,
          verificationHash: 'test',
        },
      ];
      const railgunTransactionsWithTxids = railgunTransactions.map((railgunTransaction) =>
        createRailgunTransactionWithHash(railgunTransaction, TXIDVersion.V2_PoseidonMerkle),
      );

      await merkletree.queueRailgunTransactions(railgunTransactionsWithTxids, 1);
      expect(await merkletree.getTreeLength(0)).to.equal(0);

      await merkletree.updateTreesFromWriteQueue();

      expect(await merkletree.getTreeLength(0)).to.equal(2);
      expect(await merkletree.getRoot(0)).to.equal(
        '0a03b0bf8dc758a3d5dd7f6b8b1974a4b212a0080425740c92cbd0c860ebde33',
      );

      expect(
        await merkletree.getGlobalUTXOTreePositionForRailgunTransactionCommitment(0, 1, '0x12'),
      ).to.equal(3);

      if (merkletree.shouldStoreMerkleroots) {
        expect(await merkletree.getHistoricalMerkleroot(0, 0)).to.equal(
          '2672380de5dc3f4078e8d5a5984fcd95e3e279be354665ba889a472b8cd27966',
        );
        expect(await merkletree.getHistoricalMerkleroot(0, 1)).to.equal(
          '0a03b0bf8dc758a3d5dd7f6b8b1974a4b212a0080425740c92cbd0c860ebde33',
        );
      } else {
        expect(await merkletree.getHistoricalMerkleroot(0, 0)).to.equal(undefined);
        expect(await merkletree.getHistoricalMerkleroot(0, 1)).to.equal(undefined);
      }

      expect(await merkletree.getTreeLength(0)).to.equal(2);
      expect(
        await merkletree.getTxidIndexByRailgunTxid(railgunTransactionsWithTxids[0].railgunTxid),
      ).to.deep.equal(0);
      expect(
        await merkletree.getTxidIndexByRailgunTxid(railgunTransactionsWithTxids[1].railgunTxid),
      ).to.deep.equal(1);

      // Ensure stored hash is correct
      const railgunTransaction = await merkletree.getRailgunTransaction(0, 0);
      const railgunTxid = getRailgunTransactionID(railgunTransactions[0]);
      expect(railgunTxid).to.equal(
        14287123277508529327750979990773096097618894834009087566098724348137357265894n,
      );
      const hash = poseidon([railgunTxid, 0n, 0n]);
      expect(railgunTransaction).to.deep.equal({
        graphID: railgunTransactions[0].graphID,
        nullifiers: railgunTransactions[0].nullifiers,
        commitments: railgunTransactions[0].commitments,
        boundParamsHash: railgunTransactions[0].boundParamsHash,
        blockNumber: railgunTransactions[0].blockNumber,
        hash: nToHex(hash, ByteLength.UINT_256),
        unshield: {
          tokenData: getTokenDataERC20(
            '0000000000000000000000009fe46736679d2d9a65f0992f2272de9f3c7fa6e0',
          ),
          toAddress: '0x1234',
          value: '0x01',
        },
        timestamp: 1_000_000,
        txid: '00',
        railgunTxid: '1f9639a75d9aa09f959fb0f347da9a3afcbb09851c5cb398100d1721b5ed4be6',
        utxoTreeIn: 0,
        utxoTreeOut: 0,
        utxoBatchStartPositionOut: 0,
        verificationHash: 'test',
      });

      expect(
        await merkletree.getRailgunTransactionByTxid(railgunTransactionsWithTxids[0].railgunTxid),
      ).to.deep.equal({
        graphID: '0x00',
        commitments: ['0x01', '0x02'],
        nullifiers: ['0x03', '0x04'],
        boundParamsHash: '0x05',
        blockNumber: 0,
        hash: '1d20db6208e429e0bdfa9ceef6cdb33493a3a9134b4ec6d620d6d2e7c2de37f9',
        unshield: {
          tokenData: getTokenDataERC20(
            '0000000000000000000000009fe46736679d2d9a65f0992f2272de9f3c7fa6e0',
          ),
          toAddress: '0x1234',
          value: '0x01',
        },
        timestamp: 1_000_000,
        txid: '00',
        railgunTxid: railgunTransactionsWithTxids[0].railgunTxid,
        utxoTreeIn: 0,
        utxoTreeOut: 0,
        utxoBatchStartPositionOut: 0,
        verificationHash: 'test',
      });

      // Make sure new constructed tree inherits db values
      const merkletree2 = await TXIDMerkletree.createForPOINode(
        db,
        chain,
        TXIDVersion.V2_PoseidonMerkle,
        poiLaunchBlock,
      );
      const treeLength2 = await merkletree2.getTreeLength(0);
      expect(treeLength2).to.equal(2);

      const moreRailgunTransactions: RailgunTransaction[] = [
        {
          graphID: '0x02',
          commitments: ['0x0101', '0x0102'],
          nullifiers: ['0x0103', '0x0104'],
          boundParamsHash: '0x0105',
          unshield: {
            tokenData: getTokenDataERC20(config.contracts.rail),
            toAddress: '0x1234',
            value: '0x01',
          },
          timestamp: 1_000_000,
          txid: '00',
          blockNumber: 2,
          utxoTreeIn: 0,
          utxoTreeOut: 0,
          utxoBatchStartPositionOut: 4,
          verificationHash: 'test',
        },
        {
          graphID: '0x13',
          commitments: ['0x0211', '0x0212'],
          nullifiers: ['0x0213', '0x0214'],
          boundParamsHash: '0x0215',
          unshield: {
            tokenData: getTokenDataERC20(config.contracts.rail),
            toAddress: '0x1234',
            value: '0x01',
          },
          timestamp: 1_000_000,
          txid: '00',
          blockNumber: 3, // Will be after POI Launch block
          utxoTreeIn: 0,
          utxoTreeOut: 0,
          utxoBatchStartPositionOut: 6,
          verificationHash: 'test',
        },
      ];
      const moreRailgunTransactionsWithTxids = moreRailgunTransactions.map((railgunTransaction2) =>
        createRailgunTransactionWithHash(railgunTransaction2, TXIDVersion.V2_PoseidonMerkle),
      );

      await merkletree.queueRailgunTransactions(moreRailgunTransactionsWithTxids, undefined);
      await merkletree.updateTreesFromWriteQueue();

      if (merkletree.shouldSavePOILaunchSnapshot) {
        expect(await merkletree.getPOILaunchSnapshotNode(0)).to.deep.equal({
          index: 2,
          hash: '146d04257251ebab1d921f66145175d5a8c0b8c0f9298aac8e13f2477a7bc0d5',
        });
        expect(merkletree.savedPOILaunchSnapshot).to.equal(true);
      } else {
        expect(await merkletree.getPOILaunchSnapshotNode(0)).to.equal(undefined);
        expect(merkletree.savedPOILaunchSnapshot).to.equal(undefined);
      }

      expect(await merkletree.railgunTxidOccurredBeforeBlockNumber(0, 0, 3)).to.equal(true);
      expect(await merkletree.railgunTxidOccurredBeforeBlockNumber(0, 3, 3)).to.equal(false);

      if (merkletree.shouldSavePOILaunchSnapshot) {
        // merkleproof with POI Launch snapshot
        const currentMerkletreeData = await merkletree.getRailgunTxidCurrentMerkletreeData(
          railgunTransactionsWithTxids[0].railgunTxid,
        );
        expect(currentMerkletreeData).to.deep.equal({
          railgunTransaction: {
            graphID: '0x00',
            commitments: ['0x01', '0x02'],
            nullifiers: ['0x03', '0x04'],
            boundParamsHash: '0x05',
            blockNumber: 0,
            hash: '1d20db6208e429e0bdfa9ceef6cdb33493a3a9134b4ec6d620d6d2e7c2de37f9',
            unshield: {
              tokenData: getTokenDataERC20(
                '0000000000000000000000009fe46736679d2d9a65f0992f2272de9f3c7fa6e0',
              ),
              toAddress: '0x1234',
              value: '0x01',
            },
            timestamp: 1_000_000,
            txid: '00',
            railgunTxid: '1f9639a75d9aa09f959fb0f347da9a3afcbb09851c5cb398100d1721b5ed4be6',
            utxoTreeIn: 0,
            utxoTreeOut: 0,
            utxoBatchStartPositionOut: 0,
            verificationHash: 'test',
          },
          currentTxidIndexForTree: 2,
          currentMerkleProofForTree: {
            elements: [
              '12d0d49bb0803a2dea71223db3c45487909ef49600de461f9d8cc3a0daec012c',
              '269093692b0655851303944dc9d416c78734119eb584b240f7176c98f929fd9e',
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
            leaf: '1d20db6208e429e0bdfa9ceef6cdb33493a3a9134b4ec6d620d6d2e7c2de37f9',
            root: '2f4f37ea40b00388e1415d7b4f762ef388024ea74cfc61845a2d44b2c82dd7db',
          },
        });

        expect(currentMerkletreeData.railgunTransaction.hash).to.equal(
          currentMerkletreeData.currentMerkleProofForTree.leaf,
        );
        expect(verifyMerkleProof(currentMerkletreeData.currentMerkleProofForTree)).to.equal(true);

        const { root } = currentMerkletreeData.currentMerkleProofForTree;
        const currentRoot = await merkletree.getRoot(0);
        expect(root).to.not.equal(currentRoot);
        expect(root).to.equal((await merkletree.getPOILaunchSnapshotNode(TREE_DEPTH))?.hash);
      } else {
        // merkleproof without POI Launch snapshot
        const currentMerkletreeData = await merkletree.getRailgunTxidCurrentMerkletreeData(
          railgunTransactionsWithTxids[0].railgunTxid,
        );

        expect(currentMerkletreeData).to.deep.equal({
          railgunTransaction: {
            graphID: '0x00',
            commitments: ['0x01', '0x02'],
            nullifiers: ['0x03', '0x04'],
            boundParamsHash: '0x05',
            blockNumber: 0,
            hash: '1d20db6208e429e0bdfa9ceef6cdb33493a3a9134b4ec6d620d6d2e7c2de37f9',
            unshield: {
              tokenData: getTokenDataERC20(
                '0000000000000000000000009fe46736679d2d9a65f0992f2272de9f3c7fa6e0',
              ),
              toAddress: '0x1234',
              value: '0x01',
            },
            timestamp: 1_000_000,
            txid: '00',
            railgunTxid: '1f9639a75d9aa09f959fb0f347da9a3afcbb09851c5cb398100d1721b5ed4be6',
            utxoTreeIn: 0,
            utxoTreeOut: 0,
            utxoBatchStartPositionOut: 0,
            verificationHash: 'test',
          },
          currentTxidIndexForTree: 3,
          currentMerkleProofForTree: {
            elements: [
              '12d0d49bb0803a2dea71223db3c45487909ef49600de461f9d8cc3a0daec012c',
              '2097c0eb4015e8fea6dc5062a2e4979cd44852350b4f935387ea027737df91a4', // different
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
            leaf: '1d20db6208e429e0bdfa9ceef6cdb33493a3a9134b4ec6d620d6d2e7c2de37f9',
            root: '0a69c8788735b4a86b8bbe292ad5db83e8830fc27c9ed9dc216dd606cef347fe', // different
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
        '0a69c8788735b4a86b8bbe292ad5db83e8830fc27c9ed9dc216dd606cef347fe',
      );

      // Rebuild entire tree and check that merkleroot is the same
      await merkletree.rebuildAndWriteTree(0);
      expect(await merkletree.getRoot(0)).to.equal(
        '0a69c8788735b4a86b8bbe292ad5db83e8830fc27c9ed9dc216dd606cef347fe',
      );

      await merkletree.clearLeavesAfterTxidIndex(0);

      // expect(await merkletree.getRailgunTransaction(0, 1)).to.equal(undefined);
      expect(await merkletree.getNodeHash(0, 0, 1)).to.equal(merkletree.zeros[0]);

      // Current tree root (1 element)
      expect(await merkletree.getRoot(0)).to.equal(
        '2672380de5dc3f4078e8d5a5984fcd95e3e279be354665ba889a472b8cd27966',
      );

      if (merkletree.shouldStoreMerkleroots) {
        // DB historical roots
        expect(await merkletree.getHistoricalMerklerootForTxidIndex(0)).to.equal(
          '2672380de5dc3f4078e8d5a5984fcd95e3e279be354665ba889a472b8cd27966',
        );
        expect(await merkletree.getHistoricalMerklerootForTxidIndex(1)).to.equal(undefined);
        expect(await merkletree.getHistoricalMerklerootForTxidIndex(2)).to.equal(undefined);
      } else {
        expect(await merkletree.getHistoricalMerklerootForTxidIndex(0)).to.equal(undefined);
      }
    }
  }).timeout(20000);

  it('Should get next tree and index', async () => {
    expect(TXIDMerkletree.nextTreeAndIndex(0, 0)).to.deep.equal({ tree: 0, index: 1 });
    expect(TXIDMerkletree.nextTreeAndIndex(1, 65535)).to.deep.equal({ tree: 2, index: 0 });
  });
});
