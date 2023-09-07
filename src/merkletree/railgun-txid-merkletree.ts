import { Database } from '../database/database';
import { Chain } from '../models/engine-types';
import { RootValidator, TREE_MAX_ITEMS } from '../models/merkletree-types';
import { Merkletree } from './merkletree';
import { RailgunTransactionWithTxid } from '../models/formatted-types';

export class RailgunTXIDMerkletree extends Merkletree<RailgunTransactionWithTxid> {
  // DO NOT MODIFY
  protected merkletreePrefix = 'railgun-transaction-ids';

  protected merkletreeType = 'Railgun TXID';

  private constructor(db: Database, chain: Chain, rootValidator: RootValidator) {
    super(db, chain, rootValidator);
  }

  static async create(
    db: Database,
    chain: Chain,
    rootValidator: RootValidator,
  ): Promise<RailgunTXIDMerkletree> {
    const merkletree = new RailgunTXIDMerkletree(db, chain, rootValidator);
    await merkletree.init();
    return merkletree;
  }

  /**
   * Gets Commitment from UTXO tree
   */
  async getRailgunTransaction(tree: number, index: number): Promise<RailgunTransactionWithTxid> {
    try {
      const railgunTransaction = (await this.db.get(
        this.getDataDBPath(tree, index),
        'json',
      )) as RailgunTransactionWithTxid;
      return railgunTransaction;
    } catch (err) {
      if (!(err instanceof Error)) {
        throw err;
      }
      throw new Error(err.message);
    }
  }

  async clearLeavesStartingAtTxidIndex(txidIndex: number) {
    // Lock for updates
    this.lockUpdates = true;

    // Remove any queued items
    this.writeQueue = [];

    const { tree, index } = RailgunTXIDMerkletree.getTreeAndIndexFromTxidIndex(txidIndex);

    // TODO:
    // - Iterate through, starting at end of latest tree, ending at tree and index
    // - Calculate merkleroot, and find/delete it from merkleroot db
    // - Delete leaf

    this.lockUpdates = false;
  }

  async getCurrentTXIDIndex(): Promise<number> {
    const { tree, index } = await this.getLatestTreeAndIndex();
    return tree * TREE_MAX_ITEMS + index;
  }

  private static getTreeAndIndexFromTxidIndex(txidIndex: number): {
    tree: number;
    index: number;
  } {
    return {
      tree: Math.floor(txidIndex / TREE_MAX_ITEMS),
      index: txidIndex % TREE_MAX_ITEMS,
    };
  }

  // eslint-disable-next-line class-methods-use-this, @typescript-eslint/no-unused-vars
  protected validRootCallback(tree: number, lastValidLeafIndex: number): Promise<void> {
    // Unused
    return Promise.resolve();
  }

  // eslint-disable-next-line class-methods-use-this
  protected invalidRootCallback(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    tree: number,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    lastKnownInvalidLeafIndex: number,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    lastKnownInvalidLeaf: RailgunTransactionWithTxid,
  ): Promise<void> {
    // Unused
    return Promise.resolve();
  }
}
