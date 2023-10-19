import BN from 'bn.js';
import { PutBatch } from 'abstract-leveldown';
import { Database } from '../database/database';
import { Chain } from '../models/engine-types';
import {
  CommitmentProcessingGroupSize,
  MerklerootValidator,
  TREE_DEPTH,
  TREE_MAX_ITEMS,
} from '../models/merkletree-types';
import { Merkletree } from './merkletree';
import {
  TXIDMerkletreeData,
  RailgunTransactionWithHash,
  MerkleProof,
} from '../models/formatted-types';
import { ByteLength, formatToByteLength, fromUTF8String, hexlify, nToHex } from '../utils/bytes';
import { isDefined } from '../utils';
import { TXIDVersion } from '../models';
import EngineDebug from '../debugger/debugger';
import { verifyMerkleProof } from './merkle-proof';
import { POI } from '../poi/poi';

type POILaunchSnapshotNode = {
  hash: string;
  index: number;
};

export class TXIDMerkletree extends Merkletree<RailgunTransactionWithHash> {
  // DO NOT MODIFY
  protected merkletreePrefix = 'railgun-transaction-ids';

  protected merkletreeType = 'TXID';

  poiLaunchBlock: number;

  shouldStoreMerkleroots: boolean;

  shouldSavePOILaunchSnapshot: boolean;

  savedPOILaunchSnapshot: Optional<boolean>;

  private constructor(
    db: Database,
    chain: Chain,
    txidVersion: TXIDVersion,
    poiLaunchBlock: number,
    merklerootValidator: MerklerootValidator,
    isPOINode: boolean,
  ) {
    // For Txid merkletree on POI Nodes, we will calculate for every Single tree update, in order to capture its merkleroot.
    const commitmentProcessingGroupSize = isPOINode
      ? CommitmentProcessingGroupSize.Single
      : CommitmentProcessingGroupSize.XXXLarge;

    super(db, chain, txidVersion, merklerootValidator, commitmentProcessingGroupSize);

    if (POI.getLaunchBlock(chain) !== poiLaunchBlock) {
      throw new Error('POI launch block is invalid.');
    }

    this.poiLaunchBlock = poiLaunchBlock;

    // For Txid merkletree on POI Nodes, store all merkleroots.
    this.shouldStoreMerkleroots = isPOINode;
    this.shouldSavePOILaunchSnapshot = !isPOINode;
  }

  /**
   * Wallet validates merkleroots against POI Nodes.
   */
  static async createForWallet(
    db: Database,
    chain: Chain,
    txidVersion: TXIDVersion,
    poiLaunchBlock: number,
    merklerootValidator: MerklerootValidator,
  ): Promise<TXIDMerkletree> {
    const merkletree = new TXIDMerkletree(
      db,
      chain,
      txidVersion,
      poiLaunchBlock,
      merklerootValidator,
      false, // isPOINode
    );
    await merkletree.init();
    return merkletree;
  }

