/* globals describe it */
import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';

import Note from '../../src/note';

chai.use(chaiAsPromised);
const { expect } = chai;

const vectors = [
  {
    publicKey: '9902564685f24f396263c64f582aa9a87499704509c60862930b1f9f7d258e8e',
    random: '1bcfa32dbb44dc6a26712bc500b6373885b08a7cd73ee433072f1d410aeb4801',
    amount: '086aa1ade61ccb53',
    token: '0abb1e400bf30a007f88f8397f4925cdf66ddf5b88016df1fe915e68eff8f192',
    hash: '231f94d52bff58ff11f4696edce19898cc48ba0f397e04c2d2bd28630ab7954a',
  },
  {
    publicKey: 'ab017ebda8fae25c92ecfc38f219c0ed1f73538bc9dc8e5db8ae46f3b00d5a2f',
    random: '11299eb10424d82de500a440a2874d12f7c477afb5a3eb31dbb96295cdbcf165',
    amount: '07cf6b5ae17ae75a',
    token: '185554f7a3ae417e737ff9b8df0fa4124c8a5feec8efcb0e0142d3e04a9e0fbf',
    hash: '132d4842b6ad1eaa669e61604c2b36c3a2f5a17a6e1753a26a47d2b94e270595',
  },
  {
    publicKey: '4704ae101848ca47a6734d0e9210a5ecc204b97541fa1b808e5551319b49ec24',
    random: '09b57736523cda7412ddfed0d2f1f4a86d8a7e26de6b0638cd092c2a2b524705',
    amount: '0b9df0087cbbd709',
    token: '1f8b716d50891becf4aa076834e34b5d8e848f9d20d9bd8e1e48e24c3b87c396',
    hash: '056bb83a991ce564fa500dd8635c6ab5ff3269d2908dad2b122bc00c9b03b624',
  },
  {
    publicKey: 'bd0f57ea13604d47c9080859ee96d010496cccbfed2ca2062ee3e2d0fcd24e9e',
    random: '08ad9143ae793cdfe94b77e4e52bc4e9f13666966cffa395e3d412ea4e20480f',
    amount: '0ac76747c40dda3a',
    token: '2a744bd350edd1c8efa902869b71cad96341485290d3f1376fb9e969a632694d',
    hash: '052bcf0370a65ba61d715ba34f59a39f927cca424811bc153e7bc1a5b44fc047',
  },
  {
    publicKey: 'd7091b2e84b3fcbe1a688b9e08bf45850a1e8ff0f7e2de19971a6d871ae8a186',
    random: '0c7b2d318b053d48861c471a8e315fb00bf6750e00739619a1a00f9b8f1bc2be',
    amount: '0475d82f700206b8',
    token: '11896f34b35e2f57ec1ed8cd89d21609e4ea344c576d1692ceca0f0e0bf4b771',
    hash: '0b932f85d8096a9d0fcfcb2d44aeddf8a5fc73342c53bfa147410ec93c04bbc9',
  },
  {
    publicKey: 'fd13f6d7000238c3de83582583f3654a1f14de55143191b89415e35ae2abdf90',
    random: '0584766b6f58473469f22176e4c61526d8c0caf1b041611d408b5f01e7eae957',
    amount: '03426801bd08640b',
    token: '220d181cca15ce9baa254fcf6f2870a30f4ff19f073fe894d6fe881f0c04657f',
    hash: '2bafcb0d7d7287be0d0b7b5dca51836c9275b2999cc874c70fcf20ed975b447b',
  },
  {
    publicKey: '13e865e8f6160ce58efaf5b2f53facb4b5f16249b0411951e8f7e12a3d95d694',
    random: '2c14f33de99b1ffe04826a066ff9cb0f44a514b4db4659e8520d570f3252c0cf',
    amount: '03449e13312815a6',
    token: '277bff68ddcbe825b2be58304224904029a556a7cd0bc78d81b165c391fffb45',
    hash: '1c2c9cf373cdc0091808ce89e179cf0db9bbc686e19f2ec8018e2e823bcebdac',
  },
  {
    publicKey: 'bda28a024a0b77ba51e89b17e7b8d221b2e7c1a818c8e53c78cdc3a8479807a4',
    random: '1e686e7506b0f4f21d6991b4cb58d39e77c31ed0577a986750c8dce8804af5b9',
    amount: '08d210fd771f72ab',
    token: '07d44e2b739c631be1a97fb3480bdc4d52df318db7b458b171540a936dc39a07',
    hash: '0a0461173aaabcd2e51c17d68b6da2cd2b51025d0945f802115123e04dbd4ff2',
  },
  {
    publicKey: '6a26fe361ff14ef4c931c82acc8c772d5a349a4d1af75bff27dde944ec713b27',
    random: '1d629e459c9d76866be24dc759449eb86478eea9c496942f0f25967c11fc4bbd',
    amount: '060c736c94f022c6',
    token: '0b345a709460bcab68c2d96f8afe4263f81c6d01cb6ea2548132a82d4c5b16e8',
    hash: '1bdde22dfcf22625f302215534590af349ad9a0fa729e7b754efd8e5b6641235',
  },
  {
    publicKey: 'c103873aa9d88c4c4cbc4cac97f7b57d01ab3587500c1d1c90fe3991b1dab882',
    random: '15af83f1c32852bd5f714bb9176a14622e16e1cdda5f94ddb9981d3811924b05',
    amount: '5589f7d39c59bf',
    token: '21543ad39bf8f7649d6325e44f53cbc84f501847cf42bd9fb14d63be21dcffc8',
    hash: '1b4c2090af5aa218064c9ccdd6c43b3d7eb5712decf3ed03a29f3e7061a7fa64',
  },
];

