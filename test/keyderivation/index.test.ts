/* globals describe it */
import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';

import { Node } from '../../src/keyderivation/bip32';

chai.use(chaiAsPromised);
const { expect } = chai;

const VECTORS = [
  {
    mnemonic:
      'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
    path: "m/0'",
    spendingKeyPair: {
      privateKey: new Uint8Array([
        103, 215, 209, 157, 0, 230, 227, 179, 81, 127, 230, 138, 196, 101, 5, 221, 32, 125, 246,
        232, 254, 58, 160, 107, 163, 250, 206, 53, 46, 117, 153, 239,
      ]),
      pubkey: [
        1700559105542139805112168139351320601853033442476682590258553412078471731431n,
        20772987336827599306927277921643441679141423747083423413320022373456048866305n,
      ],
    },
    viewingKeyPair: {
      privateKey: new Uint8Array([
        103, 215, 209, 157, 0, 230, 227, 179, 81, 127, 230, 138, 196, 101, 5, 221, 32, 125, 246,
        232, 254, 58, 160, 107, 163, 250, 206, 53, 46, 117, 153, 239,
      ]),
      pubkey: new Uint8Array([
        33, 167, 21, 27, 23, 248, 151, 86, 206, 65, 50, 200, 239, 93, 171, 82, 218, 213, 177, 73,
        194, 127, 236, 166, 100, 30, 56, 66, 35, 145, 223, 8,
      ]),
    },
    nullifyingKey: 12835268173099116305231859677177501123414588269721547120001227054861606950622n,
  },
  {
    mnemonic:
      'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
    path: "m/0'/1'",
    spendingKeyPair: {
      privateKey: new Uint8Array([
        52, 40, 207, 201, 57, 50, 3, 40, 80, 17, 116, 164, 231, 110, 134, 145, 151, 255, 200, 148,
        181, 141, 191, 77, 14, 149, 60, 72, 77, 102, 203, 94,
      ]),
      pubkey: [
        16684668252477829187059584092631702151145377657154285130424212860540363370357n,
        12981690610069374219327647242965768905998412239681315744257339323456415609107n,
      ],
    },
    viewingKeyPair: {
      privateKey: new Uint8Array([
        52, 40, 207, 201, 57, 50, 3, 40, 80, 17, 116, 164, 231, 110, 134, 145, 151, 255, 200, 148,
        181, 141, 191, 77, 14, 149, 60, 72, 77, 102, 203, 94,
      ]),
      pubkey: new Uint8Array([
        95, 51, 170, 123, 135, 206, 89, 43, 171, 18, 151, 57, 18, 190, 220, 71, 16, 101, 132, 81, 2,
        123, 159, 111, 209, 51, 209, 250, 104, 226, 38, 23,
      ]),
    },
    nullifyingKey: 12433581129726328896745774227574786958991377531034322249715552469191536529193n,
  },
  {
    mnemonic:
      'culture flower sunny seat maximum begin design magnet side permit coin dial alter insect whisper series desk power cream afford regular strike poem ostrich',
    path: "m/1984'/0'/1'/1'",
    spendingKeyPair: {
      privateKey: new Uint8Array([
        174, 161, 99, 229, 87, 84, 149, 94, 180, 249, 130, 131, 138, 60, 244, 236, 172, 83, 232, 9,
        167, 168, 25, 67, 167, 236, 115, 134, 66, 111, 157, 93,
      ]),
      pubkey: [
        14701770942636881946891894801429513727414463095087240498212571459549371788442n,
        6562351643365832094839703629534233618348049923815027910705830997906348902485n,
      ],
    },
    viewingKeyPair: {
      privateKey: new Uint8Array([
        174, 161, 99, 229, 87, 84, 149, 94, 180, 249, 130, 131, 138, 60, 244, 236, 172, 83, 232, 9,
        167, 168, 25, 67, 167, 236, 115, 134, 66, 111, 157, 93,
      ]),
      pubkey: new Uint8Array([
        179, 234, 231, 133, 15, 115, 28, 82, 68, 170, 201, 138, 1, 89, 235, 238, 221, 201, 83, 183,
        24, 31, 138, 166, 142, 10, 188, 89, 121, 52, 224, 45,
      ]),
    },
    nullifyingKey: 16602386444438786679333393766394518037774007889700655746209679443354561523707n,
  },
];

describe('Key Derivation/Index', () => {
  it('Should derive spending keys', async () => {
    // TODO-VECTORS: Vectors need confirming.

    await Promise.all(
      VECTORS.map(async (vector) => {
        const node = Node.fromMnemonic(vector.mnemonic);
        expect(node.derive(vector.path).getSpendingKeyPair()).to.deep.equal(vector.spendingKeyPair);
      }),
    );
  });

  it('Should derive viewing keys', async () => {
    // TODO-VECTORS: Vectors need confirming.

    await Promise.all(
      VECTORS.map(async (vector) => {
        const node = Node.fromMnemonic(vector.mnemonic);
        expect(await node.derive(vector.path).getViewingKeyPair()).to.deep.equal(
          vector.viewingKeyPair,
        );
      }),
    );
  });

  it('Should derive nullifying keys', async () => {
    // TODO-VECTORS: Vectors need confirming.

    await Promise.all(
      VECTORS.map(async (vector) => {
        const node = Node.fromMnemonic(vector.mnemonic);
        expect(await node.derive(vector.path).getNullifyingKey()).to.equal(vector.nullifyingKey);
      }),
    );
  });
});
