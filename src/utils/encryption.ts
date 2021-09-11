import crypto from 'crypto';
import random from './random';
import convert from './convert';
import type { BytesData } from './globaltypes';

export interface Ciphertext {
  iv: BytesData,
  data: BytesData[]
}

const aes = {
  ctr: {
    /**
     * Encrypt blocks of data with AES-256-CTR
     *
     * @param plaintext - plaintext to encrypt
     * @param key - key to encrypt with
     * @param iv - initialization vector to use
     * @returns ciphertext bundle
     */
    encrypt(plaintext: BytesData[], key: BytesData, iv: BytesData = random(16)): Ciphertext {
      // If types are strings, convert to bytes array
      const plaintextFormatted = plaintext.map(
        (block) => new Uint8Array(convert.arrayify(block)),
      );
      const keyFormatted = new Uint8Array(convert.arrayify(key));
      const ivFormatted = new Uint8Array(convert.arrayify(iv));

      // Initialize cipher
      const cipher = crypto.createCipheriv(
        'aes-256-ctr',
        keyFormatted,
        ivFormatted,
      );

      // Loop through data blocks and encrypt
      const data = plaintextFormatted.map((block) => cipher.update(
        block,
      )).map((block) => block.toString('hex'));

      // Return encrypted data bundle
      return {
        iv: convert.hexlify(ivFormatted),
        data,
      };
    },

    /**
     * Decrypts AES-256-CTR encrypted data
     *
     * @param ciphertext - ciphertext bundle to decrypt
     * @param key - key to decrypt with
     * @returns - plaintext
     */
    decrypt(ciphertext: Ciphertext, key: BytesData): BytesData[] {
      // If types are strings, convert to bytes array
      const ciphertextFormatted = ciphertext.data.map(
        (block) => new Uint8Array(convert.arrayify(block)),
      );
      const keyFormatted = new Uint8Array(convert.arrayify(key));
      const ivFormatted = new Uint8Array(convert.arrayify(ciphertext.iv));

      // Initialize decipher
      const decipher = crypto.createDecipheriv(
        'aes-256-ctr',
        keyFormatted,
        ivFormatted,
      );

      // Loop through ciphertext and decrypt then return
      return ciphertextFormatted.map((block) => decipher.update(
        block,
      )).map((block) => block.toString('hex'));
    },
  },
};

export default {
  aes,
};
