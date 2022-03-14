/* globals describe it */
import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import {
  EdNode,
  getMasterKeyFromSeed,
  verify,
} from '../../src/keyderivation/bip32-ed25519';
import { config } from '../config.test';
import { bytes } from '../../src/utils';

chai.use(chaiAsPromised);
const { expect } = chai;

const PRIVATE_KEY = config.encryptionKey;

describe('Key Derivation/BIP32 ed25519', async () => {
  describe('Path Derivation', () => {
    // https://github.com/satoshilabs/slips/blob/master/slip-0010.md#test-vector-1-for-ed25519
    const seed = '000102030405060708090a0b0c0d0e0f';
    const vectors = [
      {
        path: "m/0'",
        chainCode: '8b59aa11380b624e81507a27fedda59fea6d0b779a778918a2fd3590e16e9c69',
        key: '68e0fe46dfb67e368c75379acec591dad19df3cde26e63b93a8e704f1dade7a3',
        publicKey: '8c8a13df77a28f3445213a0f432fde644acaa215fc72dcdf300d5efaa85d350c',
      },
      {
        path: "m/0'/1'",
        chainCode: 'a320425f77d1b5c2505a6b1b27382b37368ee640e3557c315416801243552f14',
        key: 'b1d0bad404bf35da785a64ca1ac54b2617211d2777696fbffaf208f746ae84f2',
        publicKey: '1932a5270f335bed617d5b935c80aedb1a35bd9fc1e31acafd5372c30f5c1187',
      },
      {
        path: "m/0'/1'/2'",
        chainCode: '2e69929e00b5ab250f49c3fb1c12f252de4fed2c1db88387094a0f8c4c9ccd6c',
        key: '92a5b23c0b8a99e37d07df3fb9966917f5d06e02ddbd909c7e184371463e9fc9',
        publicKey: 'ae98736566d30ed0e9d2f4486a64bc95740d89c7db33f52121f8ea8f76ff0fc1',
      },
      {
        path: "m/0'/1'/2'/2'",
        chainCode: '8f6d87f93d750e0efccda017d662a1b31a266e4a6f5993b15f5c1f07f74dd5cc',
        key: '30d1dc7e5fc04c31219ab25a27ae00b50f6fd66622f6e9c913253d6511d1e662',
        publicKey: '8abae2d66361c879b900d204ad2cc4984fa2aa344dd7ddc46007329ac76c429c',
      },
      {
        path: "m/0'/1'/2'/2'/1000000000'",
        chainCode: '68789923a0cac2cd5a29172a475fe9e0fb14cd6adb5ad98a3fa70333e7afa230',
        key: '8f94d394a8e8fd6b1bc2f3f49f5c47e385281d5c17e65324b0f62483e37e8793',
        publicKey: '3c24da049451555d51a7014a37337aa4e12d41e485abccfa46b47dfb2af54b7a',
      },
    ];
    const keyNode = getMasterKeyFromSeed(seed);
    const node = new EdNode(keyNode);
    it('should derive master key from seed', () => {
      expect(keyNode).to.deep.equal(
        {
          chainKey: '2b4be7f19ee27bbf30c667b642d5f4aa69fd169872f8fc3059c08ebae2eb19e7',
          chainCode: '90046a93de5380a72b5e45010748567d5ea02bbf6522f979e05c0d8d8ca9fffb',
        }
      );
    });
    vectors.forEach(vector => {
      it(`should be valid for ${vector.path}`, async () => {
        const childNode = node.derive(vector.path);
        expect(await childNode.getPublicKey()).to.equal(vector.publicKey);
      });
    });
  });

  describe('Message signing and verification', () => {
    it('Should verify a ed25519 signature it just created', async () => {
      const keyNode = getMasterKeyFromSeed(PRIVATE_KEY);
      const node = new EdNode(keyNode);
      const message = bytes.fromUTF8String('hello');
      const signature = await node.sign(message);
      const isValid = await verify(signature, message, await node.getPublicKey());
      // eslint-disable-next-line no-unused-expressions
      expect(isValid).to.be.true;
    });

    // https://datatracker.ietf.org/doc/html/rfc8032#section-7.1
    const vectors = [
      {
        secret: '9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60',
        publicKey: 'd75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a',
        message: bytes.fromUTF8String(''),
        signature: 'e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e065224901555fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b',
      },
      {
        secret: '4ccd089b28ff96da9db6c346ec114e0f5b8a319f35aba624da8cf6ed4fb8a6fb',
        publicKey: '3d4017c3e843895a92b70aa74d1b7ebc9c982ccf2ec4968cc0cd55f12af4660c',
        message: '72',
        signature: '92a009a9f0d4cab8720e820b5f642540a2b27b5416503f8fb3762223ebdb69da085ac1e43e15996e458f3613d0f11d8c387b2eaeb4302aeeb00d291612bb0c00',
      },
      {
        secret: 'c5aa8df43f9f837bedb7442f31dcb7b166d38535076f094b85ce3a2e0b4458f7',
        publicKey: 'fc51cd8e6218a1a38da47ed00230f0580816ed13ba3303ac5deb911548908025',
        message: 'af82',
        signature: '6291d657deec24024827e69c3abe01a30ce548a284743a445e3680d7db5ac3ac18ff9b538d16f290ae67f760984dc6594a7c15e9716ed28dc027beceea1ec40a',
      },
    ];
    it('Should generate ed25519 signatures matching rfc8032 test vectors', async () => {
      const signatures = await Promise.all(vectors.map(async (vector) => {
        const node = new EdNode({ chainKey: vector.secret, chainCode: vector.publicKey });
        return bytes.hexlify(await node.sign(vector.message));
      }));
      for (let i = 0; i < vectors.length; i += 1) {
        expect(signatures[i]).to.equal(vectors[i].signature);
      }
    });
  });
});
