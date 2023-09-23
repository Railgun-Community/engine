import type { AbstractBatch, AbstractLevelDOWN } from 'abstract-leveldown';
import encode from 'encoding-down';
import type { LevelUp } from 'levelup';
import levelup from 'levelup';
import { BytesData, Ciphertext } from '../models/formatted-types';
import { chunk, combine, hexlify } from '../utils/bytes';
import { AES } from '../utils/encryption';

export type Encoding =
  | 'utf8'
  | 'json'
  | 'binary'
  | 'hex'
  | 'ascii'
  | 'base64'
  | 'ucs2'
  | 'utf16le'
  | 'utf-16le';

export enum DatabaseNamespace {
  ChainSyncInfo = 'chain_sync_info',
}

type Path = BytesData[];

/** Database class */
class Database {
  readonly level: LevelUp;

  /**
   * Create a Database object from levelDB store
   * @param leveldown - abstract-leveldown compatible store
   */
  constructor(leveldown: AbstractLevelDOWN) {
    // Create levelDB database from leveldown store
    this.level = levelup(encode(leveldown));
  }

  isClosed() {
    return this.level.isClosed();
  }

  /**
   * Parses path and returns key
   * @param path - path to convert
   * @returns key
   */
  static pathToKey(path: Path): string {
    // Convert to hex string, pad to 32 bytes, and join with :
    return path.map((el) => hexlify(el).toLowerCase().padStart(64, '0')).join(':');
  }

  /**
   * Set value in database
   * @param path - database path
   * @param value - value to set
   * @param encoding - data encoding to use
   * @returns complete
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  put(path: Path, value: any, encoding: Encoding = 'hex'): Promise<void> {
    const key = Database.pathToKey(path);
    return this.level.put(key, value, { valueEncoding: encoding });
  }

  /**
   * Get value from database
   * @param path - database path
   * @param encoding - data encoding to use
   * @returns value
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  get(path: Path, encoding: Encoding = 'hex'): Promise<any> {
    const key = Database.pathToKey(path);
    return this.level.get(key, { valueEncoding: encoding });
  }

  /**
   * Delete value from database
   * @param path - database path
   * @param encoding - data encoding to use
   * @returns complete
   */
  del(path: Path, encoding: Encoding = 'hex'): Promise<void> {
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
   * @param encryptionKey - AES-256-GCM encryption key
   * @param value - value to encrypt and set
   */
  async putEncrypted(path: Path, encryptionKey: string, value: string | Buffer) {
    // Encrypt data
    const encrypted = AES.encryptGCM(chunk(value), encryptionKey);

    // Write to database
    await this.put(path, encrypted, 'json');
  }

  /**
   * Get encrypted value in database
   * @param path - database path
   * @param encryptionKey - AES-256-GCM  encryption key
   * @return decrypted value
   */
  async getEncrypted(path: Path, encryptionKey: string): Promise<string> {
    // Read from database
    const encrypted: Ciphertext = (await this.get(path, 'json')) as Ciphertext;

    // Decrypt and return
    return combine(AES.decryptGCM(encrypted, encryptionKey));
  }

  /**
   * Gets stream of keys and/or values in namespace
   * @param namespace - namespace to stream from
   * @returns namespace stream
   */
  streamNamespace(namespace: string[], keys: boolean = true, values: boolean = false) {
    const pathkey = Database.pathToKey(namespace);
    return this.level.createReadStream({
      gte: `${pathkey}`,
      lte: `${pathkey}~`,
      keys,
      values,
    });
  }

  /**
   * Gets all keys in namespace
   * @param namespace - namespace to stream from
   * @returns list of keys
   */
  getNamespaceKeys(namespace: string[]): Promise<string[]> {
    return new Promise((resolve) => {
      const keyList: string[] = [];

      // Stream list of keys and resolve on end
      this.streamNamespace(namespace)
        .on('data', (key: string) => {
          keyList.push(key);
        })
        .on('end', () => {
          resolve(keyList);
        });
    });
  }

  /**
   * Delete all keys in namespace
   * @param namespace - namespace to delete
   * @returns complete
   */
  async clearNamespace(namespace: string[]): Promise<void> {
    const pathkey = Database.pathToKey(namespace);
    await this.level.clear({
      gte: `${pathkey}`,
      lte: `${pathkey}~`,
    });
  }

  /**
   * Counnts number of keys in namespace
   * @param namespace - namespace to count keys in
   * @returns number of keys in namespace
   */
  countNamespace(namespace: string[]): Promise<number> {
    return new Promise((resolve) => {
      let keyNumber = 0;

      // Create read stream for namespace*
      this.streamNamespace(namespace)
        .on('data', () => {
          // Increment keynumber
          keyNumber += 1;
        })
        .on('end', () => {
          // Return keynumber
          resolve(keyNumber);
        });
    });
  }

  /**
   * Closes DB connections and cleans up listeners
   */
  async close() {
    await this.level.close();
  }
}

export { Database };
