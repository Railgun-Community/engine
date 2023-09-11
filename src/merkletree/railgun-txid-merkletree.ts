import BN from 'bn.js';
import { Database } from '../database/database';
import { Chain } from '../models/engine-types';
import {
  CommitmentProcessingGroupSize,
  MerklerootValidator,
  TREE_MAX_ITEMS,
} from '../models/merkletree-types';
import { Merkletree } from './merkletree';
import { RailgunTransaction, RailgunTransactionWithTxid } from '../models/formatted-types';
import { ByteLength, formatToByteLength, fromUTF8String, hexlify } from '../utils/bytes';
import { createRailgunTransactionWithID } from '../transaction/railgun-txid';
import { isDefined } from '../utils';

export class RailgunTXIDMerkletree extends Merkletree<RailgunTransactionWithTxid> {
  // DO NOT MODIFY
  protected merkletreePrefix = 'railgun-transaction-ids';

  protected merkletreeType = 'Railgun TXID';

  private shouldStoreMerkleroots: boolean;

  private constructor(
    db: Database,
    chain: Chain,
    merklerootValidator: MerklerootValidator,
    shouldStoreMerkleroots: boolean,
  ) {
    // For TXID merkletree on POI Nodes, we will calculate for every Single tree update, in order to capture its merkleroot.
    const commitmentProcessingGroupSize = shouldStoreMerkleroots
      ? CommitmentProcessingGroupSize.Single
      : CommitmentProcessingGroupSize.XXXLarge;

    super(db, chain, merklerootValidator, commitmentProcessingGroupSize);
    this.shouldStoreMerkleroots = shouldStoreMerkleroots;
  }

  /**
   * Wallet validates merkleroots against POI Nodes.
   */
  static async createForWallet(
    db: Database,
    chain: Chain,
    merklerootValidator: MerklerootValidator,
  ): Promise<RailgunTXIDMerkletree> {
    const shouldStoreMerkleroots = false;
    const merkletree = new RailgunTXIDMerkletree(
      db,
      chain,
      merklerootValidator,
      shouldStoreMerkleroots,
    );
    await merkletree.init();
    return merkletree;
  }

  /**
   * POI Node is the source of truth, so it will not validate merkleroots.
   * Instead, it will process every tree update individually, and store each in the database.
   */
  static async createForPOINode(db: Database, chain: Chain): Promise<RailgunTXIDMerkletree> {
    // Assume all merkleroots are valid.
    const merklerootValidator = async () => true;

    // For TXID merkletree on POI Nodes, store all merkleroots.
    const shouldStoreMerkleroots = true;

    const merkletree = new RailgunTXIDMerkletree(
      db,
      chain,
      merklerootValidator,
      shouldStoreMerkleroots,
    );
    await merkletree.init();
    return merkletree;
  }

  /**
   * Gets Railgun Transaction data from txid tree.
   */
  async getRailgunTransaction(
    tree: number,
    index: number,
  ): Promise<Optional<RailgunTransactionWithTxid>> {
    try {
      return await this.getData(tree, index);
    } catch (err) {
      return undefined;
    }
  }

  async getLatestGraphID(): Promise<Optional<string>> {
    const { tree, index } = await this.getLatestTreeAndIndex();
    const railgunTransaction = await this.getRailgunTransaction(tree, index);
    return railgunTransaction?.graphID;
  }

  async queueRailgunTransactions(
    railgunTransactions: RailgunTransaction[],
    maxTxidIndex: Optional<number>,
  ): Promise<void> {
    const { tree: latestTree, index: latestIndex } = await this.getLatestTreeAndIndex();
    let nextTree = latestTree;
    let nextIndex = latestIndex;

    for (let i = 0; i < railgunTransactions.length; i += 1) {
      const { tree, index } = RailgunTXIDMerkletree.nextTreeAndIndex(nextTree, nextIndex);
      nextTree = tree;
      nextIndex = index;
      if (RailgunTXIDMerkletree.isOutOfBounds(nextTree, nextIndex, maxTxidIndex)) {
        return;
      }

      const railgunTransaction = railgunTransactions[i];
      const railgunTransactionWithID: RailgunTransactionWithTxid =
        createRailgunTransactionWithID(railgunTransaction);

      // eslint-disable-next-line no-await-in-loop
      await this.queueLeaves(nextTree, nextIndex, [railgunTransactionWithID]);
    }
  }

