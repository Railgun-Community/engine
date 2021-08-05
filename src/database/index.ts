import * as level from 'level';

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
      this.level = level(levelStore);
    } else {
      this.level = levelStore;
    }
  }
}

export default Database;
