/* globals describe it */
import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';

import keyderivation from '../../src/keyderivation';

chai.use(chaiAsPromised);
const { expect } = chai;

describe('Key Derivation/Index', () => {
  it('Should derive keys', () => {
    const vectors = [
      {
        mnemonic: 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
        path: "m/0'",
        keyPair: {
          privateKey: '0bd2dfe7ed7323285b1dbc3480580ef16eb488b62038f5095308551103902c03',
          publicKey: 'ca4f21fd1830763f22a39fc31d4f5436d389a513ceb4c51b85c310a25c121323',
        },
      },
      {
        mnemonic: 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
        path: "m/0'/1'",
        keyPair: {
          privateKey: '0d39f9b2d1f48e8a10f4417b0fac542db663106faeb4f0047c51b6e06a850fa3',
          publicKey: '4135fb27b175c77328f59cf1f7faf30ed51264c6497ec31a3a6af72b65cafa09',
        },
      },
      {
        mnemonic: 'culture flower sunny seat maximum begin design magnet side permit coin dial alter insect whisper series desk power cream afford regular strike poem ostrich',
        path: "m/1984'/0'/1'/1'",
        keyPair: {
          privateKey: '0f75f0f0f1e2d1021b1d7f839bea176d24c87e089ee959c6fb9c0e650473d684',
          publicKey: 'f0778519e8392743ac51cfb56d3e58d0aa3a78bda158f5a2adbd2d57615fcb0e',
        },
      },
    ];

    vectors.forEach((vector) => {
      const node = keyderivation.fromMnemonic(vector.mnemonic);
      expect(node.derive(vector.path).getBabyJubJubKey()).to.deep.equal(vector.keyPair);
    });
  });
});
