/* globals describe it */
import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';

import bech32 from '../../src/keyderivation/bech32-encode';

chai.use(chaiAsPromised);
const { expect } = chai;

describe('Key Derivation/Bech32 Encode', () => {
  it('Should encode and decode addresses', () => {
    const vectors = [
      {
        key: '00000000',
        version: undefined,
        chainID: 1,
        address: 'rgeth1qyqqqqqqqz8wnw',
      },
      {
        key: '01bfd5681c0479be9a8ef8dd8baadd97115899a9af30b3d2455843afb41b',
        version: 1,
        chainID: 56,
        address: 'rgbsc1qyqml4tgrsz8n0563mudmza2mkt3zkye4xhnpv7jg4vy8ta5rvr770qf',
      },
      {
        key: 'ee6b4c702f8070c8ddea1cbb8b0f6a4a518b77fa8d3f9b68617b664550e75f649ed233',
        version: 3,
        chainID: undefined,
        address: 'rgany1q0hxknrs97q8pjxaagwthzc0df99rzmhl2xnlxmgv9akv32sua0kf8kjxvj8z69f',
      },
    ];

    vectors.forEach((vector) => {
      expect(bech32.encode(vector.key, vector.chainID, vector.version))
        .to.equal(vector.address);

      expect(bech32.decode(vector.address)).to.deep.equal({
        key: vector.key,
        version: vector.version || 1,
        chainID: vector.chainID,
      });
    });
  });
});
