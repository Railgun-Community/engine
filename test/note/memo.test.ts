/* eslint-disable @typescript-eslint/no-unused-vars */
/* globals describe it beforeEach */
import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import memdown from 'memdown';
import { Database } from '../../src/database';
import { NoteExtraData, OutputType } from '../../src/models/formatted-types';
import { Memo } from '../../src/note/memo';
import { Wallet } from '../../src/wallet/wallet';
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
  });

  it('Should encrypt and decrypt note extra data', async () => {
    const sender = wallet.getViewingKeyPair();

    const noteExtraData: NoteExtraData = {
      outputType: OutputType.RelayerFee,
      senderBlindingKey: '1234567890abcde1234567890abcde', // 15 bytes
    };
    const encryptedNoteExtraData = Memo.encryptNoteExtraData(noteExtraData, sender.privateKey);
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
      'A really long memo with emojis 😐 👩🏾‍🔧 and other text, in order to test a major memo for a real live production use case.';

    const encoded = Memo.encodeSplitMemoText(memoText);
    expect(encoded).to.deep.equal([
      '41207265616c6c79206c6f6e67206d656d6f207769746820656d6f6a697320f0',
      '9f989020f09f91a9f09f8fbee2808df09f94a720616e64206f74686572207465',
      '78742c20696e206f7264657220746f20746573742061206d616a6f72206d656d',
      '6f20666f722061207265616c206c6976652070726f64756374696f6e20757365',
      '000000000000000000000000000000000000000000000000000020636173652e',
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
