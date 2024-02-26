import type { AbstractBatch, AbstractLevelDOWN } from 'abstract-leveldown';
import encode from 'encoding-down';
import type { LevelUp } from 'levelup';
import levelup from 'levelup';
import { BytesData, Ciphertext } from '../models/formatted-types';
import { chunk, combine, hexlify } from '../utils/bytes';
import { AES } from '../utils/encryption/aes';
import EngineDebug from '../debugger/debugger';

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

/** These properties exist on the level-js instance in the browser. */
type MaybeIndexedDB = {
  db?: {
    db?: {
      location: string;
      db: IDBDatabase;
    };
    codec: {
      encodings: Record<
        string,
        {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          encode: (value: any) => ArrayBuffer;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          decode: (value: ArrayBuffer) => any;
        }
      >;
    };
  };
};

/** Database class */
class Database {
  readonly level: LevelUp & MaybeIndexedDB;

  private preloaded: Promise<void> | undefined;

  private preloadedMap: Map<string, ArrayBuffer> | undefined;

  private isClearingNamespace: boolean = false;

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
   * If the database is IndexedDB, preload all keys and values into memory, as a
   * cache. Otherwise, does nothing.
   */
  async preload() {
    if (typeof indexedDB === 'undefined') return;
    if (typeof this.level.db?.db?.db === 'undefined') return;

    this.preloaded ??= new Promise((resolve, reject) => {
      if (typeof this.level.db?.db?.db === 'undefined') return;
      const { location } = this.level.db.db;
      const idb = this.level.db.db.db;
      const transaction = idb.transaction([location], 'readwrite');
      const store = transaction.objectStore(location);
      const range = IDBKeyRange.lowerBound(0);
      let preloadedKeys: ArrayBuffer[] | undefined;
      let preloadedValues: ArrayBuffer[] | undefined;
      const done = () => {
        this.preloadedMap = new Map();
        if (!preloadedKeys) return;
        if (!preloadedValues) return;
        for (let i = 0; i < preloadedKeys.length; i += 1) {
          const key = new TextDecoder().decode(preloadedKeys[i]);
          this.preloadedMap.set(key, preloadedValues[i]);
        }
        preloadedKeys = undefined;
        preloadedValues = undefined;
        resolve();
      };
      const keysRequest = store.getAllKeys(range);
      keysRequest.onsuccess = (ev: Event) => {
        preloadedKeys = (ev.target as IDBRequest<ArrayBuffer[]>).result;
        if (typeof preloadedValues !== 'undefined') done();
      };
      keysRequest.onerror = (ev: Event) => {
        reject((ev.target as IDBRequest).error);
      }
      const valuesRequest = store.getAll(range);
      valuesRequest.onsuccess = (ev: Event) => {
        preloadedValues = (ev.target as IDBRequest<ArrayBuffer[]>).result;
        if (typeof preloadedKeys !== 'undefined') done();
      };
      valuesRequest.onerror = (ev: Event) => {
        reject((ev.target as IDBRequest).error);
      }
    });
    await this.preloaded;
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
   *
   * @param value - value to encode
   * @param encoding - data encoding to use
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  encode(value: any, encoding: Encoding): ArrayBuffer {
    if (!this.level.db?.codec) throw new Error('encode called on non-indexeddb database');
    const { encodings } = this.level.db.codec;
    if (typeof encodings[encoding] === 'undefined') throw new Error(`Unknown encoding ${encoding}`);
    return encodings[encoding].encode(value);
  }

  /**
   * @param value - value to decode
   * @param encoding - data encoding to use
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  decode(value: ArrayBuffer, encoding: Encoding): any {
    if (!this.level.db?.codec) throw new Error('decode called on non-indexeddb database');
    const { encodings } = this.level.db.codec;
    if (typeof encodings[encoding] === 'undefined') throw new Error(`Unknown encoding ${encoding}`);
    // Special case for decoding already-decoded JSON objects:
    if (encoding === 'json' && !ArrayBuffer.isView(value) && typeof value === 'object') {
      return value;
    }
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    return encodings[encoding].decode(Buffer.from(value));
  }

  /**
   * Set value in database
   * @param path - database path
   * @param value - value to set
   * @param encoding - data encoding to use
   * @returns complete
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async put(path: Path, value: any, encoding: Encoding = 'hex'): Promise<void> {
    try {
      if (this.isClosed()) {
        return;
      }
      if (this.isClearingNamespace) {
        EngineDebug.log('Database is clearing a namespace - put action is dangerous');
      }
      const key = Database.pathToKey(path);
      try {
        if (this.preloadedMap) {
          this.preloadedMap.set(key, this.encode(value, encoding));
        }
      } catch {
        // ignore
      }
      await this.level.put(key, value, { valueEncoding: encoding });
    } catch (cause) {
      if (!(cause instanceof Error)) {
        return;
      }
      if (EngineDebug.isTestRun() && cause.message.includes('Database is not open')) {
        return;
      }
      throw new Error('Failed to put value in database', { cause });
    }
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
    if (this.preloadedMap) {
      const value = this.preloadedMap.get(key);
      if (!value) return Promise.reject(new Error('NotFound'));
      let decoded;
      try {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        decoded = this.decode(value, encoding);
      } catch (err) {
        return Promise.reject(err);
      }
      return Promise.resolve(decoded);
    }
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
    if (this.preloadedMap) {
      this.preloadedMap.delete(key);
    }
    return this.level.del(key, { valueEncoding: encoding });
  }

  /**
   * Perform batch operation on database
   * @param ops - operations to perform
   * @param encoding - data encoding to use
   * @returns complete
   */
  async batch(ops: AbstractBatch[], encoding: Encoding = 'hex'): Promise<void> {
    try {
      if (this.isClosed()) {
        return;
      }
      if (this.isClearingNamespace) {
        EngineDebug.log('Database is clearing a namespace - batch action is dangerous');
      }
      if (this.preloadedMap) {
        ops.forEach((op) => {
          if (op.type === 'put') {
            this.preloadedMap?.set(op.key as string, this.encode(op.value, encoding));
          } else if (op.type === 'del') {
            this.preloadedMap?.delete(op.key as string);
          }
        });
      }
      await this.level.batch(ops, { valueEncoding: encoding });
    } catch (cause) {
      if (!(cause instanceof Error)) {
        return;
      }
      if (EngineDebug.isTestRun() && cause.message.includes('Database is not open')) {
        return;
      }
      throw new Error('Failed to perform batch operation on database', { cause });
    }
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

      if (typeof indexedDB !== 'undefined' && typeof this.level.db?.db?.db !== 'undefined') {
        // Web-only (IndexedDB) optimization to use getAllKeys (fast)
        const pathkey = Database.pathToKey(namespace);
        const { location } = this.level.db.db;
        const idb = this.level.db.db.db;
        const transaction = idb.transaction([location], 'readonly');
        const store = transaction.objectStore(location);
        const lower = new TextEncoder().encode(`${pathkey}`);
        const upper = new TextEncoder().encode(`${pathkey}~`);
        const range = IDBKeyRange.bound(lower, upper);
        store.getAllKeys(range).onsuccess = (ev: Event) => {
          const keys: Array<ArrayBuffer> = (ev.target as IDBRequest<ArrayBuffer[]>).result;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const keysStrings: Array<string> = keys as any as Array<string>;
          for (let i = 0; i < keys.length; i += 1) {
            keysStrings[i] = new TextDecoder().decode(keys[i]);
          }
          resolve(keysStrings);
        };
      } else {
        // Stream list of keys and resolve on end
        this.streamNamespace(namespace)
          .on('data', (key: string) => {
            keyList.push(key);
          })
          .on('end', () => {
            resolve(keyList);
          });
      }
    });
  }

  /**
   * Delete all keys in namespace
   * @param namespace - namespace to delete
   * @returns complete
   */
  async clearNamespace(namespace: string[]): Promise<void> {
    try {
      this.isClearingNamespace = true;
      const pathkey = Database.pathToKey(namespace);
      EngineDebug.log(`Clearing namespace: ${pathkey}`);
      if (this.preloadedMap) {
        this.preloadedMap.forEach((_, key) => {
          if (key.startsWith(pathkey)) {
            this.preloadedMap?.delete(key);
          }
        });
      }
      await this.level.clear({
        gte: `${pathkey}`,
        lte: `${pathkey}~`,
      });
      this.isClearingNamespace = false;
    } catch (cause) {
      this.isClearingNamespace = false;
      throw new Error('Failed to clear database namespace', { cause });
    }
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
