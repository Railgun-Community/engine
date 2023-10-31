import { xchacha20, xchacha20poly1305 } from '@noble/ciphers/chacha';
import { bytesToHex } from 'ethereum-cryptography/utils';
import { hexToBytes } from '@noble/hashes/utils';
import { ByteLength, chunk, combine, randomHex } from '../bytes';
import { CiphertextIVData } from '../../models/formatted-types';

const ivFiller = '0000000000000000';

export class XChaCha20 {
  static getRandomIV() {
    return randomHex(16);
  }

  private static getFullIV(iv: string): Uint8Array {
    return hexToBytes(`${ivFiller}${iv}`);
  }

  static encryptChaCha20(plaintext: string[], key: Uint8Array): CiphertextIVData {
    const iv = this.getRandomIV();
    const plaintextFormatted = hexToBytes(combine(plaintext));
    const bytes = xchacha20(key, this.getFullIV(iv), plaintextFormatted);
    const data = chunk(bytesToHex(bytes), ByteLength.UINT_256);
    return {
      iv,
      data,
    };
  }

  static decryptChaCha20(ciphertext: CiphertextIVData, key: Uint8Array): string[] {
    const bytes = xchacha20(
      key,
      this.getFullIV(ciphertext.iv),
      hexToBytes(combine(ciphertext.data)),
    );
    const plaintext = chunk(bytesToHex(bytes), ByteLength.UINT_256);
    return plaintext;
  }

  static encryptChaCha20Poly1305(plaintext: string[], key: Uint8Array): CiphertextIVData {
    const iv = this.getRandomIV();
    const cipherWithOutput = xchacha20poly1305(key, this.getFullIV(iv));
    const plaintextFormatted = hexToBytes(combine(plaintext));
    const bytes = cipherWithOutput.encrypt(plaintextFormatted);
    const data = chunk(bytesToHex(bytes), ByteLength.UINT_256);
    return {
      iv,
      data,
    };
  }

  static decryptChaCha20Poly1305(ciphertext: CiphertextIVData, key: Uint8Array): string[] {
    const cipherWithOutput = xchacha20poly1305(key, this.getFullIV(ciphertext.iv));
    const dataFormatted = hexToBytes(combine(ciphertext.data));
    const plaintext = bytesToHex(cipherWithOutput.decrypt(dataFormatted));
    return chunk(plaintext);
  }
}