  /**
   * POI Node is the source of truth, so it will not validate merkleroots.
   * Instead, it will process every tree update individually, and store each in the database.
   */
  static async createForPOINode(
    db: Database,
    chain: Chain,
    txidVersion: TXIDVersion,
    poiLaunchBlock: number,
  ): Promise<TXIDMerkletree> {
    // Assume all merkleroots are valid.
    const merklerootValidator = async () => true;

    const merkletree = new TXIDMerkletree(
      db,
      chain,
      txidVersion,
      poiLaunchBlock,
      merklerootValidator,
      true, // isPOINode
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
  ): Promise<Optional<RailgunTransactionWithHash>> {
    try {
      if (tree < 0 || index < 0) {
        return undefined;
      }
      return await this.getData(tree, index);
    } catch (err) {
      EngineDebug.log('Error getting railgun transaction');
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-member-access
      EngineDebug.error(err);
      return undefined;
    }
  }

  async getGlobalUTXOTreePositionForRailgunTransactionCommitment(
    tree: number,
    index: number,
    commitmentHash: string,
  ) {
    const railgunTransaction = await this.getRailgunTransaction(tree, index);
    if (!railgunTransaction) {
      throw new Error('Railgun transaction for tree/index not found');
    }
    const commitmentIndex = railgunTransaction.commitments
      .map((c) => formatToByteLength(c, ByteLength.UINT_256))
      .indexOf(formatToByteLength(commitmentHash, ByteLength.UINT_256));
    if (commitmentIndex < 0) {
      throw new Error('Could not find commitmentHash for RailgunTransaction');
    }
    return railgunTransaction.utxoBatchStartPositionOut + commitmentIndex;
  }

  async getRailgunTxidCurrentMerkletreeData(railgunTxid: string): Promise<TXIDMerkletreeData> {
    const txidIndex = await this.getTxidIndexByRailgunTxid(railgunTxid);
    if (!isDefined(txidIndex)) {
      throw new Error(`tree/index not found: railgun txid ${railgunTxid}`);
    }
    const { tree, index } = Merkletree.getTreeAndIndexFromGlobalPosition(txidIndex);
    const railgunTransaction = await this.getRailgunTransaction(tree, index);
    if (!isDefined(railgunTransaction)) {
      throw new Error('railgun transaction not found');
    }

    // Use the snapshot if this is a legacy transaction, and we have a snapshot.
    // (Ie., after POI has launched for this chain).
    const useSnapshot =
      this.shouldSavePOILaunchSnapshot &&
      railgunTransaction.blockNumber < this.poiLaunchBlock &&
      (await this.hasSavedPOILaunchSnapshot());

    if (useSnapshot) {
      const snapshotLeaf = await this.getPOILaunchSnapshotNode(0);
      if (!isDefined(snapshotLeaf)) {
        throw new Error('POI Launch snapshot not found');
      }
      const currentMerkleProofForTree = await this.getMerkleProofWithSnapshot(
        snapshotLeaf,
        tree,
        index,
      );
      if (!verifyMerkleProof(currentMerkleProofForTree)) {
        throw new Error('Invalid merkle proof for snapshot');
      }
      return {
        railgunTransaction,
        currentMerkleProofForTree,
        currentTxidIndexForTree: snapshotLeaf.index,
      };
    }

    const currentMerkleProofForTree = await this.getMerkleProof(tree, index);
    if (!verifyMerkleProof(currentMerkleProofForTree)) {
      throw new Error('Invalid merkle proof');
    }
    const currentIndex = await this.getLatestIndexForTree(tree);
    const currentTxidIndexForTree = TXIDMerkletree.getGlobalPosition(tree, currentIndex);
    return {
      railgunTransaction,
      currentMerkleProofForTree,
      currentTxidIndexForTree,
    };
  }

  async getMerkleProofWithSnapshot(
    snapshotLeaf: POILaunchSnapshotNode,
    tree: number,
    index: number,
  ): Promise<MerkleProof> {
    const leaf = await this.getNodeHash(tree, 0, index);

    const rightmostIndices = TXIDMerkletree.getRightmostNonzeroIndices(snapshotLeaf.index);

    // Get indexes of path elements to fetch
    const elementsIndices: number[] = [index ^ 1];

    // Loop through each level and calculate index
    while (elementsIndices.length < TREE_DEPTH) {
      // Shift right and flip last bit
      elementsIndices.push((elementsIndices[elementsIndices.length - 1] >> 1) ^ 1);
    }

    // Fetch path elements
    const elements = await Promise.all(
      elementsIndices.map(async (elementIndex, level) => {
        const snapshotIndexAtLevel = rightmostIndices[level];
        if (elementIndex > snapshotIndexAtLevel) {
          // Get snapshot node hash (exact value)
          return this.zeros[level];
        }

        if (elementIndex === snapshotIndexAtLevel) {
          // Get snapshot node hash (exact value)
          const node = await this.getPOILaunchSnapshotNode(level);
          if (!isDefined(node)) {
            throw new Error('POI Launch snapshot node not found');
          }
          return node.hash;
        }

        // Get current node hash (always same as snapshot)
        return this.getNodeHash(tree, level, elementIndex);
      }),
    );

    // Convert index to bytes data, the binary representation is the indices of the merkle path
    // Pad to 32 bytes
    const indices = nToHex(BigInt(index), ByteLength.UINT_256);

    const rootNode = await this.getPOILaunchSnapshotNode(TREE_DEPTH);
    if (!isDefined(rootNode)) {
      throw new Error('POI Launch snapshot root not found');
    }
    const root = rootNode.hash;

    return {
      leaf,
      elements,
      indices,
      root,
    };
  }

  async railgunTxidOccurredBeforeBlockNumber(
    tree: number,
    index: number,
    blockNumber: number,
  ): Promise<boolean> {
    const railgunTransaction = await this.getRailgunTransaction(tree, index);
    if (!railgunTransaction) {
      throw new Error(`Railgun transaction at Txid tree ${tree} and index ${index} not found.`);
    }
    return railgunTransaction.blockNumber < blockNumber;
  }

  async getLatestRailgunTransaction(): Promise<Optional<RailgunTransactionWithHash>> {
    const { tree, index } = await this.getLatestTreeAndIndex();
    return this.getRailgunTransaction(tree, index);
  }

  async queueRailgunTransactions(
    railgunTransactionsWithTxids: RailgunTransactionWithHash[],
    maxTxidIndex: Optional<number>,
  ): Promise<void> {
    const { tree: latestTree, index: latestIndex } = await this.getLatestTreeAndIndex();
    let nextTree = latestTree;
    let nextIndex = latestIndex;

    const railgunTxidIndexLookupBatch: PutBatch[] = [];

    for (let i = 0; i < railgunTransactionsWithTxids.length; i += 1) {
      const { tree, index } = TXIDMerkletree.nextTreeAndIndex(nextTree, nextIndex);
      nextTree = tree;
      nextIndex = index;
      if (TXIDMerkletree.isOutOfBounds(nextTree, nextIndex, maxTxidIndex)) {
        break;
      }

      const railgunTransactionWithTxid = railgunTransactionsWithTxids[i];

      const { railgunTxid } = railgunTransactionWithTxid;

      const latestLeafIndex = nextIndex - 1;
      // eslint-disable-next-line no-await-in-loop
      await this.savePOILaunchSnapshotIfNecessary(railgunTransactionWithTxid, latestLeafIndex);

      // eslint-disable-next-line no-await-in-loop
      await this.queueLeaves(nextTree, nextIndex, [railgunTransactionWithTxid]);

      const txidIndex = TXIDMerkletree.getGlobalPosition(nextTree, nextIndex);
      railgunTxidIndexLookupBatch.push({
        type: 'put',
        key: this.getRailgunTxidLookupDBPath(railgunTxid).join(':'),
        value: String(txidIndex),
      });
    }

    await this.db.batch(railgunTxidIndexLookupBatch, 'utf8');
  }

  static isOutOfBounds(tree: number, index: number, maxTxidIndex?: number) {
    if (!isDefined(maxTxidIndex)) {
      return false;
    }
    return TXIDMerkletree.getGlobalPosition(tree, index) > maxTxidIndex;
  }

  static nextTreeAndIndex(tree: number, index: number): { tree: number; index: number } {
    if (index + 1 >= TREE_MAX_ITEMS) {
      return { tree: tree + 1, index: 0 };
    }
    return { tree, index: index + 1 };
  }

  private async savePOILaunchSnapshotIfNecessary(
    railgunTransactionWithTxid: RailgunTransactionWithHash,
    latestLeafIndex: number,
  ): Promise<void> {
    if (!this.shouldSavePOILaunchSnapshot) {
      return;
    }
    if (!isDefined(this.poiLaunchBlock)) {
      return;
    }
    if (railgunTransactionWithTxid.blockNumber < this.poiLaunchBlock) {
      return;
    }

    const shouldSavePOILaunchSnapshot = !(await this.hasSavedPOILaunchSnapshot());

    if (shouldSavePOILaunchSnapshot) {
      // Make sure trees have fully updated data.
      await this.updateTreesFromWriteQueue();

      // eslint-disable-next-line no-await-in-loop
      await this.savePOILaunchSnapshot(latestLeafIndex);
    }
  }

  private async hasSavedPOILaunchSnapshot(): Promise<boolean> {
    if (this.savedPOILaunchSnapshot === true) {
      return this.savedPOILaunchSnapshot;
    }
    const level = 0;
    const node = await this.getPOILaunchSnapshotNode(level);

    return isDefined(node);
  }

  async getPOILaunchSnapshotNode(level: number): Promise<Optional<POILaunchSnapshotNode>> {
    try {
      return (await this.db.get(
        this.getPOILaunchSnapshotNodeDBPath(level),
        'json',
      )) as POILaunchSnapshotNode;
    } catch (err) {
      if (!(err instanceof Error)) {
        throw err;
      }
      return undefined;
    }
  }

  private static getRightmostNonzeroIndices(latestLeafIndex: number): number[] {
    const rightmostIndices = [latestLeafIndex];
    while (rightmostIndices.length < TREE_DEPTH + 1) {
      rightmostIndices.push(rightmostIndices[rightmostIndices.length - 1] >> 1);
    }
    return rightmostIndices;
  }

  private async savePOILaunchSnapshot(latestLeafIndex: number): Promise<void> {
    if (!this.shouldSavePOILaunchSnapshot) {
      return;
    }

    const snapshotNodeWriteBatch: PutBatch[] = [];

    const indicesPerLevel = TXIDMerkletree.getRightmostNonzeroIndices(latestLeafIndex);

    for (let level = 0; level < TREE_DEPTH + 1; level += 1) {
      const index = indicesPerLevel[level];

      // eslint-disable-next-line no-await-in-loop
      const hash = await this.getNodeHash(0, level, index);
      const node: POILaunchSnapshotNode = { hash, index };

      snapshotNodeWriteBatch.push({
        type: 'put',
        key: this.getPOILaunchSnapshotNodeDBPath(level).join(':'),
        value: node,
      });
    }
    await this.db.batch(snapshotNodeWriteBatch, 'json');

    if (!(await this.hasSavedPOILaunchSnapshot())) {
      throw new Error('Error saving POI launch snapshot');
    }
    this.savedPOILaunchSnapshot = true;
  }

  async clearLeavesForInvalidVerificationHash(numLeavesToClear: number): Promise<void> {
    const { tree: latestTree, index: latestIndex } = await this.getLatestTreeAndIndex();
    const latestTxidIndex = TXIDMerkletree.getGlobalPosition(latestTree, latestIndex);
    const clearToTxidIndex = Math.max(-1, latestTxidIndex - numLeavesToClear);
    await this.clearLeavesAfterTxidIndex(clearToTxidIndex);
  }

  async clearLeavesAfterTxidIndex(txidIndex: number): Promise<void> {
    // Lock for updates
    this.lockUpdates = true;

    // Remove any queued items
    this.writeQueue = [];

    const { tree, index } = TXIDMerkletree.getTreeAndIndexFromGlobalPosition(txidIndex);

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

  async getCurrentTxidIndex(): Promise<number> {
    const { tree, index } = await this.getLatestTreeAndIndex();
    return TXIDMerkletree.getGlobalPosition(tree, index);
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

  private getPOILaunchSnapshotNodeDBPath(level: number): string[] {
    const snapshotPrefix = fromUTF8String('poi-launch-snapshot');
    return [...this.getMerkletreeDBPrefix(), snapshotPrefix, new BN(level)].map((el) =>
      formatToByteLength(el, ByteLength.UINT_256),
    );
  }

  private getRailgunTxidLookupDBPath(railgunTxid: string): string[] {
    const railgunTxidPrefix = fromUTF8String('railgun-txid-lookup');
    return [...this.getMerkletreeDBPrefix(), railgunTxidPrefix, railgunTxid].map((el) =>
      formatToByteLength(el, ByteLength.UINT_256),
    );
  }

  async getTxidIndexByRailgunTxid(railgunTxid: string): Promise<Optional<number>> {
    try {
      return Number(await this.db.get(this.getRailgunTxidLookupDBPath(railgunTxid), 'utf8'));
    } catch (err) {
      return undefined;
    }
  }

  async getRailgunTransactionByTxid(
    railgunTxid: string,
  ): Promise<Optional<RailgunTransactionWithHash>> {
    try {
      const txidIndex = await this.getTxidIndexByRailgunTxid(railgunTxid);
      if (!isDefined(txidIndex)) {
        return undefined;
      }
      const { tree, index } = TXIDMerkletree.getTreeAndIndexFromGlobalPosition(txidIndex);
      return await this.getData(tree, index);
    } catch (err) {
      EngineDebug.log('Error getting railgun txid index');
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-member-access
      EngineDebug.error(err);
      return undefined;
    }
  }

  private getHistoricalMerklerootDBPath(tree: number, index: number): string[] {
    const merklerootPrefix = fromUTF8String('merkleroots');
    return [
      ...this.getMerkletreeDBPrefix(),
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
    const { tree, index } = TXIDMerkletree.getTreeAndIndexFromGlobalPosition(txidIndex);
    return this.getHistoricalMerkleroot(tree, index);
  }
}
