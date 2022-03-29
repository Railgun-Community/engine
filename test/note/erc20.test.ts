/* globals describe it */
import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';

import { ERC20Note } from '../../src/note';

chai.use(chaiAsPromised);
const { expect } = chai;

const vectors = [
  {
    pubkey: '9902564685f24f396263c64f582aa9a87499704509c60862930b1f9f7d258e8e',
    random: '1bcfa32dbb44dc6a26712bc500b6373885b08a7cd73ee433072f1d410aeb4801',
    amount: '000000000000000000000000000000000000000000000000086aa1ade61ccb53',
    token: '0000000000000000000000007f4925cdf66ddf5b88016df1fe915e68eff8f192',
    hash: 'b4b47ab2e634585b186772c51661619bccc02e2e7deedcb3fcc20c250f048f',
  },
  {
    pubkey: 'ab017ebda8fae25c92ecfc38f219c0ed1f73538bc9dc8e5db8ae46f3b00d5a2f',
    random: '11299eb10424d82de500a440a2874d12f7c477afb5a3eb31dbb96295cdbcf165',
    amount: '00000000000000000000000000000000000000000000000007cf6b5ae17ae75a',
    token: '000000000000000000000000df0fa4124c8a5feec8efcb0e0142d3e04a9e0fbf',
    hash: '1f1bdc65c7975beadca9261e8dd58f9ea97976056049d54d93f37fdfd2943fad',
  },
  {
    pubkey: '4704ae101848ca47a6734d0e9210a5ecc204b97541fa1b808e5551319b49ec24',
    random: '09b57736523cda7412ddfed0d2f1f4a86d8a7e26de6b0638cd092c2a2b524705',
    amount: '0000000000000000000000000000000000000000000000000b9df0087cbbd709',
    token: '00000000000000000000000034e34b5d8e848f9d20d9bd8e1e48e24c3b87c396',
    hash: '075bad311db015ceb616614b55a18fcf54f371b42cc7657f197251159636bf5d',
  },
  {
    pubkey: 'bd0f57ea13604d47c9080859ee96d010496cccbfed2ca2062ee3e2d0fcd24e9e',
    random: '08ad9143ae793cdfe94b77e4e52bc4e9f13666966cffa395e3d412ea4e20480f',
    amount: '0000000000000000000000000000000000000000000000000ac76747c40dda3a',
    token: '0000000000000000000000009b71cad96341485290d3f1376fb9e969a632694d',
    hash: '22a1515f97c6c730695d43d3a6f05a669d240789a4886689230d638ee4a38bef',
  },
  {
    pubkey: 'd7091b2e84b3fcbe1a688b9e08bf45850a1e8ff0f7e2de19971a6d871ae8a186',
    random: '0c7b2d318b053d48861c471a8e315fb00bf6750e00739619a1a00f9b8f1bc2be',
    amount: '0000000000000000000000000000000000000000000000000475d82f700206b8',
    token: '00000000000000000000000089d21609e4ea344c576d1692ceca0f0e0bf4b771',
    hash: '1356a07aebe2181c6c6100e2bf831ad2f56dbdd4a3b182a0d2d0dadd2915226a',
  },
  {
    pubkey: 'fd13f6d7000238c3de83582583f3654a1f14de55143191b89415e35ae2abdf90',
    random: '0584766b6f58473469f22176e4c61526d8c0caf1b041611d408b5f01e7eae957',
    amount: '00000000000000000000000000000000000000000000000003426801bd08640b',
    token: '0000000000000000000000006f2870a30f4ff19f073fe894d6fe881f0c04657f',
    hash: '1f23b3246d242d2ff339a124f7ae4629ff7dc30a0dead309a99f4ca036eb6844',
  },
  {
    pubkey: '13e865e8f6160ce58efaf5b2f53facb4b5f16249b0411951e8f7e12a3d95d694',
    random: '2c14f33de99b1ffe04826a066ff9cb0f44a514b4db4659e8520d570f3252c0cf',
    amount: '00000000000000000000000000000000000000000000000003449e13312815a6',
    token: '0000000000000000000000004224904029a556a7cd0bc78d81b165c391fffb45',
    hash: '0998abf52255ebd5de4152d1f86734c43fc29b1696b88446ff8693bbf1a4a124',
  },
  {
    pubkey: 'bda28a024a0b77ba51e89b17e7b8d221b2e7c1a818c8e53c78cdc3a8479807a4',
    random: '1e686e7506b0f4f21d6991b4cb58d39e77c31ed0577a986750c8dce8804af5b9',
    amount: '00000000000000000000000000000000000000000000000008d210fd771f72ab',
    token: '000000000000000000000000480bdc4d52df318db7b458b171540a936dc39a07',
    hash: '0dab736365762dd663d51e5cc43afc79e3987382b377cf70b85471596b42a1e5',
  },
  {
    pubkey: '6a26fe361ff14ef4c931c82acc8c772d5a349a4d1af75bff27dde944ec713b27',
    random: '1d629e459c9d76866be24dc759449eb86478eea9c496942f0f25967c11fc4bbd',
    amount: '000000000000000000000000000000000000000000000000060c736c94f022c6',
    token: '0000000000000000000000008afe4263f81c6d01cb6ea2548132a82d4c5b16e8',
    hash: '0931f4cccea5cf227cfdeb66623dc80d53980262c548ace1bac4b14c94eaaa0d',
  },
  {
    pubkey: 'c103873aa9d88c4c4cbc4cac97f7b57d01ab3587500c1d1c90fe3991b1dab882',
    random: '15af83f1c32852bd5f714bb9176a14622e16e1cdda5f94ddb9981d3811924b05',
    amount: '000000000000000000000000000000000000000000000000005589f7d39c59bf',
    token: '0000000000000000000000004f53cbc84f501847cf42bd9fb14d63be21dcffc8',
    hash: '187649443a10a16187d652866894a7fad7e676287e41faa8707fb5a2f555072d',
  },
];

