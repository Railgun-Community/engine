/* eslint-disable @typescript-eslint/no-unused-vars */
/* globals describe it beforeEach afterEach */
import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { utf8ToBytes } from 'ethereum-cryptography/utils';
import { mnemonicToSeed } from 'ethers/lib/utils';

import memdown from 'memdown';
import { Database } from '../../src/database';
import { bech32 } from '../../src/keyderivation';
import { MerkleTree } from '../../src/merkletree';
import { bytes, hash } from '../../src/utils';
import { fromUTF8String } from '../../src/utils/bytes';
import { verifyED25519 } from '../../src/utils/keys-utils';

import { Wallet } from '../../src/wallet';

// import type { Commitment } from '../../src/merkletree';
import { config } from '../config.test';

chai.use(chaiAsPromised);
const { expect } = chai;

let db: Database;
let merkletree: MerkleTree;
let wallet: Wallet;
const chainID: number = 1;

const testMnemonic = config.mnemonic;
const testEncryptionKey = config.encryptionKey;

// const keypairs = [
//   {
//     // Primary 0
//     privateKey: '0852ea0ca28847f125cf5c206d8f62d4dc59202477dce90988dc57d5e9b2f144',
//     pubkey: 'c95956104f69131b1c269c30688d3afedd0c3a155d270e862ea4c1f89a603a1b',
//     address: 'rgeth1q8y4j4ssfa53xxcuy6wrq6yd8tld6rp6z4wjwr5x96jvr7y6vqapk0tmp0s',
//   },
//   {
//     // Primary 1
//     privateKey: '0d65921bba9cd412064b41cf915266f5d9302e8bcbfd3ed8457ea914edbb01c2',
//     pubkey: '6dd2398c78ea7662655bbce41224012c4948645ba12fc843f9dbb9a6b9e24005',
//     address: 'rgeth1q9kaywvv0r48vcn9tw7wgy3yqykyjjrytwsjljzrl8dmnf4eufqq2qdalzf',
//   },
//   {
//     // Primary 5
//     privateKey: '0a84aed056690cf95db7a35a2f79795f3f6656203a05b35047b7cb7b6f4d27c3',
//     pubkey: '49036a0ebd462c2a7e4311de737a92b6e36bd0c5505c446ec8919dfccc5d448e',
//     address: 'rgeth1q9ysx6swh4rzc2n7gvgauum6j2mwx67sc4g9c3rwezgemlxvt4zgujlt072',
//   },
//   {
//     // Change 2
//     privateKey: '0ad38aeedddc5a9cbc51007ce04d1800a628cc5aea50c5c8fb4cd23c13941500',
//     pubkey: 'e4fb4c45e08bf87ba679185d03b0d5de4df67b5079226eff9d7e990a30773e07',
//     address: 'rgeth1q8j0knz9uz9ls7ax0yv96qas6h0ymanm2pujymhln4lfjz3swulqwn5p63t',
//   },
// ];

// const senderPubKey = '37e3984a41b34eaac002c140b28e5d080f388098a51d34237f33e84d14b9e491';

// const keypairsPopulated = keypairs.map((key) => ({
//   ...key,
//   sharedKey: babyjubjub.ecdh(key.privateKey, senderPubKey),
// }));

// const notesPrep = [0, 1, 2, 3, 2, 0];

// const leaves: Commitment[] = notesPrep.map((keyIndex) => {
//   const note = new Note(
//     keypairsPopulated[keyIndex].pubkey,
//     '1e686e7506b0f4f21d6991b4cb58d39e77c31ed0577a986750c8dce8804af5b9',
//     'ffff',
//     '7f4925cdf66ddf5b88016df1fe915e68eff8f192',
//   );

//   return {
//     hash: note.hash,
//     txid: '0x1097c636f99f179de275635277e458820485039b0a37088a5d657b999f73b59b',
//     senderPubKey,
//     ciphertext: note.encrypt(keypairsPopulated[keyIndex].sharedKey),
//     revealKey: ['01', '02'], // TODO
//   };
// });

// const notesPrep2 = [0, 1, 2, 3, 2, 0];

// const leaves2: Commitment[] = notesPrep2.map((keyIndex) => {
//   const note = new Note(
//     keypairsPopulated[keyIndex].pubkey,
//     '1e686e7506b0f4f21d6991b4cb58d39e77c31ed0577a986750c8dce8804af5b9',
//     'ffff',
//     '7f4925cdf66ddf5b88016df1fe915e68eff8f192',
//   );

