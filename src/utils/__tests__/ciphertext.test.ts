import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { BytesData } from '../../models/formatted-types';
import { randomHex } from '../bytes';
import {
  ciphertextToEncryptedJSONData,
  ciphertextToEncryptedRandomData,
  encryptedDataToCiphertext,
} from '../ciphertext';
import { AES } from '../encryption';

chai.use(chaiAsPromised);
const { expect } = chai;

describe('ciphertext', () => {
  it('Should translate ciphertext to encrypted random and back', () => {
    const plaintext: BytesData[] = [randomHex(16)];
    const key = randomHex(32);
    const ciphertext = AES.encryptGCM(plaintext, key);

    const encryptedData = ciphertextToEncryptedRandomData(ciphertext);
    const newCiphertext = encryptedDataToCiphertext(encryptedData);

    expect(newCiphertext).to.deep.equal(ciphertext);
  });

  it('Should translate ciphertext to encrypted data and back', () => {
    const plaintext: BytesData[] = [];
    for (let i = 0; i < 40; i += 1) plaintext.push(randomHex(32));
    const key = randomHex(32);
    const ciphertext = AES.encryptGCM(plaintext, key);

    const encryptedData = ciphertextToEncryptedJSONData(ciphertext);
    const newCiphertext = encryptedDataToCiphertext(encryptedData);

    expect(newCiphertext).to.deep.equal(ciphertext);
  });
});
