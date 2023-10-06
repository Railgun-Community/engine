import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { BytesData } from '../../models/formatted-types';
import { ByteLength, nToHex, randomHex } from '../bytes';
import { AES } from '../encryption';

chai.use(chaiAsPromised);
const { expect } = chai;

describe('encryption', () => {
  it('Should test the correctness of encrypt/decrypt with AES-256-GCM', () => {
    const plaintext: BytesData[] = [];
    for (let i = 0; i < 8; i += 1) plaintext.push(randomHex(32));
    const key = randomHex(32);
    const ciphertext = AES.encryptGCM(plaintext, key);

    // Test decryption returns correct plaintext array
    expect(
      AES.decryptGCM(
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
    for (let i = 0; i < 8; i += 1) plaintext.push(randomHex(32));
    const key = randomHex(32);
    const ciphertext = AES.encryptGCM(plaintext, key);
    const randomTag = randomHex(16);

    // Test decryption returns correct plaintext array
    expect(() =>
      AES.decryptGCM(
        {
          iv: ciphertext.iv,
          tag: randomTag,
          data: ciphertext.data,
        },
        key,
      ),
    ).to.throw('Unable to decrypt ciphertext.');
  });

  it('Should encrypt and decrypt GCM data', () => {
    const randomValue = randomHex();
    const viewingPrivateKey =
      71304128950017749550555748140089622855554443655032326837948344032235540545721n;
    const ciphertext = AES.encryptGCM(
      [randomValue],
      nToHex(viewingPrivateKey, ByteLength.UINT_256),
    );
    const decrypted = AES.decryptGCM(ciphertext, nToHex(viewingPrivateKey, ByteLength.UINT_256));
    expect(randomValue).to.equal(decrypted[0]);
  });

  it('Should test the correctness of encrypt/decrypt with AES-256-CTR', () => {
    const plaintext: string[] = [];
    for (let i = 0; i < 16; i += 1) plaintext.push(randomHex(32));
    const key = randomHex(32);
    const ciphertext = AES.encryptCTR(plaintext, key);

    // Test decryption returns correct plaintext array
    expect(
      AES.decryptCTR(
        {
          iv: ciphertext.iv,
          data: ciphertext.data,
        },
        key,
      ),
    ).to.deep.equal(plaintext);
  });

  it('Should encrypt and decrypt CTR data', () => {
    const plaintext = randomHex(32);
    const viewingPrivateKey =
      71304128950017749550555748140089622855554443655032326837948344032235540545721n;
    const ciphertext = AES.encryptCTR([plaintext], nToHex(viewingPrivateKey, ByteLength.UINT_256));
    const decrypted = AES.decryptCTR(ciphertext, nToHex(viewingPrivateKey, ByteLength.UINT_256));
    expect(plaintext).to.equal(decrypted[0]);
  });
});
