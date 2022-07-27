/* eslint-disable no-plusplus */
/* globals describe it */
import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { BytesData } from '../../src/models/formatted-types';
import { bytes, encryption } from '../../src/utils';
import { ByteLength, nToHex, random } from '../../src/utils/bytes';

chai.use(chaiAsPromised);
const { expect } = chai;

describe('Utils/Encryption', () => {
  it('Should test the correctness of encrypt/decrypt with AES-256-GCM', () => {
    const plaintext: BytesData[] = [];
    for (let i = 0; i < 8; i++) plaintext.push(random(32));
    const key = random(32);
    const ciphertext = encryption.aes.gcm.encrypt(plaintext, key);

    // Test decryption returns correct plaintext array
    expect(
      encryption.aes.gcm.decrypt(
        {
          iv: ciphertext.iv,
          tag: ciphertext.tag,
          data: ciphertext.data,
        },
        key,
      ),
    ).to.deep.equal(plaintext);
  });

  it('Should reject invalid tag', () => {
    const plaintext: BytesData[] = [];
    for (let i = 0; i < 8; i++) plaintext.push(random(32));
    const key = random(32);
    const ciphertext = encryption.aes.gcm.encrypt(plaintext, key);
    const randomTag = random(16);

    // Test decryption returns correct plaintext array
    expect(() =>
      encryption.aes.gcm.decrypt(
        {
          iv: ciphertext.iv,
          tag: randomTag,
          data: ciphertext.data,
        },
        key,
      ),
    ).to.throw('Unsupported state or unable to authenticate data');
  });

  it('Should encrypt and decrypt GCM data', () => {
    const randomValue = bytes.random();
    const viewingPrivateKey =
      71304128950017749550555748140089622855554443655032326837948344032235540545721n;
    const ciphertext = encryption.aes.gcm.encrypt(
      [randomValue],
      nToHex(viewingPrivateKey, ByteLength.UINT_256),
    );
    const decrypted = encryption.aes.gcm.decrypt(
      ciphertext,
      nToHex(viewingPrivateKey, ByteLength.UINT_256),
    );
    expect(randomValue).to.equal(decrypted[0]);
  });

  it('Should test the correctness of encrypt/decrypt with AES-256-CTR', () => {
    const plaintext: string[] = [];
    for (let i = 0; i < 16; i++) plaintext.push(random(32));
    const key = random(32);
    const ciphertext = encryption.aes.ctr.encrypt(plaintext, key);

    // Test decryption returns correct plaintext array
    expect(
      encryption.aes.ctr.decrypt(
        {
          iv: ciphertext.iv,
          data: ciphertext.data,
        },
        key,
      ),
    ).to.deep.equal(plaintext);
  });

  it('Should encrypt and decrypt CTR data', () => {
    const plaintext = random(32);
    const viewingPrivateKey =
      71304128950017749550555748140089622855554443655032326837948344032235540545721n;
    const ciphertext = encryption.aes.ctr.encrypt(
      [plaintext],
      nToHex(viewingPrivateKey, ByteLength.UINT_256),
    );
    const decrypted = encryption.aes.ctr.decrypt(
      ciphertext,
      nToHex(viewingPrivateKey, ByteLength.UINT_256),
    );
    expect(plaintext).to.equal(decrypted[0]);
  });
});
