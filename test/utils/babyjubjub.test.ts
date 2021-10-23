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

  it('Should perform ECDH operations correctly', () => {
    const vectors = [
      {
        keyA: {
          private: '0b19eb11c1412cbc15c65dea82b61d02f7c8c5d58e2c9884125ed86eebcfd325',
          public: '6595f9a971c7471695948a445aedcbb9d624a325dbe68c228dea25eccf61919d',
        },
        keyB: {
          private: '0edbfaa1ddc148178b47abac6bb1051b54cdbe8b92ab42e3575696bbefe101a0',
          public: '2e16136258306d0837a3e3c87e329d835f58dac6879e31d41d4690845cb2a914',
        },
        sharedKey: '053b8632c6a35c58d857beb1b9a7928e28b830cf700a6dbaf141e8391c6cbcf5',
      },
      {
        keyA: {
          private: '0b251c4f746c9567185ba40f4a1db0c881ac4fa6b3d090153ccae1bac2a46983',
          public: 'f63395d36c024b4c9af5c5c1e581fff216e741ed9a0f404b3eb1903bbf274b1c',
        },
        keyB: {
          private: '0b1a11822cff763ed1c9b57ebe0399373687c68feafd9f1b67240a6d56a481a0',
          public: '0db982dde20781925565e30034496af26fcfab731dd265a2c9363eb14a0ac89a',
        },
        sharedKey: '19aa730d1af1b553f6ad56018bc09105e6d53b533abc47de89df8a19bd5c4bde',
      },
      {
        keyA: {
          private: '0c60a0eb058f68c279632ac2db824ac5610992e9aef53aa8d80028c5fdf25225',
          public: '6f8a7164e562db168bbebbd19ba447ccd30be09d33946df4f1d2019c83720205',
        },
        keyB: {
          private: '0e44b9ffb6becefddf06edbd717eb3fa740d1a424bcb5003cac2112d71f7eb63',
          public: '5b3619619f75f71b2d113f31227253c6012b6af561f7fa604cafea10f169ee2c',
        },
        sharedKey: '2643aca561253bc0f506cba9610062e01d698d705d558d823ce070547139c9a3',
      },
    ];

    vectors.forEach((vector) => {
      expect(
        utils.babyjubjub.ecdh(vector.keyA.private, vector.keyB.public),
      ).to.equal(vector.sharedKey);
      expect(
        utils.babyjubjub.ecdh(vector.keyB.private, vector.keyA.public),
      ).to.equal(vector.sharedKey);
    });
  });

  it('Should private keys to public keys correctly', () => {
    const vectors = [
      {
        privateKey: '0bd2dfe7ed7323285b1dbc3480580ef16eb488b62038f5095308551103902c03',
        publicKey: 'ca4f21fd1830763f22a39fc31d4f5436d389a513ceb4c51b85c310a25c121323',
      },
      {
        privateKey: '0d39f9b2d1f48e8a10f4417b0fac542db663106faeb4f0047c51b6e06a850fa3',
        publicKey: '4135fb27b175c77328f59cf1f7faf30ed51264c6497ec31a3a6af72b65cafa09',
      },
      {
        privateKey: '0f75f0f0f1e2d1021b1d7f839bea176d24c87e089ee959c6fb9c0e650473d684',
        publicKey: 'f0778519e8392743ac51cfb56d3e58d0aa3a78bda158f5a2adbd2d57615fcb0e',
      },
    ];

    vectors.forEach((vector) => {
      expect(
        utils.babyjubjub.privateKeyToPublicKey(vector.privateKey),
      ).to.equal(vector.publicKey);
    });
  });
});
