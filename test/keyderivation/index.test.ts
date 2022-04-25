/* globals describe it */
import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';

import { Node } from '../../src/keyderivation/bip32';

chai.use(chaiAsPromised);
const { expect } = chai;

describe('Key Derivation/Index', () => {
  it.only('Should derive keys', async () => {
    const vectors = [
      {
        mnemonic:
          'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
        path: "m/0'",
        spendingKeyPair: {
          privateKey:
            12835268173099116305231859677177501123414588269721547120001227054861606950622n,
          pubkey: [
            14083984939662071011401167760697752113043432190458182844541673823053362319764n,
            21310960765788278922816517663174809377657627294533608923262632356974197128452n,
          ],
        },
        viewingKeyPair: {
          privateKey:
            46969542220796879016376410521720564972269508226277703975670204274423683717615n,
          pubkey: new Uint8Array([
            13, 235, 247, 125, 142, 148, 54, 252, 7, 160, 220, 63, 232, 189, 144, 194, 245, 146,
            160, 140, 171, 141, 190, 95, 151, 42, 71, 131, 70, 92, 214, 212,
          ]),
        },
        nullifyingKey:
          12835268173099116305231859677177501123414588269721547120001227054861606950622n,
      },
      {
        mnemonic:
          'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
        path: "m/0'/1'",
        spendingKeyPair: {
          privateKey:
            12433581129726328896745774227574786958991377531034322249715552469191536529193n,
          pubkey: [
            17161062155931304726039564499263228122384999345745267706563971001031823690268n,
            16208254563265748415413351675192601813074580649593428052582523425528910577213n,
          ],
        },
        viewingKeyPair: {
          privateKey:
            23592376095387427818514529072779933849605295636867027866700950066612041861982n,
          pubkey: new Uint8Array([
            188, 10, 133, 20, 54, 28, 82, 39, 129, 118, 54, 192, 105, 143, 30, 183, 217, 77, 82,
            240, 122, 203, 88, 224, 107, 241, 219, 145, 159, 230, 69, 20,
          ]),
        },
        nullifyingKey:
          12433581129726328896745774227574786958991377531034322249715552469191536529193n,
      },
      {
        mnemonic:
          'culture flower sunny seat maximum begin design magnet side permit coin dial alter insect whisper series desk power cream afford regular strike poem ostrich',
        path: "m/1984'/0'/1'/1'",
        spendingKeyPair: {
          privateKey:
            16602386444438786679333393766394518037774007889700655746209679443354561523707n,
          pubkey: [
            3438987879344226005913209102354591076474939855961971281410445861003288295304n,
            6389432808204019935642191623139427620108117990337550214493989137989189263409n,
          ],
        },
        viewingKeyPair: {
          privateKey:
            78987587486830755496454647526361053194558592953505213644957993197944106360157n,
          pubkey: new Uint8Array([
            28, 112, 24, 121, 34, 161, 22, 10, 20, 98, 221, 72, 216, 131, 91, 146, 55, 237, 168,
            255, 121, 6, 217, 124, 152, 150, 232, 196, 138, 161, 179, 243,
          ]),
        },
        nullifyingKey:
          16602386444438786679333393766394518037774007889700655746209679443354561523707n,
      },
    ];

    await Promise.all(
      vectors.map(async (vector) => {
        const node = Node.fromMnemonic(vector.mnemonic);
        expect(node.derive(vector.path).getSpendingKeyPair()).to.deep.equal(vector.spendingKeyPair);
        expect(await node.derive(vector.path).getViewingKeyPair()).to.deep.equal(
          vector.viewingKeyPair,
        );
        expect(await node.derive(vector.path).getNullifyingKey()).to.equal(vector.nullifyingKey);
      }),
    );
  });
});