  static isOutOfBounds(tree: number, index: number, maxTxidIndex?: number) {
    if (!isDefined(maxTxidIndex)) {
      return false;
    }
    return RailgunTXIDMerkletree.getTXIDIndex(tree, index) > maxTxidIndex;
  }

  static nextTreeAndIndex(tree: number, index: number): { tree: number; index: number } {
    if (index + 1 >= TREE_MAX_ITEMS) {
      return { tree: tree + 1, index: 0 };
    }
    return { tree, index: index + 1 };
  }

  async clearLeavesAfterTxidIndex(txidIndex: number): Promise<void> {
    // Lock for updates
    this.lockUpdates = true;

    // Remove any queued items
    this.writeQueue = [];

    const { tree, index } = RailgunTXIDMerkletree.getTreeAndIndexFromTxidIndex(txidIndex);

    const { tree: latestTree, index: latestIndex } = await this.getLatestTreeAndIndex();

    for (let currentTree = tree; currentTree <= latestTree; currentTree += 1) {
      const startIndex = currentTree === tree ? index + 1 : 0;
      const max = currentTree === latestTree ? latestIndex : TREE_MAX_ITEMS - 1;
      for (let currentIndex = startIndex; currentIndex <= max; currentIndex += 1) {
        // eslint-disable-next-line no-await-in-loop
        await this.db.del(this.getHistoricalMerklerootDBPath(currentTree, currentIndex));
        // eslint-disable-next-line no-await-in-loop
        await this.db.del(this.getDataDBPath(currentTree, currentIndex));
      }
      // eslint-disable-next-line no-await-in-loop
      await this.clearAllNodeHashes(currentTree);
    }

    for (let currentTree = tree; currentTree <= latestTree; currentTree += 1) {
      // eslint-disable-next-line no-await-in-loop
      await this.rebuildAndWriteTree(currentTree);

      // eslint-disable-next-line no-await-in-loop
      await this.resetTreeLength(currentTree);

      // eslint-disable-next-line no-await-in-loop
      await this.updateStoredMerkletreesMetadata(currentTree);
    }

    // Unlock updates
    this.lockUpdates = false;
  }

  async getCurrentTXIDIndex(): Promise<number> {
    const { tree, index } = await this.getLatestTreeAndIndex();
    return RailgunTXIDMerkletree.getTXIDIndex(tree, index);
  }

  static getTXIDIndex(tree: number, index: number): number {
    return tree * TREE_MAX_ITEMS + index;
  }

  static getTreeAndIndexFromTxidIndex(txidIndex: number): {
    tree: number;
    index: number;
  } {
    return {
      tree: Math.floor(txidIndex / TREE_MAX_ITEMS),
      index: txidIndex % TREE_MAX_ITEMS,
    };
  }

  // eslint-disable-next-line class-methods-use-this
  protected validRootCallback(): Promise<void> {
    // Unused for TXID merkletree
    return Promise.resolve();
  }

  // eslint-disable-next-line class-methods-use-this
  protected invalidRootCallback(): Promise<void> {
    // Unused for TXID merkletree
    return Promise.resolve();
  }

  private getHistoricalMerklerootDBPath(tree: number, index: number): string[] {
    const merklerootPrefix = fromUTF8String('merkleroots');
    return [
      ...this.getChainDBPrefix(),
      merklerootPrefix,
      hexlify(new BN(tree)),
      hexlify(new BN(index)),
    ].map((el) => formatToByteLength(el, ByteLength.UINT_256));
  }

  protected async storeMerkleroot(tree: number, index: number, merkleroot: string): Promise<void> {
    if (!this.shouldStoreMerkleroots) {
      return;
    }
    await this.db.put(this.getHistoricalMerklerootDBPath(tree, index), merkleroot);
  }

  async getHistoricalMerkleroot(tree: number, index: number): Promise<Optional<string>> {
    try {
      const merkleroot = (await this.db.get(
        this.getHistoricalMerklerootDBPath(tree, index),
      )) as string;
      return merkleroot;
    } catch (err) {
      if (!(err instanceof Error)) {
        throw err;
      }
      return undefined;
    }
  }

  async getHistoricalMerklerootForTxidIndex(txidIndex: number): Promise<Optional<string>> {
    const { tree, index } = RailgunTXIDMerkletree.getTreeAndIndexFromTxidIndex(txidIndex);
    return this.getHistoricalMerkleroot(tree, index);
  }
}
