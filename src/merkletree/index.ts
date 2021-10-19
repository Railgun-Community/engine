/* eslint-disable no-underscore-dangle */
import type { AbstractBatch } from 'abstract-leveldown';
import Database from '../database';
import utils from '../utils';

class MerkleTree {
  private _treeNumber: string;

  private _db: Database;

  private _chainID: string;

  private _zeros: BigInt[]

  private _initializeZeros() {
    this._zeros.push(utils.constants.MERKLE_ZERO_VALUE);
    for (let level = 1; level < utils.constants.MERKLE_TREE_DEPTH; level += 1) {
      this._zeros.push(utils.hash.hashLeftRight(this._zeros[level - 1], this._zeros[level - 1]));
    }
  }

  private async _access(level: number, index: number) {
    try {
      return BigInt(await this._db.get([this._chainID, 'MerkleTree', this._treeNumber, `${level}`, `${index}`]));
    } catch {
      return this._zeros[level];
    }
  }

  private _getKey(level: number, index: number) {
    return [
      this._chainID,
      'MerkleTree'.padStart(64, '0'),
      this._treeNumber,
      `${level}`.padStart(64, '0'),
      `${index}`.padStart(64, '0')];
  }

  constructor(db: Database, chainID = '0', treeNumber = '0') {
    this._db = db;
    this._chainID = chainID.padStart(64, '0');
    this._treeNumber = treeNumber.padStart(64, '0');
    this._zeros = [];
    this._initializeZeros();
  }

  async insertLeaves(leaves: string[], positions: number[]) {
    const batch :AbstractBatch[] = [];
    for (let i = 0; i < leaves.length; i += 1) {
      batch.push({ type: 'put', key: this._getKey(0, positions[i]), value: leaves[i] });
    }
    await this._db.batch(batch);
  }
}
export default {
  MerkleTree,
};
