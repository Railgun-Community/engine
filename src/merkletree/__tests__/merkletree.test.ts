import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { Merkletree } from '../merkletree';

chai.use(chaiAsPromised);
const { expect } = chai;

describe('merkletree', () => {
  it('Should get number of nodes per level', () => {
    expect(Merkletree.numNodesPerLevel(0)).to.equal(65536);
    expect(Merkletree.numNodesPerLevel(1)).to.equal(32768);
    expect(Merkletree.numNodesPerLevel(10)).to.equal(64);
    expect(Merkletree.numNodesPerLevel(15)).to.equal(2);
    expect(Merkletree.numNodesPerLevel(16)).to.equal(1);
  });

  it('Should get tree and index from txidIndex', async () => {
    expect(Merkletree.getTreeAndIndexFromGlobalPosition(9)).to.deep.equal({
      tree: 0,
      index: 9,
    });
    expect(Merkletree.getTreeAndIndexFromGlobalPosition(65535)).to.deep.equal({
      tree: 0,
      index: 65535,
    });
    expect(Merkletree.getTreeAndIndexFromGlobalPosition(65536)).to.deep.equal({
      tree: 1,
      index: 0,
    });
  });
});