describe('Note/ERC20', () => {
  it('Should calculate hashes', () => {
    vectors.forEach((vector) => {
      expect((new Note.ERC20(
        vector.publicKey,
        vector.random,
        vector.amount,
        vector.token,
      )).hash).to.equal(vector.hash);
    });
  });

  it('Should encrypt and decrypt notes', () => {
    const ciphertextVectors = [
      {
        note: {
          publicKey: '6595f9a971c7471695948a445aedcbb9d624a325dbe68c228dea25eccf61919d',
          random: '1bcfa32dbb44dc6a26712bc500b6373885b08a7cd73ee433072f1d410aeb4801',
          amount: '000000000000000000000000000000000000000000000000086aa1ade61ccb53',
          token: '0abb1e400bf30a007f88f8397f4925cdf66ddf5b88016df1fe915e68eff8f192',
        },
        sharedKey: 'b8b0ee90e05cec44880f1af4d20506265f44684eb3b6a4327bcf811244dc0a7f',
        ciphertext: {
          iv: '9bff65f581092eb6df41cdcab156fabf',
          data: [
            '7d4e5e41a6bbed46972effc57abd5c6e59398d8bd6850c72411b8e6fc7c69880',
            '3911ea03dece430aef72485837df8acb263cad7c429d6fc596bdbf59aaeda588',
            '822acca386aca823b08eca93351841722a81e9bbae71d381b6f015a0e2421a31',
            '4687459afd041f1b0ee8caad50cdd0ebc50805172e2b46fb526eb89bb782a428',
            'f9eff627caffd1e4f1eb61428681ca2ef58cdee02984c2401ae58d2c90d57774',
          ],
        },
      },
      {
        note: {
          publicKey: 'ab017ebda8fae25c92ecfc38f219c0ed1f73538bc9dc8e5db8ae46f3b00d5a2f',
          random: '11299eb10424d82de500a440a2874d12f7c477afb5a3eb31dbb96295cdbcf165',
          amount: '00000000000000000000000000000000000000000000000007cf6b5ae17ae75a',
          token: '185554f7a3ae417e737ff9b8df0fa4124c8a5feec8efcb0e0142d3e04a9e0fbf',
        },
        sharedKey: 'c8c2a74bacf6ce3158069f81202d8c2d81fd25d226d7536f26442888c014a755',
        ciphertext: {
          iv: 'b0e4c3c696d34d95caa9c707716330a0',
          data: [
            '8196d2e3b35e3994e1aceb52b0bb12ee7e10822da17855dff1202d70bec731ca',
            '4a9dd245ce55463ab3bfdd3f107639c5d1c12c4ee96cc5affc25ac6d7defe85f',
            '2ca7c87aa6bbc849c2507259a7b3adcf8b9942cfc17630376111dca7d7167adf',
            'cb310c79d47660a0f375d8d04113b7c33a96fbb2c7ae3570f47d882f3efb948c',
            'e82e2e29d6f23f0a7bb47dad4b34d24411ae2cf730db3c2ed78b22df250ce474',
          ],
        },
      },
      {
        note: {
          publicKey: '4704ae101848ca47a6734d0e9210a5ecc204b97541fa1b808e5551319b49ec24',
          random: '09b57736523cda7412ddfed0d2f1f4a86d8a7e26de6b0638cd092c2a2b524705',
          amount: '0000000000000000000000000000000000000000000000000b9df0087cbbd709',
          token: '1f8b716d50891becf4aa076834e34b5d8e848f9d20d9bd8e1e48e24c3b87c396',
        },
        sharedKey: '4676adb24e597086894880767f274818f711233eda9d617b348bb1cf92dd35e5',
        ciphertext: {
          iv: 'e35746546e5c4e7807207ccdf0809b9f',
          data: [
            'e002a7581977c8f57732b03157934125f036da2002aac23f58c1d05dc6e06180',
            '908e5a4bcab9217b1a2d9ba5a472697e5a3b12133e3cd34b88841d5685b0e11e',
            '53f7d48e6ded5f572216f4094ac70901f0e68f053f61292a32b10e0613a13292',
            'd5d2341fac616e04504f784db3b75da430983dcafaf771d13b9609a35cd1e70b',
            '7d093849907b4d49848b40ba8342c023eb4cea41974b7cb2605e2322442f8208',
          ],
        },
      },
    ];

    ciphertextVectors.forEach((vector) => {
      // Create Note object
      const note = new Note.ERC20(
        vector.note.publicKey,
        vector.note.random,
        vector.note.amount,
        vector.note.token,
      );

      // Get encrypted values
      const encrypted = note.encrypt(vector.sharedKey);

      // Check if encrypted values are successfully decrypted
      expect(Note.ERC20.decrypt(encrypted, vector.sharedKey)).to.deep.equal(note);

      // Check if vector encrypted values are successfully decrypted
      expect(Note.ERC20.decrypt(vector.ciphertext, vector.sharedKey)).to.deep.equal(note);
    });
  });

  it('Should serialize and deserialize notes', () => {
    vectors.forEach((vector) => {
      const note = Note.ERC20.deserialize(vector);

      expect(note.hash).to.equal(vector.hash);

      const serialized = note.serialize();
      const serializedContract = note.serialize(true);

      expect(serialized.publicKey).to.equal(vector.publicKey);
      expect(serialized.random).to.equal(vector.random);
      expect(serialized.amount).to.equal(vector.amount);
      expect(serialized.token).to.equal(vector.token);

      expect(serializedContract.publicKey).to.equal(`0x${vector.publicKey}`);
      expect(serializedContract.random).to.equal(`0x${vector.random}`);
      expect(serializedContract.amount).to.equal(`0x${vector.amount}`);
      expect(serializedContract.token).to.equal(`0x${vector.token}`);
    });
  });
});
