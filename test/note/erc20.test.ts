/* globals describe it */
import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { hexToBytes } from 'ethereum-cryptography/utils';
import { Note } from '../../src/note';
import { ByteLength, hexlify, hexToBigInt, nToHex } from '../../src/utils/bytes';

chai.use(chaiAsPromised);
const { expect } = chai;

const vectors = [
  {
    note: {
      npk: '23da85e72baa8d77f476a893de0964ce1ec2957d056b591a19d05bb4b9a549ed',
      token: '0000000000000000000000007f4925cdf66ddf5b88016df1fe915e68eff8f192',
      value: '0000000000000000086aa1ade61ccb53',
      encryptedRandom: [
        '0x5c4a783fd15546fbad149c673b7139790a9cf62ec849a5a8e6a167815ee2d08d',
        '0x260693ec8dd38f5be7758b6786bc579e',
      ] as [string, string],
    },
    pubkey: '9902564685f24f396263c64f582aa9a87499704509c60862930b1f9f7d258e8e',
    random: '85b08a7cd73ee433072f1d410aeb4801',
    vpk: '0b252eea1d78ff7b2ad19ea161dfe380686a099f9713719d2eff85196a607685',
    hash: '29decce78b2f43c718ebb7c6825617ea6881836d88d9551dd2530c44f0d790c5',
  },
  {
    note: {
      npk: '0bb21912817ea606faf03c0c3d62b37f75be41daee5e784a6f5db9b4f6591bdb',
      token: '000000000000000000000000df0fa4124c8a5feec8efcb0e0142d3e04a9e0fbf',
      value: '000000000000000007cf6b5ae17ae75a',
      encryptedRandom: [
        '0xf401e001c520b9f40d37736c0ef2309fa9b2dc97bf1634ac1443fc2fe5359f69',
        '0x093481f1f6ab744d9f937e6ec796e300',
      ] as [string, string],
    },
    pubkey: 'ab017ebda8fae25c92ecfc38f219c0ed1f73538bc9dc8e5db8ae46f3b00d5a2f',
    random: 'f7c477afb5a3eb31dbb96295cdbcf165',
    vpk: '0a13664024e298e53bf01342e2111ae314f9595b12107e85cf0066e4b04cb3a3',
    hash: '0e824f1adbccbecf4cf25fd1eb3f3f0f528a3c7b16d94abcd43f39203f141114',
  },
  {
    note: {
      npk: '233845eec9a6b6c4d9a40117d54130e9a912d834eedbf819af31782878bb6256',
      token: '00000000000000000000000034e34b5d8e848f9d20d9bd8e1e48e24c3b87c396',
      value: '00000000000000000b9df0087cbbd709',
      encryptedRandom: [
        '0x4b0b63e8f573bf29cabc8e840c5db89892c0acc3f30bbdf6ad9d39ac9485fa49',
        '0xcbfb4c84c0669aaf184a621c9d21e9ae',
      ] as [string, string],
    },
    pubkey: '4704ae101848ca47a6734d0e9210a5ecc204b97541fa1b808e5551319b49ec24',
    random: '6d8a7e26de6b0638cd092c2a2b524705',
    vpk: '099ba7ffc589df18402385d7c0d4771555dffd2a6514fc136c565ea1ee3bb520',
    hash: '10566093adb9dd8975565f6ab76fa1c0487e484a9d7f14b7f412baa6aae38e78',
  },
  {
    note: {
      npk: '25d40e7f08d6fa7698f389f9654e54895f60fa4f7b54ce0b4e3e1ba7172738b0',
      token: '0000000000000000000000009b71cad96341485290d3f1376fb9e969a632694d',
      value: '00000000000000000ac76747c40dda3a',
      encryptedRandom: [
        '0xe9abf13a310d1910d3010a1cf8b5c03a50c228f1fe81de21734479398973ec77',
        '0x00b0994bd02746fc55c1ff8c75aeb285',
      ] as [string, string],
    },
    pubkey: 'bd0f57ea13604d47c9080859ee96d010496cccbfed2ca2062ee3e2d0fcd24e9e',
    random: 'f13666966cffa395e3d412ea4e20480f',
    vpk: '0c78af78aea7d17b6d9d57fedede59f83c782b562542f9f4ed0900f18d034103',
    hash: '2a1d708830b4a5511d51494aefc267f9751b06c0564b50d6ea26b0d074e21dd6',
  },
  {
    note: {
      npk: '251a55948f8127b1d4f1f50c24a7889efda01dd968055a1e4cde3e9a1706ab8b',
      token: '00000000000000000000000089d21609e4ea344c576d1692ceca0f0e0bf4b771',
      value: '00000000000000000475d82f700206b8',
      encryptedRandom: [
        '0x7462849ef8b7bdbb9deeae7983f84334d934d129bd7a7e926bd87b6cf0053e0d',
        '0xda7cd10423b3d1e48bb7dd47062ac632',
      ] as [string, string],
    },
    pubkey: 'd7091b2e84b3fcbe1a688b9e08bf45850a1e8ff0f7e2de19971a6d871ae8a186',
    random: '0bf6750e00739619a1a00f9b8f1bc2be',
    vpk: '0fc2d4688b94afa262226b601dd3f9fe955a2bd7310ac01f02e8d1a62e35c0a1',
    hash: '2df1c5c14956abff75f0a5e7154c5d6ae1f536e66dab0a914eff63278922fdb9',
  },
  {
    note: {
      npk: '0e47233036d5a9d5762b3c619d648f77bb6ae78c5897474a08fc221ff1d23abc',
      token: '0000000000000000000000006f2870a30f4ff19f073fe894d6fe881f0c04657f',
      value: '000000000000000003426801bd08640b',
      encryptedRandom: [
        '0xe501c3195c8a4cc2134ed19d69ba1208a4c7f4ef6f33c2c5e51655f919d4855e',
        '0xe533c677c5fa66c511a70125edfcd2ac',
      ] as [string, string],
    },
    pubkey: 'fd13f6d7000238c3de83582583f3654a1f14de55143191b89415e35ae2abdf90',
    random: 'd8c0caf1b041611d408b5f01e7eae957',
    vpk: '0b49b73e4c7c184aff7c99af820be7f8a32a602724f58abbfef38494931e5405',
    hash: '09d5b24f0a7577094483d8a7079577a084a41a4dfc41ca435006c903d11104ad',
  },
  {
    note: {
      npk: '1c22a5df62aece44424c3044b6069397ee02933478a1be1c3c1dbde7c3283095',
      token: '0000000000000000000000004224904029a556a7cd0bc78d81b165c391fffb45',
      value: '000000000000000003449e13312815a6',
      encryptedRandom: [
        '0x1bef951429c37eaa69190cb635591d122ffe959d690366876e9f1704aa37bb18',
        '0x8ae56f06a6fe0c39b47f8b28c178f3e0',
      ] as [string, string],
    },
    pubkey: '13e865e8f6160ce58efaf5b2f53facb4b5f16249b0411951e8f7e12a3d95d694',
    random: '44a514b4db4659e8520d570f3252c0cf',
    vpk: '0f6344893b62deb6c83178aa6883192941eae50eb8eec2854ad0c942b4a2a241',
    hash: '02758876c0d757f4eea1a0326d665aab0e79928944668a3e2859c24c191d4103',
  },
  {
    note: {
      npk: '2097ccb284370aad7fae52669f84e1466b0fd00f79c02b18e9ed8b61866d0424',
      token: '000000000000000000000000480bdc4d52df318db7b458b171540a936dc39a07',
      value: '000000000000000008d210fd771f72ab',
      encryptedRandom: [
        '0x789ee74fc10fd3b8daac3846b307d7d20db76ca9d5b6894c78f58b2ebc0303e4',
        '0x35a7d7e3b7c178dbf3ff6c985bceeee6',
      ] as [string, string],
    },
    pubkey: 'bda28a024a0b77ba51e89b17e7b8d221b2e7c1a818c8e53c78cdc3a8479807a4',
    random: '77c31ed0577a986750c8dce8804af5b9',
    vpk: '08baacccf37c1de3edc6e0a0270d8f999b9d7ed5ea7dbae68015b0dade2d5d65',
    hash: '2d313ce6f0a6df48593e63d162498844a47a55fa87f0e52d5ac164b8a32a784a',
  },
  {
    note: {
      npk: '1f477464f3c896c4cf74d66019f2dffb27d825c1d38800b671f96a52772f22ee',
      token: '0000000000000000000000008afe4263f81c6d01cb6ea2548132a82d4c5b16e8',
      value: '0000000000000000060c736c94f022c6',
      encryptedRandom: [
        '0x82df79ed67267bd528f0302a95129bbb56d04fab22f95af35b03d2c07ac75737',
        '0x273588a6fab60d09b7f4155e2bf4aded',
      ] as [string, string],
    },
    pubkey: '6a26fe361ff14ef4c931c82acc8c772d5a349a4d1af75bff27dde944ec713b27',
    random: '6478eea9c496942f0f25967c11fc4bbd',
    vpk: '08abd3c723fd7fc91b183a32a48205acd6cecb452d36d23a9273fc46f22abe60',
    hash: '2021b396f1156286e58957f6e5738e5e9888d801e7a8a2f869fdcf35d3226bee',
  },
  {
    note: {
      npk: '013a628aa76f883a6546a963424eb561d4d3221317d29d7f4a67236fe95aec61',
      token: '0000000000000000000000004f53cbc84f501847cf42bd9fb14d63be21dcffc8',
      value: '0000000000000000005589f7d39c59bf',
      encryptedRandom: [
        '0x4732f678e893c09c6393be8f8fcc5eee1d9a1078a16151dcae2d65f2d78edc4b',
        '0xc675ab6de72d03033cf0bafaa0391b2e',
      ] as [string, string],
    },
    pubkey: 'c103873aa9d88c4c4cbc4cac97f7b57d01ab3587500c1d1c90fe3991b1dab882',
    random: '2e16e1cdda5f94ddb9981d3811924b05',
    vpk: '092547b5af1fa658e03433596910f8ea42419998b61f09f55b3cd1c85a7da620',
    hash: '216c3c6cffd63e12c3f65235845b833f56e1c82ea33cdb384397897b982d1c68',
  },
];

