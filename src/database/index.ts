import levelup from 'levelup';
import encode from 'encoding-down';
import type { AbstractLevelDOWN, AbstractBatch } from 'abstract-leveldown';
import type { LevelUp } from 'levelup';
import utils from '../utils';

import type { BytesData } from '../utils/bytes';
import type { Ciphertext } from '../utils/encryption';

// TODO: Remove JSON encoding and standardize everything as msgpack
export type Encoding = 'utf8' | 'json' | 'binary' | 'hex' | 'ascii' | 'base64' | 'ucs2' | 'utf16le' | 'utf-16le';

/** Database class */
class Database {
  /** Levelup store */
  readonly level: LevelUp;

  /**
   * Create a Database object from levelDB store
   * @param leveldown - abstract-leveldown compatible store
   */
  constructor(leveldown: AbstractLevelDOWN) {
    // Create levelDB database from leveldown store
    this.level = levelup(encode(
      leveldown,
    ));
  }

  /**
   * Parses path and returns key
   * @param path - path to covert
   * @returns key
   */
  static pathToKey(path: BytesData[]): string {
    // Convert to hex string, pad to 32 bytes, and join with :
    return path.map(
      (element) => utils.bytes.hexlify(element).toLowerCase().padStart(64, '0'),
    ).join(':');
  }

  /**
   * Set value in database
   * @param path - database path
   * @param value - value to set
   * @param encoding - data encoding to use
   * @returns complete
   */
  put(path: BytesData[], value: any, encoding: Encoding = 'hex'): Promise<void> {
    const key = Database.pathToKey(path);
    return this.level.put(key, value, { valueEncoding: encoding });
  }

  /**
   * Get value from database
   * @param path - database path
   * @param encoding - data encoding to use
   * @returns value
   */
  get(path: BytesData[], encoding: Encoding = 'hex'): Promise<any> {
    const key = Database.pathToKey(path);
    return this.level.get(key, { valueEncoding: encoding });
  }

  /**
   * Delete value from database
   * @param path - database path
   * @param encoding - data encoding to use
   * @returns complete
   */
  del(path: BytesData[], encoding: Encoding = 'hex'): Promise<void> {
    const key = Database.pathToKey(path);
    return this.level.del(key, { valueEncoding: encoding });
  }

  /**
   * Perform batch operation on database
   * @param ops - operations to perform
   * @param encoding - data encoding to use
   * @returns complete
   */
  batch(ops: AbstractBatch[], encoding: Encoding = 'hex'): Promise<void> {
    return this.level.batch(ops, { valueEncoding: encoding });
  }

  /**
   * Set encrypted value in database
   * @param path - database path
   * @param encryptionKey - AES-256-CTR encryption key
   * @param value - value to encrypt and set
   */
  async putEncrypted(path: BytesData[], encryptionKey: BytesData, value: BytesData) {
    // Encrypt data
    const encrypted = utils.encryption.aes.ctr.encrypt(utils.bytes.chunk(value), encryptionKey);

    // Write to database
    await this.put(path, encrypted, 'json');
  }

  /**
   * Get encrypted value in database
   * @param path - database path
   * @param encryptionKey - AES-256-CTR  encryption key
   * @return decrypted value
   */
  async getEncrypted(path: BytesData[], encryptionKey: BytesData): Promise<BytesData> {
    // Read from database
    const encrypted: Ciphertext = await this.get(path, 'json');

    // Decrypt and return
    return utils.bytes.combine(
      utils.encryption.aes.ctr.decrypt(encrypted, encryptionKey),
    );
  }

  /**
   * Gets stream of keys and/or values in namespace
   * @param namespace - namespace to stream from
   * @returns namespace stream
   */
  streamNamespace(
    namespace: BytesData[],
    keys: boolean = true,
    values: boolean = false,
  ) {
    const pathkey = Database.pathToKey(namespace);
    return this.level.createReadStream({
      gte: `${pathkey}`,
      lte: `${pathkey}~`,
      keys,
      values,
    });
  }

  /**
   * Delete all keys in namespace
   * @param namespace - namespace to delete
   * @returns complete
   */
  clearNamespace(namespace: BytesData[]): Promise<void> {
    return new Promise((resolve) => {
      const deleteOperations: AbstractBatch[] = [];

      // Create read stream for namespace*
      this.streamNamespace(namespace).on('data', (key: string) => {
        // Push key to batch delete array
        deleteOperations.push({
          type: 'del',
          key,
        });
      }).on('end', () => {
        // Run batch delete and resolve
        this.batch(deleteOperations).then(resolve);
      });
    });
  }

  /**
   * Counnts number of keys in namespace
   * @param namespace - namespace to count keys in
   * @returns number of keys in namespace
   */
  countNamespace(namespace: BytesData[]): Promise<number> {
    return new Promise((resolve) => {
      let keyNumber = 0;

      // Create read stream for namespace*
      this.streamNamespace(namespace).on('data', () => {
        // Increment keynumber
        keyNumber += 1;
      }).on('end', () => {
        // Return keynumber
        resolve(keyNumber);
      });
    });
  }
}

export default Database;
