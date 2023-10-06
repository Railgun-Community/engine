import BN from 'bn.js';
import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import {
  arrayify,
  assertBytesWithinRange,
  ByteLength,
  chunk,
  combine,
  formatToByteLength,
  fromUTF8String,
  hexlify,
  numberify,
  padToLength,
  randomHex,
  reverseBytes,
  toUTF8String,
  trim,
} from '../bytes';

chai.use(chaiAsPromised);
const { expect } = chai;

const convertVectors = [
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
    array: [80, 82, 73, 86, 65, 67, 89, 32, 38, 32, 65, 78, 79, 78, 89, 77, 73, 84, 89],
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
    left16: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    left32: [
      0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
      0,
    ],
    right16: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    right32: [
      0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
      0,
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
    left16: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 32, 12, 18, 245],
    left32: [
      0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 32, 12,
      18, 245,
    ],
    right16: [32, 12, 18, 245, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    right32: [
      32, 12, 18, 245, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
      0, 0,
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
    original: '0xf6fc84c9f21c24907d6bee6eec38caba',
    left16: '0xf6fc84c9f21c24907d6bee6eec38caba',
    left32: '0x00000000000000000000000000000000f6fc84c9f21c24907d6bee6eec38caba',
    right16: '0xf6fc84c9f21c24907d6bee6eec38caba',
    right32: '0xf6fc84c9f21c24907d6bee6eec38caba00000000000000000000000000000000',
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

describe('bytes', () => {
  it('Should return random values', () => {
    // Check length of random values is what we expect
    expect(randomHex().length).to.equal(64);
    expect(randomHex(1).length).to.equal(2);
    expect(randomHex(128).length).to.equal(256);
  });

  it('Should hexlify', () => {
    convertVectors.forEach((vector) => {
      // Test prefixed hex string to hex string
      expect(hexlify(`0x${vector.hex}`)).to.equal(vector.hex);

      // Test hex string to hex string
      expect(hexlify(vector.hex)).to.equal(vector.hex);

      // Test hex string to hex string prefixed
      expect(hexlify(vector.hex, true)).to.equal(`0x${vector.hex}`);

      // Test bytes array to hex string
      expect(hexlify(vector.array)).to.equal(vector.hex);

      // Test bytes array to hex string prefixed
      expect(hexlify(vector.array, true)).to.equal(`0x${vector.hex}`);

      // Test number to hex string
      expect(hexlify(vector.number)).to.equal(vector.hex);

      // Test number to hex string prefixed
      expect(hexlify(vector.number, true)).to.equal(`0x${vector.hex}`);
    });
  });

  it('Should arrayify', () => {
    convertVectors.forEach((vector) => {
      // Test prefixed hex string to hex string
      expect(arrayify(`0x${vector.hex}`)).to.deep.equal(vector.array);

      // Test hex string to byte array
      expect(arrayify(vector.hex)).to.deep.equal(vector.array);

      // Test byte array to byte array
      expect(arrayify(vector.array)).to.deep.equal(vector.array);

      // Test number to byte array
      expect(arrayify(vector.number)).to.deep.equal(vector.array);
    });
  });

  it('Should not arrayify invalid BytesData', () => {
    const invalid = 'zzzzza';
    expect(() => arrayify(invalid)).to.throw('Invalid BytesData');
  });

  it('Should not numberify bad input', () => {
    const vectors = [hexlify(' '), hexlify('-'), hexlify('')];
    vectors.forEach((vector) => {
      expect(() => numberify(vector)).to.throw(/Invalid BytesData/);
    });
  });

  it('Should numberify', () => {
    convertVectors.forEach((vector) => {
      // Test prefixed hex string to hex string
      expect(numberify(`0x${vector.hex}`).eq(vector.number)).to.equal(true);

      // Test hex string to number
      expect(numberify(vector.hex).eq(vector.number)).to.equal(true);

      // Test hex string to number little endian
      expect(numberify(vector.hex, 'le').eq(vector.numberLe)).to.equal(true);

      // Test byte array to number
      expect(numberify(vector.array).eq(vector.number)).to.equal(true);

      // Test byte array to number little endian
      expect(numberify(vector.array, 'le').eq(vector.numberLe)).to.equal(true);

      // Test number to number
      expect(numberify(vector.number).eq(vector.number)).to.equal(true);
    });
  });

  it('Should pad to length', () => {
    padVectors.forEach((vector) => {
      expect(padToLength(vector.original, 16)).to.deep.equal(vector.left16);

      expect(padToLength(vector.original, 32)).to.deep.equal(vector.left32);

      expect(padToLength(vector.original, 16, 'right')).to.deep.equal(vector.right16);

      expect(padToLength(vector.original, 32, 'right')).to.deep.equal(vector.right32);
    });

    expect(padToLength('0x00', 4)).to.equal('0x00000000');
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
      expect(reverseBytes(vector.bytes)).to.deep.equal(vector.reversed);
    });
  });

  it('Should convert to/from utf8 string', () => {
    const validVectors = stringVectors.slice(0, 1);
    validVectors.forEach((vector) => {
      // Test bytes -> string
      expect(toUTF8String(vector.hex)).to.equal(vector.utf8);

      // Test string -> bytes
      expect(fromUTF8String(vector.utf8)).to.equal(vector.hex);
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
      const bytesdata = Buffer.from(vector, 'utf8').toString('hex');

      // Test bytes -> string
      expect(toUTF8String(bytesdata)).to.equal(vector);

      // Test string -> bytes
      expect(fromUTF8String(vector)).to.equal(bytesdata);
    });

    // Test full string
    const fullBytes = Buffer.from(testString, 'utf8').toString('hex');

    // Test bytes -> string
    expect(toUTF8String(fullBytes)).to.equal(testString);

    // Test string -> bytes
    expect(fromUTF8String(testString)).to.equal(fullBytes);
  });

  it('Should throw if utf8 string contains invalid characters', () => {
    const invalidVectors = stringVectors.slice(2);
    invalidVectors.forEach((vector) => {
      expect(() => toUTF8String(vector.hex)).to.throw(/Invalid/);
      expect(() => assertBytesWithinRange(vector.utf8)).to.throw(/Invalid/);
      expect(() => fromUTF8String(vector.utf8)).to.throw(/Invalid/);
    });
  });

  it('Should chunk and combine bytes', () => {
    const vectors = [
      {
        bytes: '',
        size: 32,
        chunked: [],
      },
      {
        bytes:
          '5d0afac6783502d701ebd089be93f497bd46ea52b0fb2a4304a952572899aadb032b6a5bae56a1423ffb6bfeb3416b01748a6bbffc5ae430c572b00953dca448',
        size: 32,
        chunked: [
          '5d0afac6783502d701ebd089be93f497bd46ea52b0fb2a4304a952572899aadb',
          '032b6a5bae56a1423ffb6bfeb3416b01748a6bbffc5ae430c572b00953dca448',
        ],
      },
      {
        bytes:
          '5d0afac6783502d701ebd089be93f497bd46ea52b0fb2a4304a952572899aadb032b6a5bae56a1423ffb6bfeb3416b01748a6bbffc5ae430c572b00953dca448',
        size: 16,
        chunked: [
          '5d0afac6783502d701ebd089be93f497',
          'bd46ea52b0fb2a4304a952572899aadb',
          '032b6a5bae56a1423ffb6bfeb3416b01',
          '748a6bbffc5ae430c572b00953dca448',
        ],
      },
      {
        bytes:
          '5d0afac6783502d701ebd089be93f497bd46ea52b0fb2a4304a952572899aadb032b6a5bae56a1423ffb6bfeb3416b01748a6bbffc5ae430c572b00953dca448',
        size: 25,
        chunked: [
          '5d0afac6783502d701ebd089be93f497bd46ea52b0fb2a4304',
          'a952572899aadb032b6a5bae56a1423ffb6bfeb3416b01748a',
          '6bbffc5ae430c572b00953dca448',
        ],
      },
    ];

    expect(chunk('5d0afa')).to.deep.equal(['5d0afa']);

    vectors.forEach((vector) => {
      expect(chunk(vector.bytes, vector.size)).to.deep.equal(vector.chunked);
      expect(combine(vector.chunked)).to.equal(vector.bytes);
    });
  });

  it('Should trim bytes', () => {
    expect(() => {
      trim(new BN(32), 1, 'right');
    }).to.throw('Can\t trim BN from right');
    expect(trim(new BN(861), 1).toString(10)).to.equal('93');
    expect(trim('17b3c8d9', 2)).to.equal('c8d9');
    expect(trim('17b3c8d9', 2, 'right')).to.equal('17b3');
    expect(trim('0x17b3c8d9', 2)).to.equal('0xc8d9');
    expect(trim('0x17b3c8d9', 2, 'right')).to.equal('0x17b3');
    expect(trim([12, 4, 250], 2)).to.deep.equal([4, 250]);
    expect(trim([12, 4, 250], 2, 'right')).to.deep.equal([12, 4]);
  });

  it('Should format data to byte length', () => {
    expect(formatToByteLength('17b3c8d9', ByteLength.UINT_8, true)).to.equal('0xd9');
    expect(formatToByteLength('17b3c8d9', ByteLength.Address, true)).to.equal(
      '0x0000000000000000000000000000000017b3c8d9',
    );
    expect(formatToByteLength('17b3c8d9', ByteLength.UINT_256)).to.equal(
      '0000000000000000000000000000000000000000000000000000000017b3c8d9',
    );
  });
});
