import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { averageNumber } from '../average';

chai.use(chaiAsPromised);
const { expect } = chai;

describe('average', () => {
  it('Should find average of set of numbers', () => {
    expect(averageNumber([1, 2, 3])).to.equal(2);
    expect(averageNumber([1, 2])).to.equal(1.5);
    expect(averageNumber([1])).to.equal(1);
  });
});
