import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { hexToBytes } from '@noble/hashes/utils';
import { ByteLength, nToBytes, randomHex } from '../../bytes';
import { XChaCha20 } from '../x-cha-cha-20';

chai.use(chaiAsPromised);
const { expect } = chai;

describe('x-cha-cha-20', () => {
  it('Should test the correctness of encrypt/decrypt with XChaCha20Poly1305', () => {
    let plaintext: string = '';
    for (let i = 0; i < 8; i += 1) plaintext += randomHex(32);
    const key = hexToBytes(randomHex(32));
    const ciphertext = XChaCha20.encryptChaCha20Poly1305(plaintext, key);

    // Test decryption returns correct plaintext array
    expect(XChaCha20.decryptChaCha20Poly1305(ciphertext, key)).to.deep.equal(plaintext);
  });

  it('Should encrypt and decrypt XChaCha20Poly1305 data', () => {
    const randomValue = randomHex();
    const viewingPrivateKey =
      71304128950017749550555748140089622855554443655032326837948344032235540545721n;
    const ciphertext = XChaCha20.encryptChaCha20Poly1305(
      randomValue,
      nToBytes(viewingPrivateKey, ByteLength.UINT_256),
    );
    const decrypted = XChaCha20.decryptChaCha20Poly1305(
      ciphertext,
      nToBytes(viewingPrivateKey, ByteLength.UINT_256),
    );
    expect(randomValue).to.equal(decrypted);
  });

  it('Should reject invalid tag for XChaCha20Poly1305', () => {
    let plaintext: string = '';
    for (let i = 0; i < 8; i += 1) plaintext += randomHex(32);
    const key = hexToBytes(randomHex(32));
    const ciphertext = XChaCha20.encryptChaCha20Poly1305(plaintext, key);
    ciphertext.bundle = `${ciphertext.bundle.substring(0, ciphertext.bundle.length - 1)}f`;

    // Test decryption returns correct plaintext array
    expect(() => XChaCha20.decryptChaCha20Poly1305(ciphertext, key)).to.throw('invalid tag');
  });

  it('Should test the correctness of encrypt/decrypt with XChaCha20', () => {
    let plaintext: string = '';
    for (let i = 0; i < 8; i += 1) plaintext += randomHex(32);
    const key = hexToBytes(randomHex(32));
    const ciphertext = XChaCha20.encryptChaCha20(plaintext, key);

    // Test decryption returns correct plaintext array
    expect(XChaCha20.decryptChaCha20(ciphertext, key)).to.deep.equal(plaintext);
  });

  it('Should encrypt and decrypt XChaCha20 data', () => {
    const plaintext = `${randomHex(32)}${randomHex(32)}${randomHex(32)}${randomHex(32)}${randomHex(
      32,
    )}`;
    const viewingPrivateKey =
      71304128950017749550555748140089622855554443655032326837948344032235540545721n;
    const ciphertext = XChaCha20.encryptChaCha20(
      plaintext,
      nToBytes(viewingPrivateKey, ByteLength.UINT_256),
    );
    const decrypted = XChaCha20.decryptChaCha20(
      ciphertext,
      nToBytes(viewingPrivateKey, ByteLength.UINT_256),
    );
    expect(plaintext).to.equal(decrypted);
  });
});
