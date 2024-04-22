import type { AbstractBatch, AbstractLevelDOWN } from 'abstract-leveldown';
import encode from 'encoding-down';
import type { LevelUp } from 'levelup';
import levelup from 'levelup';
import EventEmitter from 'events';
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
type LevelWithIndexedDB = {
  db: {
    db: {
      location: string;
      db: IDBDatabase;
    };
    codec: {
      encodings: Record<
        string,
        {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          decode: (value: ArrayBuffer) => any;
        }
      >;
    };
  };
};

type MaybeIndexedDB = {
  [Key1 in keyof LevelWithIndexedDB]?: {
    [Key2 in keyof LevelWithIndexedDB[Key1]]?: LevelWithIndexedDB[Key1][Key2];
  };
};

type DatabaseWithIndexedDB = Database & {
  readonly level: LevelUp & LevelWithIndexedDB;
};

/** Database class */
class Database {
  readonly level: LevelUp & MaybeIndexedDB;

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

  private usesIndexedDB(): this is DatabaseWithIndexedDB {
    return typeof indexedDB !== 'undefined' && typeof this.level.db?.db?.db !== 'undefined';
  }

  private getIndexedDBStore(this: DatabaseWithIndexedDB): IDBObjectStore {
    const { location } = this.level.db.db;
    const idb = this.level.db.db.db;
    const transaction = idb.transaction([location], 'readonly');
    return transaction.objectStore(location);
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
  async put(path: Path, value: any, encoding: Encoding = 'hex'): Promise<void> {
    try {
      if (this.isClosed()) {
        return;
      }
      if (this.isClearingNamespace) {
        EngineDebug.log('Database is clearing a namespace - put action is dangerous');
      }
      const key = Database.pathToKey(path);
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
  async batch(ops: AbstractBatch[], encoding: Encoding = 'hex'): Promise<void> {
    try {
      if (this.isClosed()) {
        return;
      }
      if (this.isClearingNamespace) {
        EngineDebug.log('Database is clearing a namespace - batch action is dangerous');
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
   * @param value - value to decode
   * @param encoding - data encoding to use
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private decode(this: DatabaseWithIndexedDB, value: ArrayBuffer, encoding: Encoding): any {
    const { encodings } = this.level.db.codec;
    if (typeof encodings[encoding] === 'undefined') throw new Error(`Unknown encoding ${encoding}`);
    // Special case for decoding already-decoded JSON objects:
    if (encoding === 'json' && !ArrayBuffer.isView(value) && typeof value === 'object') {
      return value;
    }
    return encodings[encoding].decode(Buffer.from(value));
  }

  /**
   * Gets stream of keys and/or values in namespace
   * @param namespace - namespace to stream from
   * @param keys - whether or not to include keys in results (default true)
   * @param values - whether or not to include values in results (default false)
   * @returns namespace "Emitter" stream
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
   * Gets stream of values in range between two keys
   * @param start - start path (inclusive)
   * @param end - end path (inclusive)
   * @param encoding - data encoding to use
   * @returns namespace "Emitter" stream
   */
  streamRange(start: Path, end: Path, encoding: Encoding = 'hex') {
    const startKey = Database.pathToKey(start);
    const endKey = Database.pathToKey(end);
    if (this.usesIndexedDB()) {
      const store = this.getIndexedDBStore();
      const lower = new TextEncoder().encode(`${startKey}`);
      const upper = new TextEncoder().encode(`${endKey}`);
      const range = IDBKeyRange.bound(lower, upper);
      const request = store.getAll(range);
      const emitter = new EventEmitter();
      request.onsuccess = (ev: Event) => {
        const values: Array<ArrayBuffer> = (ev.target as IDBRequest<ArrayBuffer[]>).result;
        for (const value of values) {
          emitter.emit('data', this.decode(value, encoding));
        }
        emitter.emit('end');
      };
      request.onerror = (ev: Event) => {
        emitter.emit('error', (ev.target as IDBRequest).error);
      };
      return emitter;
    }
    return this.level.createReadStream({
      gte: startKey,
      lte: endKey,
      keys: false,
      values: true,
      valueEncoding: encoding,
    });
  }

  /**
   * Gets all keys in namespace
   * @param namespace - namespace to stream from
   * @returns list of keys
   */
  getNamespaceKeys(namespace: string[]): Promise<string[]> {
    return new Promise((resolve, reject) => {
      if (this.usesIndexedDB()) {
        // Web-only (IndexedDB) optimization to use getAllKeys() (fast)
        const pathkey = Database.pathToKey(namespace);
        const store = this.getIndexedDBStore();
        const lower = new TextEncoder().encode(`${pathkey}`);
        const upper = new TextEncoder().encode(`${pathkey}~`);
        const range = IDBKeyRange.bound(lower, upper);
        const request = store.getAllKeys(range);
        request.onsuccess = (ev: Event) => {
          const keys: Array<ArrayBuffer> = (ev.target as IDBRequest<ArrayBuffer[]>).result;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const keysStrings: Array<string> = keys as any as Array<string>;
          for (let i = 0; i < keys.length; i += 1) {
            keysStrings[i] = new TextDecoder().decode(keys[i]);
          }
          resolve(keysStrings);
        };
        request.onerror = (ev: Event) => {
          reject((ev.target as IDBRequest).error);
        };
      } else {
        // Stream list of keys and resolve on end
        const keyList: string[] = [];
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
    return new Promise((resolve, reject) => {
      if (this.usesIndexedDB()) {
        // Web-only (IndexedDB) optimization to use count() (fast)
        const pathkey = Database.pathToKey(namespace);
        const store = this.getIndexedDBStore();
        const lower = new TextEncoder().encode(`${pathkey}`);
        const upper = new TextEncoder().encode(`${pathkey}~`);
        const range = IDBKeyRange.bound(lower, upper);
        const request = store.count(range);
        request.onsuccess = () => {
          resolve(request.result);
        };
        request.onerror = (ev: Event) => {
          reject((ev.target as IDBRequest).error);
        };
      } else {
        // Stream list of keys for namespace* and counts them
        let keyNumber = 0;
        this.streamNamespace(namespace)
          .on('data', () => {
            // Increment keynumber
            keyNumber += 1;
          })
          .on('end', () => {
            // Return keynumber
            resolve(keyNumber);
          });
      }
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
