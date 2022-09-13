/* eslint-disable @typescript-eslint/no-unused-vars */
/* globals describe it beforeEach */
import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import memdown from 'memdown';
import { Database } from '../../src/database';
import { NoteExtraData, OutputType } from '../../src/models/formatted-types';
import { Memo } from '../../src/note/memo';
import { Wallet } from '../../src/wallet/wallet';
import WalletInfo from '../../src/wallet/wallet-info';
import { config } from '../config.test';

chai.use(chaiAsPromised);
const { expect } = chai;

const testMnemonic = config.mnemonic;
const testEncryptionKey = config.encryptionKey;

let db: Database;
let wallet: Wallet;

describe('Memo', function run() {
  this.beforeAll(async () => {
    db = new Database(memdown());
    wallet = await Wallet.fromMnemonic(db, testEncryptionKey, testMnemonic, 0);
    WalletInfo.setWalletSource('Memo Wallet');
  });

  it('Should encrypt and decrypt note extra data', async () => {
    const sender = wallet.getViewingKeyPair();

    const noteExtraData: NoteExtraData = {
      outputType: OutputType.RelayerFee,
      senderBlindingKey: '1234567890abcde1234567890abcde', // 15 bytes
      walletSource: 'memo wallet',
    };
    const encryptedNoteExtraData = Memo.encryptNoteExtraData(
      noteExtraData.outputType,
      noteExtraData.senderBlindingKey,
      sender.privateKey,
    );
    expect(Memo.decryptNoteExtraData(encryptedNoteExtraData, sender.privateKey)).to.deep.equal(
      noteExtraData,
    );
  });

  it('Should encode and decode empty memo text', async () => {
    expect(Memo.encodeSplitMemoText(undefined)).to.deep.equal([]);
    expect(Memo.decodeMemoText([])).to.equal(undefined);
  });

  it('Should encode and decode memo text', async () => {
    const memoText =
      'A really long memo with emojis 😐👩🏾‍🔧😎 and other text !@#$%^&*() Private memo field 🤡🙀🥰👩🏿‍🚒🧞 🤡 🙀 🥰 👩🏿‍🚒 🧞, in order to test a major memo for a real live production use case.';

    const encoded = Memo.encodeSplitMemoText(memoText);
    expect(encoded).to.deep.equal([
      '41207265616c6c79206c6f6e67206d656d6f207769746820656d6f6a697320f0',
      '9f9890f09f91a9f09f8fbee2808df09f94a7f09f988e20616e64206f74686572',
      '20746578742021402324255e262a28292050726976617465206d656d6f206669',
      '656c6420f09fa4a1f09f9980f09fa5b0f09f91a9f09f8fbfe2808df09f9a92f0',
      '9fa79e20f09fa4a120f09f998020f09fa5b020f09f91a9f09f8fbfe2808df09f',
      '9a9220f09fa79e2c20696e206f7264657220746f20746573742061206d616a6f',
      '72206d656d6f20666f722061207265616c206c6976652070726f64756374696f',
      '0000000000000000000000000000000000000000006e2075736520636173652e',
    ]);
    encoded.forEach((encodedChunk) => {
      // eslint-disable-next-line no-unused-expressions
      expect(encodedChunk.length === 64).to.be.true;
    });

    const decoded = Memo.decodeMemoText(encoded);
    expect(decoded).to.equal(memoText);
  });

  it('Should encode and decode memo text without emojis', async () => {
    const memoText =
      'A really long memo in order to test a major memo for a real live production use case.';

    const encoded = Memo.encodeSplitMemoText(memoText);
    const decoded = Memo.decodeMemoText(encoded);

    expect(decoded).to.equal(memoText);
  });
});
