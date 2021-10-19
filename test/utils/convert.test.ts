/* globals describe it */
import BN from 'bn.js';
import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';

import utils from '../../src/utils';

chai.use(chaiAsPromised);
const { expect } = chai;

const vectors = [
  {
    hex: '',
    array: [],
    number: new BN('0', 10),
  },
  {
    hex: '0138bc',
    array: [1, 56, 188],
    number: new BN('80060', 10),
  },
  {
    hex: '5241494c47554e',
    array: [82, 65, 73, 76, 71, 85, 78],
    number: new BN('23152731158435150', 10),
  },
  {
    hex: '50524956414359202620414e4f4e594d495459',
    array: [
      80, 82, 73, 86, 65, 67, 89,
      32, 38, 32, 65, 78, 79, 78,
      89, 77, 73, 84, 89,
    ],
    number: new BN('1791227778594112336062762560780788585783186521', 10),
  },
];

describe('Utils/Convert', () => {
  it('Should hexlify', () => {
    vectors.forEach((vector) => {
      // Test prefixed hex string to hex string
      expect(
        utils.convert.hexlify(`0x${vector.hex}`),
      ).to.equal(vector.hex);

      // Test hex string to hex string
      expect(
        utils.convert.hexlify(vector.hex),
      ).to.equal(vector.hex);

      // Test bytes array to hex string
      expect(
        utils.convert.hexlify(vector.array),
      ).to.equal(vector.hex);

      // Test number to hex string
      expect(
        utils.convert.hexlify(vector.number),
      ).to.equal(vector.hex);
    });
  });

  it('Should arrayify', () => {
    vectors.forEach((vector) => {
      // Test hex string to byte array
      expect(
        utils.convert.arrayify(vector.hex),
      ).to.deep.equal(vector.array);

      // Test byte array to byte array
      expect(
        utils.convert.arrayify(vector.array),
      ).to.deep.equal(vector.array);

      // Test number to byte array
      expect(
        utils.convert.arrayify(vector.number),
      ).to.deep.equal(vector.array);
    });
  });

  it('Should numberify', () => {
    vectors.forEach((vector) => {
      // Test hex string to number
      expect(
        utils.convert.numberify(vector.hex).eq(vector.number),
      ).to.equal(true);

      // Test byte array to number
      expect(
        utils.convert.numberify(vector.array).eq(vector.number),
      ).to.equal(true);

      // Test number to number
      expect(
        utils.convert.numberify(vector.number).eq(vector.number),
      ).to.equal(true);
    });
  });
});
