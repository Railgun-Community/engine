import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { createDummyMerkleProof, verifyMerkleProof } from '../merkle-proof';
import { randomHex } from '../../utils';

chai.use(chaiAsPromised);
const { expect } = chai;

describe('MerkleProof', () => {
  beforeEach(async () => {});

  it('Should create valid dummy merkle proof', () => {
    const merkleProof = createDummyMerkleProof(randomHex(31));
    expect(verifyMerkleProof(merkleProof)).to.equal(true);
  });
});
