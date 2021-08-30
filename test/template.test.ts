/* globals describe it */
import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';

chai.use(chaiAsPromised);
const { expect } = chai;

describe('Test Template', () => {
  it('Math should work correctly', () => {
    expect(3 + 4).to.equal(7);
  });
});
