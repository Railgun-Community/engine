/* globals describe it */
import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';

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
        address: 'rgeth1qgqqqqqq6t7rhd',
        version: 1,
      },
      {
        pubkey: '01bfd5681c0479be9a8ef8dd8baadd97115899a9af30b3d2455843afb41b',
        chainID: 56,
        address: 'rgbsc1qgqml4tgrsz8n0563mudmza2mkt3zkye4xhnpv7jg4vy8ta5rvwhwts9',
        version: 1,
      },
      {
        pubkey: 'ee6b4c702f8070c8ddea1cbb8b0f6a4a518b77fa8d3f9b68617b664550e75f649ed233',
        chainID: undefined,
        address: 'rgany1qthxknrs97q8pjxaagwthzc0df99rzmhl2xnlxmgv9akv32sua0kf8kjxvewd2r7',
        version: 1,
      },
    ];

    vectors.forEach((vector) => {
      const v = {
        masterPublicKey: formatToByteLength(vector.pubkey, 32, false) as string,
        viewingPublicKey: formatToByteLength(vector.pubkey, 32, false) as string,
        chainID: vector.chainID,
        version: vector.version,
      };
      const encoded = encode(v);
      expect(encoded.length).to.equal(ADDRESS_LENGTH_LIMIT);
      expect(decode(encoded)).to.deep.equal(v);
    });

    /*
    expect(() => {
      decode('rgany1pnj7u66vwqhcquxgmh4pewutpa4y55vtwlag60umdpshkej92rn47ey76ges3t3enn');
    }).to.throw('Incorrect address version');
    expect(() => {
      decode('rgunknown1q8hxknrs97q8pjxaagwthzc0df99rzmhl2xnlxmgv9akv32sua0kf8kjxv0uzkrc');
    }).to.throw('Address prefix unrecognized');
    */
  });
});
