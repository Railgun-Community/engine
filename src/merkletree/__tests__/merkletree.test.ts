import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { Merkletree } from '../merkletree';
import { randomHex } from '../../utils';

chai.use(chaiAsPromised);
const { expect } = chai;

describe('Merkletree', () => {
  beforeEach(async () => {});

  it('Should create valid dummy merkle proof', () => {
    const merkleProof = Merkletree.createDummyMerkleProof(randomHex(31));
    expect(Merkletree.verifyMerkleProof(merkleProof)).to.equal(true);
  });
});