//   return {
//     hash: note.hash,
//     txid: '0x1097c636f99f179de275635277e458820485039b0a37088a5d657b999f73b59b',
//     data: note.serialize(viewingPrivateKey),
//   };
// });

describe('Wallet/Index', () => {
  beforeEach(async () => {
    // Create database and wallet
    db = new Database(memdown());
    merkletree = new MerkleTree(db, 1, 'erc20', async () => true);
    wallet = await Wallet.fromMnemonic(db, testEncryptionKey, testMnemonic, 0);
    wallet.loadTree(merkletree);
  });

  it('Should load existing wallet', async () => {
    const wallet2 = await Wallet.loadExisting(db, testEncryptionKey, wallet.id);
    expect(wallet2.id).to.equal(wallet.id);
  });

  it('Should get wallet prefix path', async () => {
    const path = wallet.getWalletDBPrefix(chainID);
    expect(path[1]).to.equal(hash.sha256(bytes.combine([mnemonicToSeed(testMnemonic), '00'])));
    expect(path[1]).to.equal(wallet.id);
    expect(wallet.getWalletDBPrefix(chainID)).to.deep.equal([
      '000000000000000000000000000000000000000000000000000077616c6c6574',
      'bee63912e0e4cfa6830ebc8342d3efa9aa1336548c77bf4336c54c17409f2990',
      '0000000000000000000000000000000000000000000000000000000000000001',
    ]);
  });

  it('Should get wallet details path', async () => {
    expect(wallet.getWalletDetailsPath(chainID)).to.deep.equal([
      '000000000000000000000000000000000000000000000000000077616c6c6574',
      'bee63912e0e4cfa6830ebc8342d3efa9aa1336548c77bf4336c54c17409f2990',
      '0000000000000000000000000000000000000000000000000000000000000001',
    ]);
  });

  it('Should get viewing keypair', async () => {
    expect(wallet.getViewingKeyPair()).to.deep.equal({
      privateKey: new Uint8Array([
        157, 164, 180, 240, 181, 73, 58, 107, 163, 247, 223, 6, 17, 195, 224, 132, 47, 126, 43, 179,
        214, 64, 243, 19, 178, 53, 241, 183, 92, 29, 128, 185,
      ]),
      pubkey: new Uint8Array([
        119, 215, 170, 124, 91, 151, 128, 96, 190, 43, 167, 140, 188, 14, 249, 42, 79, 58, 163, 252,
        41, 128, 62, 175, 71, 132, 124, 245, 16, 185, 134, 234
      ]),
    });
  });

  it('Should sign and verify with viewing keypair', async () => {
    const data = utf8ToBytes('20388293809abc');
    const signed = await wallet.signWithViewingKey(data);
    const { pubkey } = wallet.getViewingKeyPair();
    expect(await verifyED25519(data, signed, pubkey)).to.equal(true);
  });

  it('Should get spending keypair', async () => {
    expect(await wallet.getSpendingKeyPair(testEncryptionKey)).to.deep.equal({
      privateKey: new Uint8Array([
        176, 149, 143, 139, 194, 134, 174, 8, 50, 250, 131, 176, 27, 113, 154, 34, 90, 7, 206, 123,
        134, 31, 243, 17, 50, 63, 34, 22, 103, 179, 189, 80,
      ]),
      pubkey: [
        15684838006997671713939066069845237677934334329285343229142447933587909549584n,
        11878614856120328179849762231924033298788609151532558727282528569229552954628n,
      ],
    });
  });

  it('Should get address keys', async () => {
    expect(wallet.addressKeys).to.deep.equal({
      masterPublicKey:
        20060431504059690749153982049210720252589378133547582826474262520121417617087n,
      viewingPublicKey: new Uint8Array([
        119, 215, 170, 124, 91, 151, 128, 96, 190, 43, 167, 140, 188, 14, 249, 42, 79, 58, 163, 252,
        41, 128, 62, 175, 71, 132, 124, 245, 16, 185, 134, 234
      ]),
    });
  });

  it('Should get addresses', async () => {
    expect(wallet.getAddress(0)).to.equal(
      '0zk1qyk9nn28x0u3rwn5pknglda68wrn7gw6anjw8gg94mcj6eq5u48tlrv7j6fe3z53lama02nutwtcqc979wnce0qwly4y7w4rls5cq040g7z8eagshxrw5ajy990',
    );
    expect(wallet.getAddress(1)).to.equal(
      '0zk1qyk9nn28x0u3rwn5pknglda68wrn7gw6anjw8gg94mcj6eq5u48t7unpd9kxwatwq9ma02nutwtcqc979wnce0qwly4y7w4rls5cq040g7z8eagshxrw56ltkfa',
    );
    expect(wallet.getAddress(2)).to.equal(
      '0zk1qyk9nn28x0u3rwn5pknglda68wrn7gw6anjw8gg94mcj6eq5u48t7unpd9kxwatwqfma02nutwtcqc979wnce0qwly4y7w4rls5cq040g7z8eagshxrw5aha7vd',
    );
    expect(wallet.getAddress(3)).to.equal(
      '0zk1qyk9nn28x0u3rwn5pknglda68wrn7gw6anjw8gg94mcj6eq5u48t7unpd9kxwatwqdma02nutwtcqc979wnce0qwly4y7w4rls5cq040g7z8eagshxrw58ggp06',
    );
    expect(wallet.getAddress(4)).to.equal(
      '0zk1qyk9nn28x0u3rwn5pknglda68wrn7gw6anjw8gg94mcj6eq5u48t7unpd9kxwatwq3ma02nutwtcqc979wnce0qwly4y7w4rls5cq040g7z8eagshxrw5n8cwxy',
    );
  });

  it('Should derive addresses correctly', async () => {
    const address = wallet.getAddress(chainID);
    const decoded = bech32.decode(address);
    expect(decoded.masterPublicKey).to.equal(wallet.masterPublicKey);
    expect(decoded.chainID).to.equal(chainID);
  });

  it('Should get empty wallet details', async () => {
    expect(await wallet.getWalletDetails(chainID)).to.deep.equal({
      treeScannedHeights: [],
    });
  });

  // it('Should scan ERC20 balances', async () => {
  //   await merkletree.queueLeaves(0, 0, leaves);

  //   const process = wallet.scan(1);

  //   // Should respect scan lock
  //   wallet.scan(1);
  //   await process;

  //   expect(await wallet.getWalletDetails(chainID)).to.deep.equal({
  //     treeScannedHeights: [5],
  //     primaryHeight: 5,
  //     changeHeight: 2,
  //   });

  //   await merkletree.queueLeaves(0, 6, leaves2);

  //   await wallet.scan(1);

  //   expect(await wallet.getWalletDetails(chainID)).to.deep.equal({
  //     treeScannedHeights: [11],
  //   });

  //   const balances = await wallet.balances(1);

  //   expect(
  //     balances['0000000000000000000000007f4925cdf66ddf5b88016df1fe915e68eff8f192'].utxos.length,
  //   ).to.equal(12);

  //   expect(
  //     balances['0000000000000000000000007f4925cdf66ddf5b88016df1fe915e68eff8f192'].balance,
  //   ).to.equal(786420n);

  //   await merkletree.nullify([
  //     {
  //       txid: '000001',
  //       nullifier: '15f75defeb0075ee0e898acc70780d245ab1c19b33cfd2b855dd66faee94a5e0',
  //     },
  //   ]);

  //   const balances2 = await wallet.balances(1);

  //   expect(
  //     balances2['0000000000000000000000007f4925cdf66ddf5b88016df1fe915e68eff8f192'].utxos.length,
  //   ).to.equal(11);

  //   expect(
  //     balances2['0000000000000000000000007f4925cdf66ddf5b88016df1fe915e68eff8f192'].balance.eqn(
  //       720885,
  //     ),
  //   ).to.equal(true);

  //   await merkletree.nullify([
  //     {
  //       txid: '000001',
  //       nullifier: '1c3ba503ad9e144683649756ce1e9a919afb56d836988435c1528ea8942f286e',
  //     },
  //   ]);

  //   const balances3 = await wallet.balances(1);

  //   expect(
  //     balances3['0000000000000000000000007f4925cdf66ddf5b88016df1fe915e68eff8f192'].utxos.length,
  //   ).to.equal(10);

  //   expect(
  //     balances3['0000000000000000000000007f4925cdf66ddf5b88016df1fe915e68eff8f192'].balance.eqn(
  //       655350,
  //     ),
  //   ).to.equal(true);

  //   expect(
  //     (await wallet.balancesByTree(1))[
  //       '0000000000000000000000007f4925cdf66ddf5b88016df1fe915e68eff8f192'
  //     ][0].utxos.length,
  //   ).to.equal(10);
  // }).timeout(60000);

  afterEach(() => {
    // Clean up database
    wallet.unloadTree(merkletree.chainID);
    db.close();
  });
});
