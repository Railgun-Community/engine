/* globals describe it */
import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';

import utils from '../../src/utils';

chai.use(chaiAsPromised);
const { expect } = chai;

describe('Utils/Convert', () => {
  it('Should convert hex to byte array and back', () => {
    const vectors = [
      {
        hex: '',
        array: [],
      },
      {
        hex: '5241494c47554e',
        array: [82, 65, 73, 76, 71, 85, 78],
      },
      {
        hex: '50524956414359202620414e4f4e594d495459',
        array: [
          80, 82, 73, 86, 65, 67, 89,
          32, 38, 32, 65, 78, 79, 78,
          89, 77, 73, 84, 89,
        ],
      },
    ];

    vectors.forEach((vector) => {
      // Test byte array to byte array
      expect(
        utils.convert.arrayify(vector.array),
      ).to.deep.equal(vector.array);

      // Test hex string to byte array
      expect(
        utils.convert.arrayify(vector.hex),
      ).to.deep.equal(vector.array);

      // Test bytes array to hex string
      expect(
        utils.convert.hexlify(vector.array),
      ).to.equal(vector.hex);

      // Test hex string to hex string
      expect(
        utils.convert.hexlify(vector.hex),
      ).to.equal(vector.hex);

      // Test prefixed hex string to hex string
      expect(
        utils.convert.hexlify(`0x${vector.hex}`),
      ).to.equal(vector.hex);
    });
  });
});
