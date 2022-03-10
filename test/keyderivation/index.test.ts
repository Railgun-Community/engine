/* globals describe it */
import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';

import { BIP32Node } from '../../src/keyderivation';
import { BjjNode } from '../../src/keyderivation/bip32-babyjubjub';

chai.use(chaiAsPromised);
const { expect } = chai;

describe('Key Derivation/Index', () => {
  it('Should create mnemonic', () => {
    expect(BIP32Node.createMnemonic().split(' ').length).to.equal(12);
  });

  it('Should derive keys', () => {
    const vectors = [
      {
        mnemonic: 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
        path: "m/0'",
        keyPair: {
          address: 'rgany1q89y7g0arqc8v0ez5w0ux8202smd8zd9z08tf3gmshp3pgjuzgfjxz8rad5',
          privateKey: '0bd2dfe7ed7323285b1dbc3480580ef16eb488b62038f5095308551103902c03',
          pubkey: 'ca4f21fd1830763f22a39fc31d4f5436d389a513ceb4c51b85c310a25c121323',
        },
      },
      {
        mnemonic: 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
        path: "m/0'/1'",
        keyPair: {
          address: 'rgany1q9qnt7e8k96uwueg7kw0ral67v8d2ynyceyhasc68f40w2m9etaqj85z9qt',
          privateKey: '0d39f9b2d1f48e8a10f4417b0fac542db663106faeb4f0047c51b6e06a850fa3',
          pubkey: '4135fb27b175c77328f59cf1f7faf30ed51264c6497ec31a3a6af72b65cafa09',
        },
      },
      {
        mnemonic: 'culture flower sunny seat maximum begin design magnet side permit coin dial alter insect whisper series desk power cream afford regular strike poem ostrich',
        path: "m/1984'/0'/1'/1'",
        keyPair: {
          address: 'rgany1q8c80pgeaqujwsav288m2mf7trg25wnchks43adz4k7j64mptl9sun7g7an',
          privateKey: '0f75f0f0f1e2d1021b1d7f839bea176d24c87e089ee959c6fb9c0e650473d684',
          pubkey: 'f0778519e8392743ac51cfb56d3e58d0aa3a78bda158f5a2adbd2d57615fcb0e',
        },
      },
    ];

    vectors.forEach((vector) => {
      const node = BjjNode.fromMnemonic(vector.mnemonic);
      expect(node.derive(vector.path).getBabyJubJubKey()).to.deep.equal(vector.keyPair);
    });
  });
});
