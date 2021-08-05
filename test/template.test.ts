/* globals describe it */
import * as chai from 'chai';
import * as chaiAsPromised from 'chai-as-promised';

chai.use(chaiAsPromised);
const { expect } = chai;

describe('Test Template', () => {
  it('math should work correctly', () => {
    expect(3 + 4).to.equal(7);
  });
});
