/* globals describe it */
import BN from 'bn.js';
import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';

import utils from '../../src/utils';

chai.use(chaiAsPromised);
const { expect } = chai;

const convertVectors = [
  {
    hex: '',
    array: [],
    number: new BN('0', 10),
    numberLe: new BN('0', 10, 'le'),
  },
  {
    hex: '0138bc',
    array: [1, 56, 188],
    number: new BN('80060', 10),
    numberLe: new BN('80060', 10, 'le'),
  },
  {
    hex: '5241494c47554e',
    array: [82, 65, 73, 76, 71, 85, 78],
    number: new BN('23152731158435150', 10),
    numberLe: new BN('23152731158435150', 10, 'le'),
  },
  {
    hex: '50524956414359202620414e4f4e594d495459',
    array: [
      80, 82, 73, 86, 65, 67, 89,
      32, 38, 32, 65, 78, 79, 78,
      89, 77, 73, 84, 89,
    ],
    number: new BN('1791227778594112336062762560780788585783186521', 10),
    numberLe: new BN('1791227778594112336062762560780788585783186521', 10, 'le'),
  },
];

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
  {
    original: new BN('f6fc84c9f21c24907d6bee6eec38caba', 'hex'),
    left16: 'f6fc84c9f21c24907d6bee6eec38caba',
    left32: '00000000000000000000000000000000f6fc84c9f21c24907d6bee6eec38caba',
    right16: 'f6fc84c9f21c24907d6bee6eec38caba',
    right32: 'f6fc84c9f21c24907d6bee6eec38caba00000000000000000000000000000000',
  },
];

const stringVectors = [
  {
    hex: '',
    utf8: '',
  },
  {
    hex: '5261696c67756e',
    utf8: 'Railgun',
  },
  {
    hex: '50cdb6f09080805261696c67756e',
    utf8: 'PͶ𐀀Railgun',
  },
];

describe('Utils/Bytes', () => {
  it('Should return random values', () => {
    // Check length of random values is what we expect
    expect(utils.bytes.random().length).to.equal(64);
    expect(utils.bytes.random(1).length).to.equal(2);
    expect(utils.bytes.random(128).length).to.equal(256);
  });

  it('Should hexlify', () => {
    convertVectors.forEach((vector) => {
      // Test prefixed hex string to hex string
      expect(
        utils.bytes.hexlify(`0x${vector.hex}`),
      ).to.equal(vector.hex);

      // Test hex string to hex string
      expect(
        utils.bytes.hexlify(vector.hex),
      ).to.equal(vector.hex);

      // Test bytes array to hex string
      expect(
        utils.bytes.hexlify(vector.array),
      ).to.equal(vector.hex);

      // Test number to hex string
      expect(
        utils.bytes.hexlify(vector.number),
      ).to.equal(vector.hex);
    });
  });

  it('Should arrayify', () => {
    convertVectors.forEach((vector) => {
      // Test hex string to byte array
      expect(
        utils.bytes.arrayify(vector.hex),
      ).to.deep.equal(vector.array);

      // Test byte array to byte array
      expect(
        utils.bytes.arrayify(vector.array),
      ).to.deep.equal(vector.array);

      // Test number to byte array
      expect(
        utils.bytes.arrayify(vector.number),
      ).to.deep.equal(vector.array);
    });
  });

  it('Should numberify', () => {
    convertVectors.forEach((vector) => {
      // Test hex string to number
      expect(
        utils.bytes.numberify(vector.hex).eq(vector.number),
      ).to.equal(true);

      // Test hex string to number little endian
      expect(
        utils.bytes.numberify(vector.hex, 'le').eq(vector.numberLe),
      ).to.equal(true);

      // Test byte array to number
      expect(
        utils.bytes.numberify(vector.array).eq(vector.number),
      ).to.equal(true);

      // Test byte array to number little endian
      expect(
        utils.bytes.numberify(vector.array, 'le').eq(vector.numberLe),
      ).to.equal(true);

      // Test number to number
      expect(
        utils.bytes.numberify(vector.number).eq(vector.number),
      ).to.equal(true);
    });
  });

  it('Should pad to length', () => {
    padVectors.forEach((vector) => {
      expect(
        utils.bytes.padToLength(vector.original, 16),
      ).to.deep.equal(vector.left16);

      expect(
        utils.bytes.padToLength(vector.original, 32),
      ).to.deep.equal(vector.left32);

      expect(
        utils.bytes.padToLength(vector.original, 16, 'right'),
      ).to.deep.equal(vector.right16);

      expect(
        utils.bytes.padToLength(vector.original, 32, 'right'),
      ).to.deep.equal(vector.right32);
    });

    expect(
      () => utils.bytes.padToLength('000000', 2),
    ).to.throw();

    expect(
      () => utils.bytes.padToLength([0, 0, 0], 2),
    ).to.throw();
  });

  it('Should reverse bytes', () => {
    const vectors = [
      {
        bytes: '',
        reversed: '',
      },
      {
        bytes: '001122',
        reversed: '221100',
      },
      {
        bytes: [0x1, 0x2, 0x3, 0x4],
        reversed: [0x4, 0x3, 0x2, 0x1],
      },
    ];

    vectors.forEach((vector) => {
      expect(utils.bytes.reverseBytes(vector.bytes)).to.deep.equal(vector.reversed);
    });
  });

  it('Should convert to/from utf8 string', () => {
    stringVectors.forEach((vector) => {
      // Test bytes -> string
      expect(
        utils.bytes.toUTF8String(vector.hex),
      ).to.equal(vector.utf8);

      // Test string -> bytes
      expect(
        utils.bytes.fromUTF8String(vector.utf8),
      ).to.equal(vector.hex);
    });

    // Brute force test all characters
    let testString = '';

    // Loop through every character and add to string
    for (let codePoint = 0x0; codePoint <= 0x0800; codePoint += 1) {
      testString = testString.concat(String.fromCodePoint(codePoint));
    }

    // Split into groups of 20
    const vectors: string[] = testString.match(/.{1,20}/g) || [];

    // Loop through each group and test
    vectors.forEach((vector) => {
      // Test against Buffer output as reference
      const bytes = Buffer.from(vector, 'utf8').toString('hex');

      // Test bytes -> string
      expect(
        utils.bytes.toUTF8String(bytes),
      ).to.equal(vector);

      // Test string -> bytes
      expect(
        utils.bytes.fromUTF8String(vector),
      ).to.equal(bytes);
    });

    // Test full string
    const fullBytes = Buffer.from(testString, 'utf8').toString('hex');

    // Test bytes -> string
    expect(
      utils.bytes.toUTF8String(fullBytes),
    ).to.equal(testString);

    // Test string -> bytes
    expect(
      utils.bytes.fromUTF8String(testString),
    ).to.equal(fullBytes);
  });
});
