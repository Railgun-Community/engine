/* globals describe it */
import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';

import { encryption } from '../../src/utils';

chai.use(chaiAsPromised);
const { expect } = chai;

describe('Utils/Encryption', () => {
  it('Should encrypt/decrypt with AES-256-CTR', () => {
    const vectors = [
      {
        key: 'a95433e0a93259cc4cbb58f3d2e2a415cd8c6934615502c787a1b0d6a5f38708',
        iv: 'ba431ed849a46cd51b2f1394f9100f81',
        data: [
          'e9f27dd3df8ffaf814f8451f913820b4e182cd5f712789d5f05d3f34fe216a6f',
          '454ee7f77ca89a594861b83b2fe559732d2f090a941fd67f7dfca5e8aadce3e2',
          '64c55002ea7df05e764da19984c2f294a4a5f9c3cda028a560a95f7a895a5203',
        ],
        encrypted: [
          'd58f5cc931a85f65834d9f39a010492162ab4b64aa60fce8e662379084fefc97',
          '6384f3e35d35430fba11c83a6f9dc7889fb29dbf1ec17788b0eba500aa7e9819',
          'a2c384e67ddafe471f67585b9ed82987609024e550abd8639cc6aaf6c5e31492',
        ],
      },
      {
        key: '3e358efa6d58826fe4554fc615289c57ef615edd1ff41e2f05b90127de436b37',
        iv: 'ba431ed849a46cd51b2f1394f9100f81',
        data: [
          '2156755fc876ab4323b02ff680c777fa7e6407fb6843244c6e030a9c20962061',
          '149b2315bb060ceab37c5d490badce46d682017c8234869f59d57829bf221cf5',
        ],
        encrypted: [
          '9a785f099846d15ac9991e78ec8385669bb1b19ad9993e63b52330216a72bf50',
          '6c9b52ede22753f578d2ae36b1f83c43082b376e2f0e92abaa528be6f30257bc',
        ],
      },
      {
        key: '716a1935958ba30b3cdf83dc0df2d14449b8b301b45cfdd05440f37026691cf9',
        iv: 'ba431ed849a46cd51b2f1394f9100f81',
        data: [
          '66afe2d31558fa7d88bf5a17ee3d14d1350d1d2e51f2b78a4b81356e6aeb0010',
          '72ea27b82a44554b43f2b710db48edec8eee2bc490998c5f8f6e76d6a2d9a58c',
          'f6bbd237f8cb2c6a4e4262be02f7569ab6170108d3a127432edccb505c7a5202',
          '4a7620454beec9c5ab3e8962bfbfd72c78ed8c1a5ae66dd0575f021b07a7d335',
          'cfe38db0b90903b39fe8ffc7d82e09a9e8388442b76d45c8e89a5a3e8a662a90',
          'e68a91618407b124ef017d062f34c117e33d2ef688370f9a821dd9bd90ed4271',
          '3a992a21e8f7aade57a4f64d997ea36f14d7fcff68fa9062e29dae6ca7c15baa',
          '4f828642d4422a3e89ff4404fb8994985256098518231f62998a0d972bcb5ecd',
        ],
        encrypted: [
          '44e12de61d5a2d4290313463b3bee20a2ea8d4d1751b415aa086afa122da1c8d',
          '219bda94e6af4539a48d831ac617e9dec7c5aa171f33298c4f28354788ecb29b',
          '0cbf46e145dc2e565edb4ac9c34950c1dde807a60cca5bd3c5a4cff72c2182cf',
          '731490174253a08191d831c755b5f607bedd6372ecb615fe131fc918a2f7ba3c',
          '2047d5e8120d3e6ebd4199691a90c840d2c2c24d9b970de90fe5080edcbeb9c2',
          '8ba9fa83d7c06994eaac04356ff5f3c631a2a8bccf30a3dab591b3b7b893023e',
          '6b9c957e05a741d58cc2b204693048cfeddd28ea3db438cecb7aab273e25ad98',
          '7789c6ce8361c0750197a384a36827915bc9650ae14f94783eb01c1b41fa7a26',
        ],
      },
    ];

    vectors.forEach((vector) => {
      // Test encryption returns correct ciphertext bundles
      expect(encryption.aes.ctr.encrypt(
        vector.data,
        vector.key,
        vector.iv,
      )).to.deep.equal({
        iv: vector.iv,
        data: vector.encrypted,
      });

      // Test decryption returns correct plaintext array
      expect(encryption.aes.ctr.decrypt(
        {
          iv: vector.iv,
          data: vector.encrypted,
        },
        vector.key,
      )).to.deep.equal(vector.data);

      // Test encryption with random generated IV is decrypted correctly
      const ciphertext = encryption.aes.ctr.encrypt(
        vector.data,
        vector.key,
      );

      expect(encryption.aes.ctr.decrypt(
        ciphertext,
        vector.key,
      )).to.deep.equal(vector.data);
    });
  });
});