const ciphertextVectors = [
  {
    note: {
      pubkey: '6595f9a971c7471695948a445aedcbb9d624a325dbe68c228dea25eccf61919d',
      random: '85b08a7cd73ee433072f1d410aeb4801',
      amount: '000000000000000000000000000000000000000000000000086aa1ade61ccb53',
      token:
        '0000000000000000000000000000000000000000000000007f4925cdf66ddf5b88016df1fe915e68eff8f192',
    },
    sharedKey: 'b8b0ee90e05cec44880f1af4d20506265f44684eb3b6a4327bcf811244dc0a7f',
    ciphertext: {
      iv: '0x5f8c104eec6e72996078ca3149a153c0',
      tag: '0xb1959596279a0c3bd9ec7e16f2fad8c6',
      data: [
        'ed60c5dc0304f63e6e201e2311467bd112b90224dfd523eeaafd2e59b66198c0',
        '3f67deea78b30df94e415d01296aee9e84f30a13',
        '09c6e5e8efc57491911d2d5b36acb6d585b1d784185a5ac0b0bba1ece3a68c36',
      ],
    },
  },
  {
    note: {
      pubkey: 'ab017ebda8fae25c92ecfc38f219c0ed1f73538bc9dc8e5db8ae46f3b00d5a2f',
      random: 'f7c477afb5a3eb31dbb96295cdbcf165',
      amount: '00000000000000000000000000000000000000000000000007cf6b5ae17ae75a',
      token:
        '000000000000000000000000000000000000000000000000df0fa4124c8a5feec8efcb0e0142d3e04a9e0fbf',
    },
    sharedKey: 'c8c2a74bacf6ce3158069f81202d8c2d81fd25d226d7536f26442888c014a755',
    ciphertext: {
      iv: '0xf5bab8e512e9f729f65f21369a86db56',
      tag: '0xa800eff5cfbe3b6bb0523057957e105b',
      data: [
        '3410be7a6027e32e6ff52e46cbef9b22492329a8e9cd3a9c4e39e421280c1c62',
        'e49b63bc7de8973064b43cd556d3c9d975eafa35',
        'bc8ab045ae8452b79881b1bc201ef85bc6a24ddd6b646710e27e663a751335bd',
      ],
    },
  },
  {
    note: {
      pubkey: '4704ae101848ca47a6734d0e9210a5ecc204b97541fa1b808e5551319b49ec24',
      random: '6d8a7e26de6b0638cd092c2a2b524705',
      amount: '0000000000000000000000000000000000000000000000000b9df0087cbbd709',
      token:
        '00000000000000000000000000000000000000000000000034e34b5d8e848f9d20d9bd8e1e48e24c3b87c396',
    },
    sharedKey: '4676adb24e597086894880767f274818f711233eda9d617b348bb1cf92dd35e5',
    ciphertext: {
      iv: '0xb9a10ed717b6102d8943bdf0190947f4',
      tag: '0x20f0fa2bb52614c833076b6dd2dbe40f',
      data: [
        'd0e4bd3f27ac20e748cd799125bff35c3e6e7222c838931f2d7fe7093d387fb2',
        '56b67175b0f447c630c2603db983612eb21dcd9b',
        'd73a3634b0b1bdcefdbdb870b7b05bb6dda74f207bd90932655434c2a9dbf677',
      ],
    },
  },
];

