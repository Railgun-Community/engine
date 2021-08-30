import levelup from 'levelup';
import encode from 'encoding-down';
import type { AbstractLevelDOWN, AbstractBatch } from 'abstract-leveldown';
import type { LevelUp } from 'levelup';
import utils from '../utils';
import type { BytesData } from '../utils/globaltypes';

type Encoding = 'utf8' | 'json' | 'binary' | 'hex' | 'ascii' | 'base64' | 'ucs2' | 'utf16le' | 'utf-16le';

/** Database class */
class Database {
  /** Levelup store */
  level: LevelUp;

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
  static pathToKey(path: Array<BytesData>): string {
    return path.map((element) => {
      // If type string then pad start to 64 charectors (32 bytes) and lower case
      if (typeof element === 'string') {
        return element.toLowerCase().padStart(64, '0');
      }

      // If type arraylike then convert to hex string and
      // pad start to 64 charectors (32 bytes) and lower case
      return utils.convert.hexlify(element).toLowerCase().padStart(64, '0');
    }).join(':');
  }

  /**
   * Set value in database
   * @param path - database path
   * @param value - value to set
   * @param encoding - data encoding to use
   * @returns complete
   */
  put(path: Array<BytesData>, value: any, encoding: Encoding = 'hex'): Promise<void> {
    const key = Database.pathToKey(path);
    return this.level.put(key, value, { valueEncoding: encoding });
  }

  /**
   * Get value from database
   * @param path - database path
   * @param encoding - data encoding to use
   * @returns value
   */
  get(path: Array<BytesData>, encoding: Encoding = 'hex'): Promise<any> {
    const key = Database.pathToKey(path);
    return this.level.get(key, { valueEncoding: encoding });
  }

  /**
   * Delete value from database
   * @param path - database path
   * @param encoding - data encoding to use
   * @returns complete
   */
  del(path: Array<BytesData>, encoding: Encoding = 'hex'): Promise<void> {
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
   * Delete all keys in namespace
   * @param namespace - namespace to delete
   * @returns complete
   */
  clearNamespace(namespace: Array<BytesData>): Promise<void> {
    const pathkey = Database.pathToKey(namespace);

    return new Promise((resolve) => {
      const deleteOperations: AbstractBatch[] = [];

      // Create read stream for namespace*
      this.level.createKeyStream({
        gte: `${pathkey}`,
        lte: `${pathkey}~`,
      }).on('data', (key: string) => {
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
}

export default Database;
