/* globals describe it */
import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';

import { hash } from '../../src/utils';

chai.use(chaiAsPromised);
const { expect } = chai;

describe('Utils/Hash', () => {
  it('Should perform sha256 hashes', () => {
    const vectors = [
      {
        preImage: '',
        array: new Uint8Array([]),
        result: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      },
      {
        preImage: '5241494c47554e',
        array: new Uint8Array([82, 65, 73, 76, 71, 85, 78]),
        result: 'b25e4f3027088a658fa918eb93fd905969be8f455adb942987aa866013c9f836',
      },
      {
        preImage: '50524956414359202620414e4f4e594d495459',
        array: new Uint8Array([
          80, 82, 73, 86, 65, 67, 89, 32, 38, 32, 65, 78, 79, 78, 89, 77, 73, 84, 89,
        ]),
        result: '947fa99dc47b17d91b3aceec798dcee836744c68423e9b41b9d1b7ffba8fdc8c',
      },
    ];

    vectors.forEach((vector) => {
      // Test hex string hash
      expect(hash.sha256(vector.preImage)).to.equal(vector.result);

      // Test bytes array hash
      expect(hash.sha256(vector.array)).to.equal(vector.result);
    });
  });

  it('Should perform sha512 hashes', () => {
    const vectors = [
      {
        preImage: '',
        array: new Uint8Array([]),
        result:
          'cf83e1357eefb8bdf1542850d66d8007d620e4050b5715dc83f4a921d36ce9ce47d0d13c5d85f2b0ff8318d2877eec2f63b931bd47417a81a538327af927da3e',
      },
      {
        preImage: '5241494c47554e',
        array: new Uint8Array([82, 65, 73, 76, 71, 85, 78]),
        result:
          'ff66fdbf6b51995a981aa4400645a04067d0293863ba961b8b84527f07450f7b513e266aa9e6b25727be754bfe96b7e99c01ac4db2220f8f2ae4d057248ab204',
      },
      {
        preImage: '50524956414359202620414e4f4e594d495459',
        array: new Uint8Array([
          80, 82, 73, 86, 65, 67, 89, 32, 38, 32, 65, 78, 79, 78, 89, 77, 73, 84, 89,
        ]),
        result:
          'f2c5c93699191d322d21f23656d91e35a3313f429c17760378d79e4974b178d22d7d4d9c2426e3f3b7e2d2e1c3e9544a136551063def4a38b82420ca6e3a4679',
      },
    ];

    vectors.forEach((vector) => {
      // Test hex string hash
      expect(hash.sha512(vector.preImage)).to.equal(vector.result);

      // Test bytes array hash
      expect(hash.sha512(vector.array)).to.equal(vector.result);
    });
  });

  it('Should perform keccak256 hashes', () => {
    const vectors = [
      {
        preImage: '',
        array: new Uint8Array([]),
        result: 'c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470',
      },
      {
        preImage: '5241494c47554e',
        array: new Uint8Array([82, 65, 73, 76, 71, 85, 78]),
        result: 'ef0394c8ea7550db58adcb1b8ffb98f76fca939554a4084889b6bffa01aac296',
      },
      {
        preImage: '50524956414359202620414e4f4e594d495459',
        array: new Uint8Array([
          80, 82, 73, 86, 65, 67, 89, 32, 38, 32, 65, 78, 79, 78, 89, 77, 73, 84, 89,
        ]),
        result: '5c7d261b35e3b58c6ca6663e44b736a7fbbc0e2265cd050959f4976f8667d306',
      },
    ];

    vectors.forEach((vector) => {
      // Test hex string hash
      expect(hash.keccak256(vector.preImage)).to.equal(vector.result);

      // Test bytes array hash
      expect(hash.keccak256(vector.array)).to.equal(vector.result);
    });
  });

  it('Should perform sha512 HMAC hashes', () => {
    const vectors = [
      {
        preImage: '',
        array: new Uint8Array([]),
        key: 'aa',
        keyArray: [170],
        result:
          '4e9f386d58475d4e030c55c47f54ab3e2e5790d2aaaedc2f4465b5665a5307da3416778a481a09a2f18e1db63c26d741aa0a82af5a38a893bf9793fb7dea031e',
      },
      {
        preImage: '5241494c47554e',
        array: new Uint8Array([82, 65, 73, 76, 71, 85, 78]),
        key: 'bb',
        keyArray: [187],
        result:
          '206aca0dd9a7d87873692ff48a91f0c495ab896c488c4af5e7062774e8841298ddc9eee9699a6930b545aebf6dd3504bcef331231368318da26bb3783fdcc086',
      },
      {
        preImage: '50524956414359202620414e4f4e594d495459',
        array: new Uint8Array([
          80, 82, 73, 86, 65, 67, 89, 32, 38, 32, 65, 78, 79, 78, 89, 77, 73, 84, 89,
        ]),
        key: 'cc',
        keyArray: [204],
        result:
          'b3513bb5230d933d8dc2cf28eddfa566bb76f49aa9bdf6f2475df0405feaaab4782d9d7a177ee9e32aa1e0af0ca0bb93a3c0312aa18788c7944a24f761bdcc1a',
      },
    ];

    vectors.forEach((vector) => {
      // Test hex string hash
      expect(hash.sha512HMAC(vector.key, vector.preImage)).to.equal(vector.result);

      // Test bytes array hash
      expect(hash.sha512HMAC(vector.keyArray, vector.array)).to.equal(vector.result);
    });
  });

  it('Should perform poseidon hashes', () => {
    const vectors = [
      {
        preImage: [[0x1], [0x2]],
        result: '115cc0f5e7d690413df64c6b9662e9cf2a3617f2743245519e19607a4417189a',
      },
      {
        preImage: [[0x1], [0x2], [0x3], [0x4]],
        result: '299c867db6c1fdd79dcefa40e4510b9837e60ebb1ce0663dbaa525df65250465',
      },
      {
        preImage: ['6b021e0d06d0b2d161cf0ea494e3fc1cbff12cc1b29281f7412170351b708fad'],
        result: '0b77a7c8dcbf2c84e75b6ff1dd558365532956cb7c1f328a67220a3a47a3ab43',
      },
    ];

    vectors.forEach((vector) => {
      expect(hash.poseidon(vector.preImage)).to.equal(vector.result);
    });
  });

  it('Should perform pbkdf2 hashes', async () => {
    const vectors = [
      {
        secret:
          '676c6f7279206d6978206469676974616c206475747920616e616c79737420706879736963616c20636c75737465722067656e75696e65206465736b20696e6469636174652061746f6d20746872697665',
        salt: '6d6e656d6f6e6963',
        result:
          '5fcafbbfe78d319c631598d1f2a13b06d9a39fdda323683c64082945d234660b0c460599f5f1b267be39cb140c5c360273f95cb30bae6fafed966476e5d91dd6',
      },
      {
        secret:
          '70617469656e742071756f7465207061747465726e207768656e207069656365206d75737420656d65726765206f616b206f626a656374206e61706b696e2074776963652077686970',
        salt: '6d6e656d6f6e69637465737470617373',
        result:
          '89b2d609ff80008fee887c799436c791644cb39ed820fbc4dad2f43713ef781616cbc2036a29f22236ac22ea1e1b1c66a97cc4ecdcf093fb270ae61690d3b0e9',
      },
    ];

    vectors.forEach(async (vector) => {
      expect(await hash.pbkdf2(vector.secret, vector.salt, 2048, 64, 'sha512')).to.equal(
        vector.result,
      );
    });
  });
});
