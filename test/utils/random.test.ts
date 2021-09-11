/* globals describe it */
import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';

import utils from '../../src/utils';

chai.use(chaiAsPromised);
const { expect } = chai;

describe('Utils/Random', () => {
  it('Should return random values', () => {
    // Check length of random values is what we expect
    expect(utils.random().length).to.equal(64);
    expect(utils.random(1).length).to.equal(2);
    expect(utils.random(128).length).to.equal(256);
  });
});
