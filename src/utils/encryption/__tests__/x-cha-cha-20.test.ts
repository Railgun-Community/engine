import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { hexToBytes } from '@noble/hashes/utils';
import { ByteLength, combine, nToBytes, randomHex } from '../../bytes';
import { XChaCha20 } from '../x-cha-cha-20';

chai.use(chaiAsPromised);
const { expect } = chai;

describe('x-cha-cha-20', () => {
  it('Should test the correctness of encrypt/decrypt with XChaCha20Poly1305', () => {
    const plaintext: string[] = [];
    for (let i = 0; i < 8; i += 1) plaintext.push(randomHex(32));
    const key = hexToBytes(randomHex(32));
    const ciphertext = XChaCha20.encryptChaCha20Poly1305(plaintext, key);

    // Test decryption returns correct plaintext array
    expect(
      XChaCha20.decryptChaCha20Poly1305(
        {
          iv: ciphertext.iv,
          data: ciphertext.data,
        },
        key,
      ),
    ).to.deep.equal(plaintext);
  });

  it('Should encrypt and decrypt XChaCha20Poly1305 data', () => {
    const randomValue = randomHex();
    const viewingPrivateKey =
      71304128950017749550555748140089622855554443655032326837948344032235540545721n;
    const ciphertext = XChaCha20.encryptChaCha20Poly1305(
      [randomValue],
      nToBytes(viewingPrivateKey, ByteLength.UINT_256),
    );
    const decrypted = XChaCha20.decryptChaCha20Poly1305(
      ciphertext,
      nToBytes(viewingPrivateKey, ByteLength.UINT_256),
    );
    expect(randomValue).to.equal(decrypted[0]);
  });

  it('Should reject invalid tag for XChaCha20Poly1305', () => {
    const plaintext: string[] = [];
    for (let i = 0; i < 8; i += 1) plaintext.push(randomHex(32));
    const key = hexToBytes(randomHex(32));
    const ciphertext = XChaCha20.encryptChaCha20Poly1305(plaintext, key);
    ciphertext.data[ciphertext.data.length - 1] = '03c3771aa34d4cc5cbeef4a9788762';

    // Test decryption returns correct plaintext array
    expect(() =>
      XChaCha20.decryptChaCha20Poly1305(
        {
          iv: ciphertext.iv,
          data: ciphertext.data,
        },
        key,
      ),
    ).to.throw('invalid tag');
  });

  it('Should test the correctness of encrypt/decrypt with XChaCha20', () => {
    const plaintext: string[] = [];
    for (let i = 0; i < 16; i += 1) plaintext.push(randomHex(32));
    const key = hexToBytes(randomHex(32));
    const ciphertext = XChaCha20.encryptChaCha20(plaintext, key);

    // Test decryption returns correct plaintext array
    expect(
      XChaCha20.decryptChaCha20(
        {
          iv: ciphertext.iv,
          data: ciphertext.data,
        },
        key,
      ),
    ).to.deep.equal(plaintext);
  });

  it('Should encrypt and decrypt XChaCha20 data', () => {
    const plaintext = `${randomHex(32)}${randomHex(32)}${randomHex(32)}${randomHex(32)}${randomHex(
      32,
    )}`;
    const viewingPrivateKey =
      71304128950017749550555748140089622855554443655032326837948344032235540545721n;
    const ciphertext = XChaCha20.encryptChaCha20(
      [plaintext],
      nToBytes(viewingPrivateKey, ByteLength.UINT_256),
    );
    const decrypted = XChaCha20.decryptChaCha20(
      ciphertext,
      nToBytes(viewingPrivateKey, ByteLength.UINT_256),
    );
    expect(plaintext).to.equal(combine(decrypted));
  });
});
