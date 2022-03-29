/* eslint-disable no-plusplus */
/* globals describe it */
import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { encryption } from '../../src/utils';
import { BytesData, random } from '../../src/utils/bytes';


chai.use(chaiAsPromised);
const { expect } = chai;

describe('Utils/Encryption', () => {
  it('Should test the correctness of encrypt/decrypt with AES-256-GCM', () => {

    const plaintext: BytesData[] = [];
    for(let i=0; i<8; i++)
      plaintext.push(random(32));
    const key = random(32);
    const ciphertext = encryption.aes.gcm.encrypt(plaintext, key);

      // Test decryption returns correct plaintext array
      expect(encryption.aes.gcm.decrypt(
        {
          iv: ciphertext.iv,
          tag: ciphertext.tag,
          data: ciphertext.data,
        },
        key,
      )).to.deep.equal(plaintext);
  });

  it('Should reject invalid tag', () => {
    const plaintext: BytesData[] = [];
    for(let i=0; i<8; i++)
      plaintext.push(random(32));
    const key = random(32);
    const ciphertext = encryption.aes.gcm.encrypt(plaintext, key);
    const randomTag = random(16);

    // Test decryption returns correct plaintext array
    expect(() => encryption.aes.gcm.decrypt(
      {
        iv: ciphertext.iv,
        tag: randomTag,
        data: ciphertext.data,
      },
      key,
    )).to.throw("Unsupported state or unable to authenticate data");
  });
});
