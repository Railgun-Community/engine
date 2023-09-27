import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { Merkletree } from '../merkletree';

chai.use(chaiAsPromised);
const { expect } = chai;

describe('Merkletree', () => {
  it('Should get number of nodes per level', () => {
    expect(Merkletree.numNodesPerLevel(0)).to.equal(65536);
    expect(Merkletree.numNodesPerLevel(1)).to.equal(32768);
    expect(Merkletree.numNodesPerLevel(10)).to.equal(64);
    expect(Merkletree.numNodesPerLevel(15)).to.equal(2);
    expect(Merkletree.numNodesPerLevel(16)).to.equal(1);
  });
});
