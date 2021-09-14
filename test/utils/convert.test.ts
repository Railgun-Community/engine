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

  it('Should pad to length', () => {
    const padVectors = [
      {
        original: '',
        left16: '00000000000000000000000000000000',
        left32: '0000000000000000000000000000000000000000000000000000000000000000',
        right16: '00000000000000000000000000000000',
        right32: '0000000000000000000000000000000000000000000000000000000000000000',
      },
      {
        original: [],
        left16: [
          0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        ],
        left32: [
          0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
          0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        ],
        right16: [
          0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        ],
        right32: [
          0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
          0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        ],
      },
      {
        original: '4bd21a92a4c6e9f10164fe40',
        left16: '000000004bd21a92a4c6e9f10164fe40',
        left32: '00000000000000000000000000000000000000004bd21a92a4c6e9f10164fe40',
        right16: '4bd21a92a4c6e9f10164fe4000000000',
        right32: '4bd21a92a4c6e9f10164fe400000000000000000000000000000000000000000',
      },
      {
        original: [32, 12, 18, 245],
        left16: [
          0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 32, 12, 18, 245,
        ],
        left32: [
          0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
          0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 32, 12, 18, 245,
        ],
        right16: [
          32, 12, 18, 245, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        ],
        right32: [
          32, 12, 18, 245, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
          0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        ],
      },
      {
        original: 'f6fc84c9f21c24907d6bee6eec38caba',
        left16: 'f6fc84c9f21c24907d6bee6eec38caba',
        left32: '00000000000000000000000000000000f6fc84c9f21c24907d6bee6eec38caba',
        right16: 'f6fc84c9f21c24907d6bee6eec38caba',
        right32: 'f6fc84c9f21c24907d6bee6eec38caba00000000000000000000000000000000',
      },
    ];

    padVectors.forEach((vector) => {
      expect(
        utils.convert.padToLength(vector.original, 16),
      ).to.deep.equal(vector.left16);

      expect(
        utils.convert.padToLength(vector.original, 32),
      ).to.deep.equal(vector.left32);

      expect(
        utils.convert.padToLength(vector.original, 16, 'right'),
      ).to.deep.equal(vector.right16);

      expect(
        utils.convert.padToLength(vector.original, 32, 'right'),
      ).to.deep.equal(vector.right32);
    });

    expect(
      () => utils.convert.padToLength('000000', 2),
    ).to.throw();

    expect(
      () => utils.convert.padToLength([0, 0, 0], 2),
    ).to.throw();
  });
});
