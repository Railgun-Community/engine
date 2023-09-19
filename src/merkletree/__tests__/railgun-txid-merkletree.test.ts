import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import memdown from 'memdown';
import { Chain, ChainType } from '../../models/engine-types';
import { Database } from '../../database/database';
import { RailgunTXIDMerkletree } from '../railgun-txid-merkletree';
import { RailgunTransaction } from '../../models';
import { getRailgunTransactionID } from '../../transaction/railgun-txid';

chai.use(chaiAsPromised);
const { expect } = chai;

// Database object
let db: Database;
let merkletree: RailgunTXIDMerkletree;

const chain: Chain = {
  type: 0,
  id: 0,
};

describe('Railgun TXID Merkletree', () => {
  beforeEach(async () => {
    // Create database
    db = new Database(memdown());
    merkletree = await RailgunTXIDMerkletree.createForPOINode(db, chain);
  });

  it('Should get TXID merkletree DB paths', async () => {
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
        const merkletreeVectorTest = await RailgunTXIDMerkletree.createForPOINode(db, vector.chain);

        expect(merkletreeVectorTest.getTreeDBPrefix(vector.treeNumber)).to.deep.equal(
          vector.result.slice(0, 3),
        );

        expect(
          merkletreeVectorTest.getNodeHashDBPath(vector.treeNumber, vector.level, vector.index),
        ).to.deep.equal(vector.result);
      }),
    );
  });

  it('Should update TXID merkle tree correctly', async () => {
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

    await merkletree.queueRailgunTransactions(railgunTransactions, 1);
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

    // Make sure new constructed tree inherits db values
    const merkletree2 = await RailgunTXIDMerkletree.createForPOINode(db, chain);
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

    await merkletree.queueRailgunTransactions(moreRailgunTransactions, undefined);
    await merkletree.updateTreesFromWriteQueue();

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
    expect(RailgunTXIDMerkletree.nextTreeAndIndex(0, 0)).to.deep.equal({ tree: 0, index: 1 });
    expect(RailgunTXIDMerkletree.nextTreeAndIndex(1, 65535)).to.deep.equal({ tree: 2, index: 0 });
  });

  it('Should get tree and index from txidIndex', async () => {
    expect(RailgunTXIDMerkletree.getTreeAndIndexFromTxidIndex(9)).to.deep.equal({
      tree: 0,
      index: 9,
    });
    expect(RailgunTXIDMerkletree.getTreeAndIndexFromTxidIndex(65535)).to.deep.equal({
      tree: 0,
      index: 65535,
    });
    expect(RailgunTXIDMerkletree.getTreeAndIndexFromTxidIndex(65536)).to.deep.equal({
      tree: 1,
      index: 0,
    });
  });
});