describe('Note/ERC20', () => {
  it('Should calculate hashes', () => {
    vectors.forEach((vector) => {
      expect((new ERC20Note(
        vector.pubkey,
        vector.random,
        vector.amount,
        vector.token,
      )).hash).to.equal(vector.hash);
    });
  });

  // TODO: update this unit-test to use tag
  // it('Should encrypt and decrypt notes', () => {
  //   const ciphertextVectors = [
  //     {
  //       note: {
  //         pubkey: '6595f9a971c7471695948a445aedcbb9d624a325dbe68c228dea25eccf61919d',
  //         random: '1bcfa32dbb44dc6a26712bc500b6373885b08a7cd73ee433072f1d410aeb4801',
  //         amount: '000000000000000000000000000000000000000000000000086aa1ade61ccb53',
  //         token: '0000000000000000000000007f4925cdf66ddf5b88016df1fe915e68eff8f192',
  //       },
  //       sharedKey: 'b8b0ee90e05cec44880f1af4d20506265f44684eb3b6a4327bcf811244dc0a7f',
  //       ciphertext: {
  //         iv: '00000000000000000000000000000000ac1479a356621f493a6d8b3ca99d1a25',
  //         data: [
  //           '1f7bb778c84a9786dc1beeb1b7cc108834752a386a9921c9c6f26b2312d3ea63',
  //           '58335f95ae23341654bc45b9e308b16f3945dc7835a99f9fbce44e4aa4544b05',
  //           '742397c6aa7dbaacc6d02b8cffde96b3d5523a00e2691a9c6e9628e9fd3c995d',
  //           '995c4bca7a0ba8ff0c6e5f5826a9151db4d2333c6fc5014cb3dae0d8a9461db7',
  //           '8d1c0bbec99872b751c2f19188beaf216282d64ec50aa055acb99cfd2332cf55',
  //         ],
  //       },
  //     },
  //     {
  //       note: {
  //         pubkey: 'ab017ebda8fae25c92ecfc38f219c0ed1f73538bc9dc8e5db8ae46f3b00d5a2f',
  //         random: '11299eb10424d82de500a440a2874d12f7c477afb5a3eb31dbb96295cdbcf165',
  //         amount: '00000000000000000000000000000000000000000000000007cf6b5ae17ae75a',
  //         token: '000000000000000000000000df0fa4124c8a5feec8efcb0e0142d3e04a9e0fbf',
  //       },
  //       sharedKey: 'c8c2a74bacf6ce3158069f81202d8c2d81fd25d226d7536f26442888c014a755',
  //       ciphertext: {
  //         iv: '00000000000000000000000000000000dcad5707d7af6abc9574e6fd8b7a78bc',
  //         data: [
  //           '3eb25c527d434bb07a424f48a061fd00d0f90ee30e9a2f92d07716d12ac498a7',
  //           '0b09a3d591397034d39f6b1fa6292af8795f20af315b9ab7f0ff1cd42bc1d2b6',
  //           'f7425271fbbf8a09bd774886d8e2a93ea500a384dde272ea7479deec61fcf15e',
  //           'da1d87d35f2a8a58f2f24aa161aec30b4d19b990c4e15c2e9d9fcc0071475343',
  //           'a25bc95d76915893cb6a2fd1718f7101d31423657917b1895d45d3f2a87bf45c',
  //         ],
  //       },
  //     },
  //     {
  //       note: {
  //         pubkey: '4704ae101848ca47a6734d0e9210a5ecc204b97541fa1b808e5551319b49ec24',
  //         random: '09b57736523cda7412ddfed0d2f1f4a86d8a7e26de6b0638cd092c2a2b524705',
  //         amount: '0000000000000000000000000000000000000000000000000b9df0087cbbd709',
  //         token: '00000000000000000000000034e34b5d8e848f9d20d9bd8e1e48e24c3b87c396',
  //       },
  //       sharedKey: '4676adb24e597086894880767f274818f711233eda9d617b348bb1cf92dd35e5',
  //       ciphertext: {
  //         iv: '00000000000000000000000000000000becd0762e4c0e44ce4104246431a37e8',
  //         data: [
  //           '3709e9d719d12d1c121d73abcf61281e6c0f1278f877546821d2e7e3b7f6be41',
  //           '40ddbe18f5b3cccf1204b77dcdb5a6e663bf97c76a5604dc9ff94f838cc4f7ec',
  //           '87c30c7a60a85a82e83c22f053b19ec988637b02d62eaf827c635d22c6c73b1d',
  //           'ecc046188ba314a96bc6eceffcfc20a8310f752f0e47a022363aaa4800463e1c',
  //           '0d561cec83799299847a2d073218861442e432778773443a176ed078adcb4016',
  //         ],
  //       },
  //     },
  //   ];

  //   ciphertextVectors.forEach((vector) => {
  //     // Create Note object
  //     const note = new ERC20Note(
  //       vector.note.pubkey,
  //       vector.note.random,
  //       vector.note.amount,
  //       vector.note.token,
  //     );

  //     // Get encrypted values
  //     const encrypted = note.encrypt(vector.sharedKey);

  //     // Check if encrypted values are successfully decrypted
  //     expect(ERC20Note.decrypt(encrypted, vector.sharedKey)).to.deep.equal(note);

  //     // Check if vector encrypted values are successfully decrypted
  //     expect(ERC20Note.decrypt(vector.ciphertext, vector.sharedKey)).to.deep.equal(note);
  //   });
  // });

  it('Should serialize and deserialize notes', () => {
    vectors.forEach((vector) => {
      const note = ERC20Note.deserialize(vector);

      expect(note.hash).to.equal(vector.hash);

      const serialized = note.serialize();
      const serializedContract = note.serialize(true);

      expect(serialized.pubkey).to.equal(vector.pubkey);
      expect(serialized.random).to.equal(vector.random);
      expect(serialized.amount).to.equal(vector.amount);
      expect(serialized.token).to.equal(vector.token);

      expect(serializedContract.pubkey).to.equal(`0x${vector.pubkey}`);
      expect(serializedContract.random).to.equal(`0x${vector.random}`);
      expect(serializedContract.amount).to.equal(`0x${vector.amount}`);
      expect(serializedContract.token).to.equal(`0x${vector.token}`);
    });
  });

  it('Should calculate nullifiers', () => {
    const nullifierVectors = [
      {
        privateKey: '08ad9143ae793cdfe94b77e4e52bc4e9f13666966cffa395e3d412ea4e20480f',
        tree: 0,
        position: 0,
        nullifier: '086ba0bf110354e8e0e739a2f75f16b4881b860eee3a3f8ec496697d4772b070',
      },
      {
        privateKey: '11299eb10424d82de500a440a2874d12f7c477afb5a3eb31dbb96295cdbcf165',
        tree: 1,
        position: 12,
        nullifier: '221726902157517f269638f3cb694c9fb70bf4945d4c31a37c6e980bb874c0e1',
      },
      {
        privateKey: '09b57736523cda7412ddfed0d2f1f4a86d8a7e26de6b0638cd092c2a2b524705',
        tree: 14,
        position: 6500,
        nullifier: '063ada7117b163a5d5d9c1b66e8ce397040163846bd2757c8fbd79f0971d3ab9',
      },
    ];

    nullifierVectors.forEach((vector) => {
      expect(ERC20Note.getNullifier(vector.privateKey, vector.tree, vector.position))
        .to.equal(vector.nullifier);
    });
  });
});
