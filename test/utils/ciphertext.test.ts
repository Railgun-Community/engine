/* globals describe it */
import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { BytesData } from '../../src/models/formatted-types';
import { encryption } from '../../src/utils';
import { randomHex } from '../../src/utils/bytes';
import {
  ciphertextToEncryptedJSONData,
  ciphertextToEncryptedRandomData,
  encryptedDataToCiphertext,
} from '../../src/utils/ciphertext';

chai.use(chaiAsPromised);
const { expect } = chai;

describe('Ciphertext', () => {
  it('Should translate ciphertext to encrypted random and back', () => {
    const plaintext: BytesData[] = [randomHex(16)];
    const key = randomHex(32);
    const ciphertext = encryption.aes.gcm.encrypt(plaintext, key);

    const encryptedData = ciphertextToEncryptedRandomData(ciphertext);
    const newCiphertext = encryptedDataToCiphertext(encryptedData);

    expect(newCiphertext).to.deep.equal(ciphertext);
  });

  it('Should translate ciphertext to encrypted data and back', () => {
    const plaintext: BytesData[] = [];
    // eslint-disable-next-line no-plusplus
    for (let i = 0; i < 40; i++) plaintext.push(randomHex(32));
    const key = randomHex(32);
    const ciphertext = encryption.aes.gcm.encrypt(plaintext, key);

    const encryptedData = ciphertextToEncryptedJSONData(ciphertext);
    const newCiphertext = encryptedDataToCiphertext(encryptedData);

    expect(newCiphertext).to.deep.equal(ciphertext);
  });
});
