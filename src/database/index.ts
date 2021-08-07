import * as level from 'level';
import type { AbstractBatch } from 'abstract-leveldown';
import type { LevelUpChain } from 'levelup';

/** Database class */
class Database {
  /** Levelup store */
  level: level.LevelDB;

  /**
   * Create a Database object from levelDB store
   * @param levelStore - location string or levelDB object
   */
  constructor(levelStore: string | level.LevelDB) {
    if (typeof levelStore === 'string') {
      // Create database object using provided level store
      this.level = level(levelStore);
    } else {
      // Create database object with level store at location
      // Name of indexDB for browser, filesystem path for nodejs
      this.level = levelStore;
    }
  }

  /**
   * Set value in database
   * @param key - database key
   * @param value - value to set
   */
  put(key: string, value: string): Promise<void> {
    return this.level.put(key, value);
  }

  /**
   * Get value from database
   * @param key - database key
   */
  get(key: string): Promise<string> {
    return this.level.get(key);
  }

  /**
   * Delete value from database
   * @param key - database key
   */
  del(key: string): Promise<void> {
    return this.level.del(key);
  }

  /**
   * Perform chained batch operation on database
   */
  batch(): LevelUpChain {
    return this.level.batch();
  }

  /**
   * Perform batch operation on database
   */
  batchArray(ops: AbstractBatch[]): Promise<void> {
    return this.level.batch(ops);
  }

  /**
   * Delete all keys in namespace
   * @param namespace - namespace to delete
   */
  clearNamespace(namespace: string): Promise<void> {
    return new Promise((resolve) => {
      const deleteOperations: AbstractBatch[] = [];

      // Create read stream for namespace:*
      this.level.createKeyStream({
        gte: `${namespace}:`,
        lte: `${namespace}:~`,
      }).on('data', (key: string) => {
        // Push key to batch delete array
        deleteOperations.push({
          type: 'del',
          key,
        });
      }).on('end', () => {
        // Run batch delete and resolve
        this.batchArray(deleteOperations).then(resolve);
      });
    });
  }
}

export default Database;
