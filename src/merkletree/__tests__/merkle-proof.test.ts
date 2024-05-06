import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { createDummyMerkleProof, verifyMerkleProof } from '../merkle-proof';
import { ByteUtils } from '../../utils';

chai.use(chaiAsPromised);
const { expect } = chai;

describe('merkle-proof', () => {
  beforeEach(async () => {});

  it('Should create valid dummy merkle proof', () => {
    const merkleProof = createDummyMerkleProof(ByteUtils.randomHex(31));
    expect(merkleProof.elements.length).to.equal(16);
    expect(verifyMerkleProof(merkleProof)).to.equal(true);
  });
});