describe('Note/ERC20', () => {
  it('Should encrypt and decrypt notes', () => {
    ciphertextVectors.forEach((vector) => {
      const viewingPublicKey = hexToBytes(vector.note.pubkey);

      // Create Note object
      const address = {
        masterPublicKey: hexToBigInt(vector.note.pubkey),
        viewingPublicKey,
      };
      const note = new Note(
        address,
        vector.note.random,
        hexToBigInt(vector.note.amount),
        vector.note.token,
      );

      const sharedKeyBytes = hexToBytes(vector.sharedKey);

      // Get encrypted values
      const encrypted = note.encrypt(sharedKeyBytes);

      // Check if encrypted values are successfully decrypted
      const decrypted = Note.decrypt(encrypted, sharedKeyBytes);
      expect(decrypted.token).to.equal(note.token);
      expect(decrypted.value).to.equal(note.value);
      expect(decrypted.random).to.equal(note.random);
      expect(decrypted.hash).to.equal(note.hash);

      // Check if vector encrypted values are successfully decrypted
      const decryptedFromCiphertext = Note.decrypt(vector.ciphertext, sharedKeyBytes);
      expect(decryptedFromCiphertext.token).to.equal(note.token);
      expect(decryptedFromCiphertext.value).to.equal(note.value);
      expect(decryptedFromCiphertext.valueHex).to.equal(nToHex(note.value, ByteLength.UINT_128));
      expect(decryptedFromCiphertext.random).to.equal(note.random);
      expect(decryptedFromCiphertext.hash).to.equal(note.hash);
      expect(decryptedFromCiphertext.masterPublicKey).to.equal(address.masterPublicKey);
      expect(decryptedFromCiphertext.viewingPublicKey).to.deep.equal(new Uint8Array());
    });
  });

  it('Should serialize and deserialize notes', () => {
    vectors.forEach((vector) => {
      const address = {
        masterPublicKey: hexToBigInt(vector.pubkey),
        viewingPublicKey: hexToBytes(vector.pubkey),
      };
      const vectorBytes = hexToBytes(vector.vpk);
      const note = Note.deserialize(vector.note, vectorBytes, address);
      expect(hexlify(note.random)).to.equal(vector.random);

      const hexHash = nToHex(note.hash, ByteLength.UINT_256);
      expect(hexHash).to.equal(vector.hash);

      const reserialized = note.serialize(vectorBytes);

      expect(reserialized.encryptedRandom).not.to.equal(vector.note.encryptedRandom);
      expect(reserialized.npk).to.equal(vector.note.npk);
      expect(reserialized.value).to.equal(vector.note.value);
      expect(reserialized.token).to.equal(vector.note.token);

      const serializedContract = note.serialize(vectorBytes, true);
      expect(serializedContract.npk).to.equal(`0x${vector.note.npk}`);
      expect(serializedContract.value).to.equal(`0x${vector.note.value}`);
      expect(serializedContract.token).to.equal(`0x${vector.note.token}`);
    });
  });

  it('Should calculate nullifiers', () => {
    // TODO-VECTORS: Vector needs confirming.
    const nullifierVectors = [
      {
        privateKey: '08ad9143ae793cdfe94b77e4e52bc4e9f13666966cffa395e3d412ea4e20480f',
        tree: 0,
        position: 0,
        nullifier: '03f68801f3ee2ed10178c162b4f7f1bd466bc9718f4f98175fc04934c5caba6e',
      },
      {
        privateKey: '11299eb10424d82de500a440a2874d12f7c477afb5a3eb31dbb96295cdbcf165',
        tree: 1,
        position: 12,
        nullifier: '1aeadb64bf8faff93dfe26bcf0b2e2d0e9724293cc7a455f028b6accabee13b8',
      },
      {
        privateKey: '09b57736523cda7412ddfed0d2f1f4a86d8a7e26de6b0638cd092c2a2b524705',
        tree: 14,
        position: 6500,
        nullifier: '091961ce11c244db49a25668e57dfa2b5ffb1fe63055dd64a14af6f2be58b0e7',
      },
    ];

    const v = nullifierVectors[0];
    expect(Note.getNullifier(hexToBigInt(v.privateKey), v.position)).to.be.a('bigint');
    nullifierVectors.forEach((vector) => {
      const nullifier = Note.getNullifier(hexToBigInt(vector.privateKey), vector.position);
      const hexNullifier = nToHex(nullifier, ByteLength.UINT_256);
      expect(hexNullifier).to.equal(vector.nullifier);
    });
  });
});
