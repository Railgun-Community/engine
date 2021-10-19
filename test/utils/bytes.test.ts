/* globals describe it */
import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';

import utils from '../../src/utils';

chai.use(chaiAsPromised);
const { expect } = chai;

describe('Utils/Bytes', () => {
  it('Should return random values', () => {
    // Check length of random values is what we expect
    expect(utils.bytes.random().length).to.equal(64);
    expect(utils.bytes.random(1).length).to.equal(2);
    expect(utils.bytes.random(128).length).to.equal(256);
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
});
