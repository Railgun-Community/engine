/* globals describe it */
import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { hexToBytes } from 'ethereum-cryptography/utils';

import { encode, decode, ADDRESS_LENGTH_LIMIT } from '../../src/keyderivation/bech32-encode';
import { formatToByteLength } from '../../src/utils/bytes';

chai.use(chaiAsPromised);
const { expect } = chai;

describe('Key Derivation/Bech32 Encode', () => {
  it('Should encode and decode addresses', () => {
    const vectors = [
      {
        pubkey: '00000000',
        chainID: 1,
        address:
          '0zk1qyqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqunpd9kxwatwqyqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqhshkca',
        version: 1,
      },
      {
        pubkey: '01bfd5681c0479be9a8ef8dd8baadd97115899a9af30b3d2455843afb41b',
        chainID: 56,
        address:
          '0zk1qyqqqqdl645pcpreh6dga7xa3w4dm9c3tzv6ntesk0fy2kzr476pkunpd9kxwatw8qqqqqdl645pcpreh6dga7xa3w4dm9c3tzv6ntesk0fy2kzr476pkcsu8tp',
        version: 1,
      },
      {
        pubkey: 'ee6b4c702f8070c8ddea1cbb8b0f6a4a518b77fa8d3f9b68617b664550e75f64',
        chainID: undefined,
        address:
          '0zk1q8hxknrs97q8pjxaagwthzc0df99rzmhl2xnlxmgv9akv32sua0kfrv7j6fe3z53llhxknrs97q8pjxaagwthzc0df99rzmhl2xnlxmgv9akv32sua0kg0zpzts',
        version: 1,
      },
    ];

    vectors.forEach((vector, index) => {
      const v = {
        masterPublicKey: BigInt(`0x${vector.pubkey}`),
        viewingPublicKey: hexToBytes(formatToByteLength(vector.pubkey, 32, false)),
        chainID: vector.chainID,
        version: vector.version,
      };
      const encoded = encode(v);
      expect(encoded).to.equal(vector.address);
      expect(encoded.length).to.equal(ADDRESS_LENGTH_LIMIT);
      expect(decode(encoded)).to.deep.equal(v, `Incorrect values for vector index ${index}`);
    });
  });

  it('Should throw error on invalid address checksum', () => {
    expect(() => {
      decode('rgany1pnj7u66vwqhcquxgmh4pewutpa4y55vtwlag60umdpshkej92rn47ey76ges3t3enn');
    }).to.throw('Invalid checksum');
  });

  it('Should throw error on invalid address prefix', () => {
    expect(() => {
      decode(
        'rg1qyqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqunpd9kxwatwqyqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqsfhuuw',
      );
    }).to.throw('Invalid address prefix');
  });
});
