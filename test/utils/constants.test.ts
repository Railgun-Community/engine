/* globals describe it */
import BN from 'bn.js';
import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';

import utils from '../../src/utils';

chai.use(chaiAsPromised);
const { expect } = chai;

describe('Utils/Constants', () => {
  it('Should return correct tree zero value', () => {
    const merkleZeroValueNumber = utils.bytes.numberify(utils.constants.MERKLE_ZERO_VALUE);
    const expected = new BN('2051258411002736885948763699317990061539314419500486054347250703186609807356', 10);

    expect(merkleZeroValueNumber.eq(expected)).to.equal(true);
  });
});
