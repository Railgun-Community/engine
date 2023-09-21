import BN from 'bn.js';
import { Database } from '../database/database';
import { Chain } from '../models/engine-types';
import {
  CommitmentProcessingGroupSize,
  MerklerootValidator,
  TREE_MAX_ITEMS,
} from '../models/merkletree-types';
import { Merkletree } from './merkletree';
import { RailgunTxidMerkletreeData, RailgunTransactionWithTxid } from '../models/formatted-types';
import { ByteLength, formatToByteLength, fromUTF8String, hexlify } from '../utils/bytes';
import { isDefined } from '../utils';

export class RailgunTxidMerkletree extends Merkletree<RailgunTransactionWithTxid> {
  // DO NOT MODIFY
  protected merkletreePrefix = 'railgun-transaction-ids';

  protected merkletreeType = 'Railgun Txid';

  private shouldStoreMerkleroots: boolean;

  private constructor(
    db: Database,
    chain: Chain,
    merklerootValidator: MerklerootValidator,
    shouldStoreMerkleroots: boolean,
  ) {
    // For Txid merkletree on POI Nodes, we will calculate for every Single tree update, in order to capture its merkleroot.
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
  ): Promise<RailgunTxidMerkletree> {
    const shouldStoreMerkleroots = false;
    const merkletree = new RailgunTxidMerkletree(
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
  static async createForPOINode(db: Database, chain: Chain): Promise<RailgunTxidMerkletree> {
    // Assume all merkleroots are valid.
    const merklerootValidator = async () => true;

    // For Txid merkletree on POI Nodes, store all merkleroots.
    const shouldStoreMerkleroots = true;

    const merkletree = new RailgunTxidMerkletree(
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

  async getRailgunTxidCurrentMerkletreeData(
    railgunTxid: string,
  ): Promise<RailgunTxidMerkletreeData> {
    const txidIndex = await this.getTxidIndexByRailgunTxid(railgunTxid);
    if (!isDefined(txidIndex)) {
      throw new Error('txid index not found');
    }

    const { tree, index } = RailgunTxidMerkletree.getTreeAndIndexFromTxidIndex(txidIndex);
    const railgunTransaction = await this.getRailgunTransaction(tree, index);
    if (!isDefined(railgunTransaction)) {
      throw new Error('railgun transaction not found');
    }

    const currentIndex = await this.getLatestIndexForTree(tree);
    const currentMerkleProofForTree = await this.getMerkleProof(tree, currentIndex);

    const currentTxidIndexForTree = RailgunTxidMerkletree.getTxidIndex(tree, currentIndex);

    return {
      railgunTransaction,
      currentMerkleProofForTree,
      currentTxidIndexForTree,
    };
  }

  async getRailgunTxidsForNullifiers(
    nullifiers: string[],
  ): Promise<{ [nullifier: string]: Optional<string> }> {
    const nullifierToTxid: { [nullifier: string]: Optional<string> } = {};

    const railgunTransactions: RailgunTransactionWithTxid[] = await this.queryAllData();

    nullifiers.forEach((nullifier) => {
      const txid = railgunTransactions.find((tx) => tx?.nullifiers.includes(nullifier))?.hash;
      nullifierToTxid[nullifier] = txid;
    });

    return nullifierToTxid;
  }

  async getRailgunTxidsForCommitments(
    commitments: string[],
  ): Promise<{ [commitment: string]: Optional<string> }> {
    const commitmentToTxid: { [commitment: string]: Optional<string> } = {};

    const railgunTransactions: RailgunTransactionWithTxid[] = await this.queryAllData();

    commitments.forEach((commitment) => {
      const txid = railgunTransactions.find((tx) => tx?.commitments.includes(commitment))?.hash;
      commitmentToTxid[commitment] = txid;
    });

    return commitmentToTxid;
  }

  async getLatestGraphID(): Promise<Optional<string>> {
    const { tree, index } = await this.getLatestTreeAndIndex();
    const railgunTransaction = await this.getRailgunTransaction(tree, index);
    return railgunTransaction?.graphID;
  }

  async queueRailgunTransactions(
    railgunTransactionsWithTxids: RailgunTransactionWithTxid[],
    maxTxidIndex: Optional<number>,
  ): Promise<void> {
    const { tree: latestTree, index: latestIndex } = await this.getLatestTreeAndIndex();
    let nextTree = latestTree;
    let nextIndex = latestIndex;

    for (let i = 0; i < railgunTransactionsWithTxids.length; i += 1) {
      const { tree, index } = RailgunTxidMerkletree.nextTreeAndIndex(nextTree, nextIndex);
      nextTree = tree;
      nextIndex = index;
      if (RailgunTxidMerkletree.isOutOfBounds(nextTree, nextIndex, maxTxidIndex)) {
        return;
      }

      const railgunTransactionWithTxid = railgunTransactionsWithTxids[i];

      // eslint-disable-next-line no-await-in-loop
      await this.queueLeaves(nextTree, nextIndex, [railgunTransactionWithTxid]);
    }
  }

  static isOutOfBounds(tree: number, index: number, maxTxidIndex?: number) {
    if (!isDefined(maxTxidIndex)) {
      return false;
    }
    return RailgunTxidMerkletree.getTxidIndex(tree, index) > maxTxidIndex;
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

    // Clear cache
    this.cacheAllData = undefined;

    const { tree, index } = RailgunTxidMerkletree.getTreeAndIndexFromTxidIndex(txidIndex);

    const { tree: latestTree, index: latestIndex } = await this.getLatestTreeAndIndex();

    for (let currentTree = tree; currentTree <= latestTree; currentTree += 1) {
      const startIndex = currentTree === tree ? index + 1 : 0;
      const max = currentTree === latestTree ? latestIndex : TREE_MAX_ITEMS - 1;
      for (let currentIndex = startIndex; currentIndex <= max; currentIndex += 1) {
        // eslint-disable-next-line no-await-in-loop
        const railgunTransaction = await this.getRailgunTransaction(currentTree, currentIndex);
        if (isDefined(railgunTransaction)) {
          // eslint-disable-next-line no-await-in-loop
          await this.db.del(this.getRailgunTxidLookupDBPath(railgunTransaction.hash));
        }
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

  async getCurrentTxidIndex(): Promise<number> {
    const { tree, index } = await this.getLatestTreeAndIndex();
    return RailgunTxidMerkletree.getTxidIndex(tree, index);
  }

  static getTxidIndex(tree: number, index: number): number {
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
    // Unused for Txid merkletree
    return Promise.resolve();
  }

  // eslint-disable-next-line class-methods-use-this
  protected invalidRootCallback(): Promise<void> {
    // Unused for Txid merkletree
    return Promise.resolve();
  }

  private getRailgunTxidLookupDBPath(railgunTxid: string): string[] {
    const railgunTxidPrefix = fromUTF8String('railgun-txid-lookup');
    return [...this.getChainDBPrefix(), railgunTxidPrefix, railgunTxid].map((el) =>
      formatToByteLength(el, ByteLength.UINT_256),
    );
  }

  private async getTxidIndexByRailgunTxid(railgunTxid: string): Promise<Optional<number>> {
    try {
      const txidIndex = Number(
        (await this.db.get(this.getRailgunTxidLookupDBPath(railgunTxid))) as string,
      );
      return txidIndex;
    } catch (err) {
      if (!(err instanceof Error)) {
        throw err;
      }
      return undefined;
    }
  }

  async getRailgunTransactionByTxid(
    railgunTxid: string,
  ): Promise<Optional<RailgunTransactionWithTxid>> {
    try {
      const txidIndex = await this.getTxidIndexByRailgunTxid(railgunTxid);
      if (!isDefined(txidIndex)) {
        throw new Error('Txid index not found');
      }
      const { tree, index } = RailgunTxidMerkletree.getTreeAndIndexFromTxidIndex(txidIndex);
      return await this.getRailgunTransaction(tree, index);
    } catch (err) {
      if (!(err instanceof Error)) {
        throw err;
      }
      return undefined;
    }
  }

  private async storeRailgunTxidIndexLookup(
    railgunTxid: string,
    tree: number,
    index: number,
  ): Promise<void> {
    const txidIndex = RailgunTxidMerkletree.getTxidIndex(tree, index);
    await this.db.put(this.getRailgunTxidLookupDBPath(railgunTxid), String(txidIndex));
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

  protected async newLeafRootTrigger(
    tree: number,
    index: number,
    leaf: string,
    merkleroot: string,
  ): Promise<void> {
    await this.storeRailgunTxidIndexLookup(leaf, tree, index);

    if (this.shouldStoreMerkleroots) {
      await this.db.put(this.getHistoricalMerklerootDBPath(tree, index), merkleroot);
    }
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
    const { tree, index } = RailgunTxidMerkletree.getTreeAndIndexFromTxidIndex(txidIndex);
    return this.getHistoricalMerkleroot(tree, index);
  }
}
