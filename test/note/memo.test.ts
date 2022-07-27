/* eslint-disable @typescript-eslint/no-unused-vars */
/* globals describe it beforeEach */
import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import memdown from 'memdown';
import { Database } from '../../src/database';
import { NoteExtraData, OutputType } from '../../src/models/formatted-types';
import { Memo } from '../../src/note/memo';
import { Wallet } from '../../src/wallet';
import { config } from '../config.test';

chai.use(chaiAsPromised);
const { expect } = chai;

const testMnemonic = config.mnemonic;
const testEncryptionKey = config.encryptionKey;

let db: Database;
let wallet: Wallet;

// eslint-disable-next-line func-names
describe('Memo', function () {
  this.beforeAll(async () => {
    db = new Database(memdown());
    wallet = await Wallet.fromMnemonic(db, testEncryptionKey, testMnemonic, 0);
  });

  it('Should encrypt and decrypt memo field', async () => {
    const sender = wallet.getViewingKeyPair();

    const noteExtraData: NoteExtraData = { outputType: OutputType.RelayerFee };
    const memoField = Memo.createMemoField(noteExtraData, sender.privateKey);

    expect(Memo.decryptNoteExtraData(memoField, sender.privateKey)).to.deep.equal(noteExtraData);
  });
});
