import crypto from 'crypto';
import { arrayify, ByteLength, formatToByteLength, padToLength, randomHex, trim } from './bytes';
import { BytesData, Ciphertext, CTRCiphertext } from '../models/formatted-types';

const aes = {
  gcm: {
    /**
     * Encrypt blocks of data with AES-256-GCM
     * @param plaintext - plaintext to encrypt
     * @param key - key to encrypt with
     * @returns ciphertext bundle
     */
    encrypt(plaintext: BytesData[], key: BytesData): Ciphertext {
      // If types are strings, convert to bytes array
      const plaintextFormatted = plaintext.map((block) => new Uint8Array(arrayify(block)));
      const keyFormatted = new Uint8Array(arrayify(key));
      if (keyFormatted.byteLength !== 32) {
        throw new Error(
          `Invalid key length. Expected 32 bytes. Received ${keyFormatted.byteLength} bytes.`,
        );
      }

      const iv = randomHex(16);
      const ivFormatted = new Uint8Array(arrayify(iv));

      // Initialize cipher
      const cipher = crypto.createCipheriv('aes-256-gcm', keyFormatted, ivFormatted, {
        authTagLength: 16,
      });

      // Loop through data blocks and encrypt
      const data = plaintextFormatted
        .map((block) => cipher.update(block))
        .map((block) => block.toString('hex'));
      cipher.final();

      const tag = cipher.getAuthTag();
      const tagFormatted = new Uint8Array(arrayify(tag));

      // Return encrypted data bundle
      return {
        iv: formatToByteLength(ivFormatted, ByteLength.UINT_128, false),
        tag: formatToByteLength(tagFormatted, ByteLength.UINT_128, false),
        data,
      };
    },

    /**
     * Decrypts AES-256-GCM encrypted data
     * On failure, it throws `Unsupported state or unable to authenticate data`
     * @param ciphertext - ciphertext bundle to decrypt
     * @param key - key to decrypt with
     * @returns - plaintext
     */
    decrypt(ciphertext: Ciphertext, key: BytesData): BytesData[] {
      try {
        // If types are strings, convert to bytes array
        const ciphertextFormatted = ciphertext.data.map((block) => new Uint8Array(arrayify(block)));
        const keyFormatted = new Uint8Array(arrayify(padToLength(key, 32)));
        const ivFormatted = new Uint8Array(arrayify(trim(ciphertext.iv, 16)));
        const tagFormatted = new Uint8Array(arrayify(trim(ciphertext.tag, 16)));

        // Initialize decipher
        const decipher = crypto.createDecipheriv('aes-256-gcm', keyFormatted, ivFormatted, {
          authTagLength: 16,
        });

        // It will throw exception if the decryption fails due to invalid key, iv, tag
        decipher.setAuthTag(tagFormatted);

        // Loop through ciphertext and decrypt then return
        const data = ciphertextFormatted
          .map((block) => decipher.update(block))
          .map((block) => block.toString('hex'));
        decipher.final();
        return data;
      } catch (err) {
        if (!(err instanceof Error)) {
          throw err;
        }
        throw new Error('Unable to decrypt ciphertext.');
      }
    },
  },
  ctr: {
    /**
     * Encrypt blocks of data with AES-256-CTR
     * @param plaintext - plaintext to encrypt
     * @param key - key to encrypt with
     * @returns ciphertext bundle
     */
    encrypt(plaintext: string[], key: BytesData): CTRCiphertext {
      // If types are strings, convert to bytes array
      const plaintextFormatted = plaintext.map((block) => new Uint8Array(arrayify(block)));
      const keyFormatted = new Uint8Array(arrayify(key));
      if (keyFormatted.byteLength !== 32) {
        throw new Error(
          `Invalid key length. Expected 32 bytes. Received ${keyFormatted.byteLength} bytes.`,
        );
      }

      const iv = randomHex(16);
      const ivFormatted = new Uint8Array(arrayify(iv));

      // Initialize cipher
      const cipher = crypto.createCipheriv('aes-256-ctr', keyFormatted, ivFormatted);

      // Loop through data blocks and encrypt
      const data = plaintextFormatted
        .map((block) => cipher.update(block))
        .map((block) => block.toString('hex'));
      cipher.final();

      // Return encrypted data bundle
      return {
        iv: formatToByteLength(ivFormatted, ByteLength.UINT_128, false),
        data,
      };
    },

    /**
     * Decrypts AES-256-CTR encrypted data
     * On failure, it throws `Unsupported state or unable to authenticate data`
     * @param ciphertext - ciphertext bundle to decrypt
     * @param key - key to decrypt with
     * @returns - plaintext
     */
    decrypt(ciphertext: CTRCiphertext, key: BytesData): string[] {
      // If types are strings, convert to bytes array
      const ciphertextFormatted = ciphertext.data.map((block) => new Uint8Array(arrayify(block)));
      const keyFormatted = new Uint8Array(arrayify(padToLength(key, 32)));
      const ivFormatted = new Uint8Array(arrayify(trim(ciphertext.iv, 16)));

      // Initialize decipher
      const decipher = crypto.createDecipheriv('aes-256-ctr', keyFormatted, ivFormatted);

      // Loop through ciphertext and decrypt then return
      const data = ciphertextFormatted
        .map((block) => decipher.update(block))
        .map((block) => block.toString('hex'));
      decipher.final();
      return data;
    },
  },
};

export { aes };
