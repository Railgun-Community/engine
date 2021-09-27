/* globals describe it */
import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';

import utils from '../../src/utils';

chai.use(chaiAsPromised);
const { expect } = chai;

describe('Utils/BabyJubJub', () => {
  it('Should convert seed to BabyJubJub private key', () => {
    const vectors = [
      {
        seed: '08b2d974aa7fffd9d068b78c34434c534ddcd9343fcbf5aa12cf78e1a3c1ccb9',
        key: '0b1fe7a63f5b802eb4d923d8c9dafea817f1c86495594ab250658e21bb3a7745',
      },
      {
        seed: '6b021e0d06d0b2d161cf0ea494e3fc1cbff12cc1b29281f7412170351b708fad',
        key: '08757468e741444cf14643ef996ac52a6cb06abbbe2deb7cf08597fb9914eee1',
      },
      {
        seed: '3d792e1a4fc636e7b1db44c45595e6fb22795e19faa763f93de959b9cf0f8d33',
        key: '0e26bb84ab35f019bfb8dd7f858756fbe8045ecab251523c65909fdffda71503',
      },
      {
        seed: '209823ab2880ee6d5020d5c401b0f84be48a9a325d6a5e11a66c0bd061d23be5',
        key: '0e8d623ee0372ffce63af4ebba3c05ac9361a3c76ce3dd4306e16d323ed6d8a4',
      },
      {
        seed: 'fa83b66bbdc5ac2f084c2d13792d16f15aeaefa716465d148b95934213551861',
        key: '0b0edbb08f869d425a4a6c38ed7455550194b03d0402b2f3995fdbfbe7c44722',
      },
    ];

    vectors.forEach((vector) => {
      expect(utils.babyjubjub.seedToPrivateKey(vector.seed)).to.equal(vector.key);
    });
  });

  it('Should pack and unpack points', () => {
    const vectors = [
      {
        packed: 'ca3ced20e10276cff4673296dc662f824b1fa47293a410e7a9d6e0c7f28b270b',
        unpacked: [
          '0d1e301110ad685c6fae3474679de6b387d4ba345cda51a65d948d95d4ef6ff8',
          '0b278bf2c7e0d6a9e710a49372a41f4b822f66dc963267f4cf7602e120ed3cca',
        ],
      },
      {
        packed: 'b60c44d4393f23d87701c7a57977a21b2f6c102bd588873958d5dbc5ad862b2e',
        unpacked: [
          '0b285eb42509938512cdc7e38a652ebf1741735701450972a705861689c117cf',
          '2e2b86adc5dbd558398788d52b106c2f1ba27779a5c70177d8233f39d4440cb6',
        ],
      },
      {
        packed: '9bdba6719c57e37396d6b86838ab739fb52798d746993b341fefbdc8109beaac',
        unpacked: [
          '274f55aebac0b046096a78df1dbfb71d099bcd579212769fe13d3c0c9d4c0d61',
          '2cea9b10c8bdef1f343b9946d79827b59f73ab3868b8d69673e3579c71a6db9b',
        ],
      },
    ];

    vectors.forEach((vector) => {
      expect(utils.babyjubjub.packPoint(vector.unpacked)).to.equal(vector.packed);
      expect(utils.babyjubjub.unpackPoint(vector.packed)).to.deep.equal(vector.unpacked);
    });
  });
});
