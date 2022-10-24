import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { BytesData } from '../../models/formatted-types';
import { randomHex } from '../bytes';
import { ciphertextToEncryptedJSONData, encryptedDataToCiphertext } from '../ciphertext';
import { aes } from '../encryption';

chai.use(chaiAsPromised);
const { expect } = chai;

describe('Ciphertext', () => {
  it('Should translate ciphertext to encrypted data and back', () => {
    const plaintext: BytesData[] = [];
    for (let i = 0; i < 40; i += 1) plaintext.push(randomHex(32));
    const key = randomHex(32);
    const ciphertext = aes.gcm.encrypt(plaintext, key);

    const encryptedData = ciphertextToEncryptedJSONData(ciphertext);
    const newCiphertext = encryptedDataToCiphertext(encryptedData);

    expect(newCiphertext).to.deep.equal(ciphertext);
  });
});
