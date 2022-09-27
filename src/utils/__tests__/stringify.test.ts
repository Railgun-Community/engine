/* globals describe it */
import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { stringifySafe } from '../../utils/stringify';

chai.use(chaiAsPromised);
const { expect } = chai;

describe('stringify', () => {
  it('Should stringify bigint safely', async () => {
    const data: object = {
      text: '468abc',
      value: 2839094n,
    };

    expect(stringifySafe(data)).to.equal('{"text":"468abc","value":"2839094"}');
  });
});
