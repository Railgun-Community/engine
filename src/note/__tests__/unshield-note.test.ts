import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { UnshieldNote } from '../unshield-note';

chai.use(chaiAsPromised);
const { expect } = chai;

describe('unshield-note', () => {
  it('Should get fee and amount from value and bips', () => {
    expect(UnshieldNote.getAmountFeeFromValue(10000n, 25n)).to.deep.equal({
      fee: 25n,
      amount: 9975n,
    });
    expect(UnshieldNote.getAmountFeeFromValue(100n, 25n)).to.deep.equal({ fee: 0n, amount: 100n });
  });
});
