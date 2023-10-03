/* eslint-disable no-await-in-loop */
import type { PutBatch } from 'abstract-leveldown';
import BN from 'bn.js';
import { poseidon } from 'circomlibjs';
import msgpack from 'msgpack-lite';
import type { Database } from '../database/database';
import {
  fromUTF8String,
  hexlify,
  formatToByteLength,
  ByteLength,
  nToHex,
  hexToBigInt,
  arrayify,
} from '../utils/bytes';
import EngineDebug from '../debugger/debugger';
import { BytesData, MerkleProof } from '../models/formatted-types';
import { Chain } from '../models/engine-types';
import { getChainFullNetworkID } from '../chain/chain';
import { isDefined } from '../utils/is-defined';
import {
  InvalidMerklerootDetails,
  MERKLE_ZERO_VALUE,
  MerkletreeLeaf,
  MerkletreesMetadata,
  MerklerootValidator,
  TREE_DEPTH,
  CommitmentProcessingGroupSize,
  TREE_MAX_ITEMS,
} from '../models/merkletree-types';
import { TXIDVersion } from '../models';

const INVALID_MERKLE_ROOT_ERROR_MESSAGE = 'Cannot insert leaves. Invalid merkle root.';

export abstract class Merkletree<T extends MerkletreeLeaf> {
  protected abstract readonly merkletreePrefix: string;

  protected abstract readonly merkletreeType: string;

  protected readonly db: Database;

  readonly chain: Chain;

  readonly zeros: string[] = [];

  private treeLengths: number[] = [];

  // {tree: {startingIndex: [leaves]}}
  protected writeQueue: T[][][] = [];

  protected lockUpdates = false;

  txidVersion: TXIDVersion;

  // Check function to test if merkle root is valid
  merklerootValidator: MerklerootValidator;

  isScanning = false;

  private processingWriteQueueTrees: { [tree: number]: boolean } = {};

  invalidMerklerootDetailsByTree: { [tree: number]: InvalidMerklerootDetails } = {};

  private cachedNodeHashes: { [tree: number]: { [level: number]: { [index: number]: string } } } =
    {};

  private defaultCommitmentProcessingSize: CommitmentProcessingGroupSize;

  /**
   * Create Merkletree controller from database
   * @param db - database object to use
   * @param chain - Chain type/id
   * @param merklerootValidator - root validator callback
   */
  constructor(
    db: Database,
    chain: Chain,
    txidVersion: TXIDVersion,
    merklerootValidator: MerklerootValidator,
    defaultCommitmentProcessingSize: CommitmentProcessingGroupSize,
  ) {
    // Set passed values
    this.db = db;
    this.chain = chain;
    this.txidVersion = txidVersion;
    this.merklerootValidator = merklerootValidator;
    this.defaultCommitmentProcessingSize = defaultCommitmentProcessingSize;

    // Calculate zero values
    this.zeros[0] = MERKLE_ZERO_VALUE;
    for (let level = 1; level <= TREE_DEPTH; level += 1) {
      this.zeros[level] = Merkletree.hashLeftRight(this.zeros[level - 1], this.zeros[level - 1]);
    }
  }

  protected async init(): Promise<void> {
    await this.getMetadataFromStorage();
  }

  /**
   * Gets merkle proof for leaf
   */
  async getMerkleProof(tree: number, index: number): Promise<MerkleProof> {
    // Fetch leaf
    const leaf = await this.getNodeHash(tree, 0, index);

    // Get indexes of path elements to fetch
    const elementsIndices: number[] = [index ^ 1];

    // Loop through each level and calculate index
    while (elementsIndices.length < TREE_DEPTH) {
      // Shift right and flip last bit
      elementsIndices.push((elementsIndices[elementsIndices.length - 1] >> 1) ^ 1);
    }

    // Fetch path elements
    const elements = await Promise.all(
      elementsIndices.map((elementIndex, level) => this.getNodeHash(tree, level, elementIndex)),
    );

    // Convert index to bytes data, the binary representation is the indices of the merkle path
    // Pad to 32 bytes
    const indices = nToHex(BigInt(index), ByteLength.UINT_256);

    // Fetch root
    const root = await this.getRoot(tree);

    // Return proof
    return {
      leaf,
      elements,
      indices,
      root,
    };
  }

  /**
   * Hash 2 elements together
   */
  static hashLeftRight(left: string, right: string): string {
    return nToHex(poseidon([hexToBigInt(left), hexToBigInt(right)]), ByteLength.UINT_256);
  }

  private getTXIDVersionPrefix(): string {
    switch (this.txidVersion) {
      case TXIDVersion.V2_PoseidonMerkle:
        return 'V2';
      // case TXIDVersion.V3_PoseidonMerkle:
      // return 'V3';
      // case TXIDVersion.V3_KZG:
      // throw new Error('KZG txid version not supported for merkletrees.');
    }
    throw new Error('Unrecognized txid version for merkletree');
  }

  getMerkletreeDBPrefix(): string[] {
    const merkletreePrefix = fromUTF8String(this.merkletreePrefix);
    const txidVersionPrefix = fromUTF8String(this.getTXIDVersionPrefix());

    return [merkletreePrefix, getChainFullNetworkID(this.chain), txidVersionPrefix].map((el) =>
      formatToByteLength(el, ByteLength.UINT_256),
    );
  }

  /**
   * Construct DB prefix from tree number
   */
  getTreeDBPrefix(tree: number): string[] {
    return [...this.getMerkletreeDBPrefix(), hexlify(new BN(tree))].map((el) =>
      formatToByteLength(el, ByteLength.UINT_256),
    );
  }

  /**
   * Construct node hash DB path from tree number and level
   */
  private getNodeHashLevelPath(tree: number, level: number): string[] {
    return [...this.getTreeDBPrefix(tree), hexlify(new BN(level))].map((el) =>
      formatToByteLength(el, ByteLength.UINT_256),
    );
  }

  /**
   * Construct node hash DB path from tree number, level, and index
   */
  getNodeHashDBPath(tree: number, level: number, index: number): string[] {
    const dbPath = [...this.getNodeHashLevelPath(tree, level), hexlify(new BN(index))];
    return dbPath.map((el) => formatToByteLength(el, ByteLength.UINT_256));
  }

  async clearAllNodeHashes(tree: number): Promise<void> {
    for (let level = 0; level < TREE_DEPTH; level += 1) {
      // eslint-disable-next-line no-await-in-loop
      await this.db.clearNamespace(this.getNodeHashLevelPath(tree, level));
    }
  }

  static getGlobalPosition(tree: number, index: number): number {
    return tree * TREE_MAX_ITEMS + index;
  }

  static getTreeAndIndexFromGlobalPosition(globalPosition: number): {
    tree: number;
    index: number;
  } {
    return {
      tree: Math.floor(globalPosition / TREE_MAX_ITEMS),
      index: globalPosition % TREE_MAX_ITEMS,
    };
  }

  /**
   * Construct data DB path from tree number and index
   */
  getDataDBPath(tree: number, index: number): string[] {
    return [
      ...this.getTreeDBPrefix(tree),
      hexlify(new BN(0).notn(32)), // 2^32-1
      hexlify(new BN(index)),
    ].map((el) => formatToByteLength(el, ByteLength.UINT_256));
  }

  async updateData(tree: number, index: number, data: T): Promise<void> {
    try {
      this.lockUpdates = true;
      const oldData = await this.getData(tree, index);
      if (oldData.hash !== data.hash) {
        throw new Error('Cannot update merkletree data with different hash.');
      }
      await this.db.put(this.getDataDBPath(tree, index), data, 'json');

      this.lockUpdates = false;
    } catch (err) {
      if (!(err instanceof Error)) {
        throw err;
      }
      this.lockUpdates = false;
      throw new Error(err.message);
    }
  }

  protected async getData(tree: number, index: number): Promise<T> {
    try {
      const data = (await this.db.get(this.getDataDBPath(tree, index), 'json')) as T;
      return data;
    } catch (err) {
      if (!(err instanceof Error)) {
        throw err;
      }
      throw new Error(err.message);
    }
  }

  // eslint-disable-next-line class-methods-use-this
  sortMerkletreeDataByHash(array: T[]): T[] {
    return array.sort((a, b) => (a.hash > b.hash ? 1 : -1));
  }

  /**
   * Gets node from tree
   * @param tree - tree to get node from
   * @param level - tree level
   * @param index - index of node
   * @returns node
   */
  async getNodeHash(tree: number, level: number, index: number): Promise<string> {
    if (
      isDefined(this.cachedNodeHashes[tree]) &&
      isDefined(this.cachedNodeHashes[tree][level]) &&
      this.cachedNodeHashes[tree][level][index]
    ) {
      return this.cachedNodeHashes[tree][level][index];
    }
    try {
      const hash = (await this.db.get(this.getNodeHashDBPath(tree, level, index))) as string;
      this.cacheNodeHash(tree, level, index, hash);
      return hash;
    } catch {
      return this.zeros[level];
    }
  }

  private cacheNodeHash(tree: number, level: number, index: number, hash: string) {
    if (!isDefined(this.cachedNodeHashes[tree])) {
      this.cachedNodeHashes[tree] = {};
    }
    if (!isDefined(this.cachedNodeHashes[tree][level])) {
      this.cachedNodeHashes[tree][level] = {};
    }
    this.cachedNodeHashes[tree][level][index] = hash;
  }

  async getMetadataFromStorage(): Promise<void> {
    const storedMetadata = await this.getMerkletreesMetadata();
    if (!storedMetadata) {
      return;
    }
    const trees = Object.keys(storedMetadata.trees).map((tree) => Number(tree));
    trees.forEach((tree) => {
      const treeMetadata = storedMetadata.trees[tree];
      this.treeLengths[tree] = treeMetadata.scannedHeight;
      if (treeMetadata.invalidMerklerootDetails) {
        this.invalidMerklerootDetailsByTree[tree] =
          treeMetadata.invalidMerklerootDetails ?? undefined;
      }
    });
  }

  /**
   * Gets merkletrees metadata
   * @returns metadata
   */
  async getMerkletreesMetadata(): Promise<Optional<MerkletreesMetadata>> {
    try {
      const metadata = msgpack.decode(
        arrayify((await this.db.get(this.getMerkletreeDBPrefix())) as BytesData),
      ) as MerkletreesMetadata;
      return metadata;
    } catch {
      return undefined;
    }
  }

  /**
   * Stores merkletrees metadata
   */
  async storeMerkletreesMetadata(metadata: MerkletreesMetadata): Promise<void> {
    await this.db.put(this.getMerkletreeDBPrefix(), msgpack.encode(metadata));
  }

  /**
   * Gets length of tree
   * @param treeIndex - tree to get length of
   * @returns tree length
   */
  async getTreeLength(treeIndex: number): Promise<number> {
    if (this.treeLengths[treeIndex] != null) {
      return this.treeLengths[treeIndex];
    }

    const storedMetadata = await this.getMerkletreesMetadata();
    if (isDefined(storedMetadata) && isDefined(storedMetadata.trees[treeIndex])) {
      this.treeLengths[treeIndex] = storedMetadata.trees[treeIndex].scannedHeight;
      return this.treeLengths[treeIndex];
    }

    this.treeLengths[treeIndex] = await this.getTreeLengthFromDBCount(treeIndex);
    if (this.treeLengths[treeIndex] > 0) {
      await this.updateStoredMerkletreesMetadata(treeIndex);
    }

    return this.treeLengths[treeIndex];
  }

  async updateStoredMerkletreesMetadata(treeIndex: number): Promise<void> {
    const treeLength = await this.getTreeLength(treeIndex);
    const storedMerkletreesMetadata = await this.getMerkletreesMetadata();
    const merkletreesMetadata: MerkletreesMetadata = storedMerkletreesMetadata || {
      trees: {},
    };
    merkletreesMetadata.trees[treeIndex] = {
      scannedHeight: treeLength,
      invalidMerklerootDetails: this.invalidMerklerootDetailsByTree[treeIndex],
    };
    await this.storeMerkletreesMetadata(merkletreesMetadata);
  }

  async resetTreeLength(treeIndex: number): Promise<void> {
    delete this.treeLengths[treeIndex];
    const merkletreesMetadata = await this.getMerkletreesMetadata();
    if (!merkletreesMetadata) {
      return;
    }
    delete merkletreesMetadata.trees[treeIndex];
    await this.storeMerkletreesMetadata(merkletreesMetadata);
  }

  /**
   * WARNING: This operation takes a long time.
   */
  private async getTreeLengthFromDBCount(tree: number): Promise<number> {
    return this.db.countNamespace([
      ...this.getTreeDBPrefix(tree),
      hexlify(new BN(0).notn(32)), // 2^32-1
    ]);
  }

  async getLatestIndexForTree(tree: number): Promise<number> {
    const treeLength = await this.getTreeLength(tree);
    return treeLength - 1;
  }

  async getLatestTreeAndIndex(): Promise<{ tree: number; index: number }> {
    const latestTree = await this.latestTree();
    const index = await this.getLatestIndexForTree(latestTree);
    return { tree: latestTree, index };
  }

  async clearDataForMerkletree(): Promise<void> {
    await this.db.clearNamespace(this.getMerkletreeDBPrefix());
    this.cachedNodeHashes = {};
    this.treeLengths = [];
  }

  /**
   * Gets node from tree
   * @param tree - tree to get root of
   * @returns tree root
   */
  getRoot(tree: number): Promise<string> {
    return this.getNodeHash(tree, TREE_DEPTH, 0);
  }

  /**
   * Write tree to DB
   * @param treeIndex - tree to write
   */
  private async writeTreeToDB(
    treeIndex: number,
    hashWriteGroup: string[][],
    dataWriteGroup: T[],
  ): Promise<void> {
    const newTreeLength = hashWriteGroup[0].length;

    const nodeWriteBatch: PutBatch[] = [];
    hashWriteGroup.forEach((levelNodes, level) => {
      levelNodes.forEach((node, index) => {
        nodeWriteBatch.push({
          type: 'put',
          key: this.getNodeHashDBPath(treeIndex, level, index).join(':'),
          value: node,
        });
        this.cacheNodeHash(treeIndex, level, index, node);
      });
    });

    const dataWriteBatch: PutBatch[] = [];
    const globalHashLookupBatch: PutBatch[] = [];
    dataWriteGroup.forEach((data, index) => {
      dataWriteBatch.push({
        type: 'put',
        key: this.getDataDBPath(treeIndex, index).join(':'),
        value: data,
      });
    });

    await Promise.all([
      this.db.batch(nodeWriteBatch),
      this.db.batch(dataWriteBatch, 'json'),
      this.db.batch(globalHashLookupBatch, 'utf8'),
    ]);

    // Call leaf/merkleroot storage (implemented in txid tree only)
    const lastIndex = newTreeLength - 1;
    const leaf = hashWriteGroup[0][lastIndex];
    const merkleroot = hashWriteGroup[TREE_DEPTH][0];
    await this.newLeafRootTrigger(treeIndex, lastIndex, leaf, merkleroot);

    // Update tree length
    this.treeLengths[treeIndex] = newTreeLength;
    await this.updateStoredMerkletreesMetadata(treeIndex);
  }

  /**
   * Inserts array of leaves into tree
   * @param tree - Tree to insert leaves into
   * @param startIndex - Starting index of leaves to insert
   * @param leaves - Leaves to insert
   */
  private async insertLeaves(tree: number, startIndex: number, leaves: T[]): Promise<void> {
    // Start insertion at startIndex
    let index = startIndex;

    // Calculate ending index
    const endIndex = startIndex + leaves.length;

    const firstLevelHashWriteGroup: string[][] = [];
    const dataWriteGroup: T[] = [];

    firstLevelHashWriteGroup[0] = [];

    EngineDebug.log(`insertLeaves: startIndex ${startIndex}, group length ${leaves.length}`);

    // Push values to leaves of write index
    leaves.forEach((leaf) => {
      // Set writecache value
      firstLevelHashWriteGroup[0][index] = leaf.hash;

      dataWriteGroup[index] = leaf;

      // Increment index
      index += 1;
    });

    const hashWriteGroup: string[][] = await Merkletree.fillHashWriteGroup(
      firstLevelHashWriteGroup,
      tree,
      startIndex,
      endIndex,
      (level, nodeIndex) => this.getNodeHash(tree, level, nodeIndex),
    );

    const leafIndex = leaves.length - 1;
    const lastLeafIndex = startIndex + leafIndex;

    const rootNode = hashWriteGroup[TREE_DEPTH][0];
    const validRoot = await this.merklerootValidator(
      this.txidVersion,
      this.chain,
      tree,
      lastLeafIndex,
      rootNode,
    );

    if (validRoot) {
      await this.validRootCallback(tree, lastLeafIndex);
    } else {
      await this.invalidRootCallback(tree, lastLeafIndex, leaves[leafIndex]);
      throw new Error(
        `${INVALID_MERKLE_ROOT_ERROR_MESSAGE} [${this.merkletreeType}] Tree ${tree}, startIndex ${startIndex}, group length ${leaves.length}.`,
      );
    }

    // If new root is valid, write to DB.
    await this.writeTreeToDB(tree, hashWriteGroup, dataWriteGroup);
  }

  /**
   * Rebuilds entire tree and writes to DB.
   */
  async rebuildAndWriteTree(tree: number): Promise<void> {
    const firstLevelHashWriteGroup: string[][] = [];

    firstLevelHashWriteGroup[0] = [];

    // Cannot used cached treeLength value here because it is stale.
    const treeLength = await this.getTreeLengthFromDBCount(tree);

    const fetcher = new Array<Promise<Optional<T>>>(treeLength);

    // Fetch each leaf we need to scan
    for (let index = 0; index < treeLength; index += 1) {
      fetcher[index] = this.getData(tree, index);
    }
    const leaves = await Promise.all(fetcher);

    // Push values to leaves of write index
    leaves.forEach((leaf, index) => {
      firstLevelHashWriteGroup[0][index] = leaf?.hash ?? this.zeros[0];
    });

    const startIndex = 0;
    const endIndex = treeLength - 1;

    const hashWriteGroup: string[][] = await Merkletree.fillHashWriteGroup(
      firstLevelHashWriteGroup,
      tree,
      startIndex,
      endIndex,
      async (level: number) => this.zeros[level],
    );

    const dataWriteGroup: T[] = [];

    await this.writeTreeToDB(tree, hashWriteGroup, dataWriteGroup);
  }

  private static async fillHashWriteGroup(
    firstLevelHashWriteGroup: string[][],
    tree: number,
    startIndex: number,
    endIndex: number,
    nodeHashLookup: (level: number, nodeIndex: number) => Promise<string>,
  ): Promise<string[][]> {
    const hashWriteGroup: string[][] = firstLevelHashWriteGroup;

    let level = 0;

    let index = startIndex;
    let nextLevelStartIndex = startIndex;
    let nextLevelEndIndex = endIndex;

    // Loop through each level and calculate values
    while (level < TREE_DEPTH) {
      // Set starting index for this level
      index = nextLevelStartIndex;

      // Ensure writecache array exists for next level
      hashWriteGroup[level] = hashWriteGroup[level] ?? [];
      hashWriteGroup[level + 1] = hashWriteGroup[level + 1] ?? [];

      // Loop through every pair
      for (index; index <= nextLevelEndIndex + 1; index += 2) {
        if (index % 2 === 0) {
          // Left
          hashWriteGroup[level + 1][index >> 1] = Merkletree.hashLeftRight(
            hashWriteGroup[level][index] || (await nodeHashLookup(level, index)),
            hashWriteGroup[level][index + 1] || (await nodeHashLookup(level, index + 1)),
          );
        } else {
          // Right
          hashWriteGroup[level + 1][index >> 1] = Merkletree.hashLeftRight(
            hashWriteGroup[level][index - 1] || (await nodeHashLookup(level, index - 1)),
            hashWriteGroup[level][index] || (await nodeHashLookup(level, index)),
          );
        }
      }

      // Calculate starting and ending index for the next level
      nextLevelStartIndex >>= 1;
      nextLevelEndIndex >>= 1;

      // Increment level
      level += 1;
    }

    return hashWriteGroup;
  }

  protected abstract newLeafRootTrigger(
    tree: number,
    index: number,
    leaf: string,
    merkleroot: string,
  ): Promise<void>;

  protected abstract validRootCallback(tree: number, lastValidLeafIndex: number): Promise<void>;

  protected abstract invalidRootCallback(
    tree: number,
    lastKnownInvalidLeafIndex: number,
    lastKnownInvalidLeaf: T,
  ): Promise<void>;

  private async processWriteQueueForTree(treeIndex: number): Promise<void> {
    let processingGroupSize = this.defaultCommitmentProcessingSize;

    let currentTreeLength = await this.getTreeLength(treeIndex);
    const treeWriteQueue = this.writeQueue[treeIndex];
    treeWriteQueue.forEach((_writeQueue, writeQueueIndex) => {
      const alreadyAddedToTree = writeQueueIndex < currentTreeLength;
      if (alreadyAddedToTree) {
        delete treeWriteQueue[writeQueueIndex];
      }
    });

    if (this.processingWriteQueueTrees[treeIndex]) {
      EngineDebug.log(
        `[processWriteQueueForTree: ${this.chain.type}:${this.chain.id}] Already processing writeQueue. Killing re-process.`,
      );
      return;
    }

    while (isDefined(this.writeQueue[treeIndex])) {
      // Process leaves as a group until we hit an invalid merkleroot.
      // Then, process each single item.
      // This optimizes for fewer `merklerootValidator` calls, while still protecting
      // users against invalid roots and broken trees.

      this.processingWriteQueueTrees[treeIndex] = true;

      currentTreeLength = await this.getTreeLength(treeIndex);

      const processWriteQueuePrefix = `[processWriteQueueForTree: ${this.chain.type}:${this.chain.id}]`;

      try {
        const processedAny = await this.processWriteQueue(
          treeIndex,
          currentTreeLength,
          processingGroupSize,
        );
        if (!processedAny) {
          EngineDebug.log(`${processWriteQueuePrefix} No more events to process.`);
          break;
        }
      } catch (err) {
        if (!(err instanceof Error)) {
          EngineDebug.log(`${processWriteQueuePrefix} Unknown error found.`);
          return;
        }
        const ignoreInTests = true;
        EngineDebug.error(err, ignoreInTests);
        if (err.message.startsWith(INVALID_MERKLE_ROOT_ERROR_MESSAGE)) {
          const nextProcessingGroupSize = Merkletree.nextProcessingGroupSize(processingGroupSize);
          if (nextProcessingGroupSize) {
            EngineDebug.log(
              `${processWriteQueuePrefix} Invalid merkleroot found. Processing with group size ${nextProcessingGroupSize}.`,
            );
            processingGroupSize = nextProcessingGroupSize;
          } else {
            EngineDebug.log(
              `${processWriteQueuePrefix} Unable to process more events. Invalid merkleroot found.`,
            );
            break;
          }
        } else {
          // Unknown error.
          EngineDebug.log(
            `${processWriteQueuePrefix} Unable to process more events. Unknown error.`,
          );
          break;
        }
      }

      // Delete queue for entire tree if necessary.
      const noElementsInTreeWriteQueue = treeWriteQueue.reduce((x) => x + 1, 0) === 0;
      if (noElementsInTreeWriteQueue) {
        delete this.writeQueue[treeIndex];
      }
    }

    this.processingWriteQueueTrees[treeIndex] = false;
  }

  private static nextProcessingGroupSize(processingGroupSize: CommitmentProcessingGroupSize) {
    switch (processingGroupSize) {
      case CommitmentProcessingGroupSize.XXXLarge:
        // Process with smaller group.
        return CommitmentProcessingGroupSize.XXLarge;
      case CommitmentProcessingGroupSize.XXLarge:
        // Process with smaller group.
        return CommitmentProcessingGroupSize.XLarge;
      case CommitmentProcessingGroupSize.XLarge:
        // Process with smaller group.
        return CommitmentProcessingGroupSize.Large;
      case CommitmentProcessingGroupSize.Large:
        // Process with smaller group.
        return CommitmentProcessingGroupSize.Medium;
      case CommitmentProcessingGroupSize.Medium:
        // Process with smaller group.
        return CommitmentProcessingGroupSize.Small;
      case CommitmentProcessingGroupSize.Small:
        // Process by individual items.
        return CommitmentProcessingGroupSize.Single;
      case CommitmentProcessingGroupSize.Single:
        // Break out from scan.
        return undefined;
    }
    return undefined;
  }

  private async processWriteQueue(
    treeIndex: number,
    currentTreeLength: number,
    maxCommitmentGroupsToProcess: number,
  ): Promise<boolean> {
    // If there is an element in the write queue equal to the tree length, process it.
    const nextCommitmentGroup = this.writeQueue[treeIndex][currentTreeLength];
    if (!isDefined(nextCommitmentGroup)) {
      EngineDebug.log(
        `[processWriteQueue: ${this.chain.type}:${this.chain.id}] No commitment group for index ${currentTreeLength}`,
      );
      return false;
    }

    const commitmentGroupIndices = [currentTreeLength];
    let nextIndex = currentTreeLength + nextCommitmentGroup.length;

    const dataWriteGroups: T[][] = [nextCommitmentGroup];
    while (
      maxCommitmentGroupsToProcess > dataWriteGroups.length &&
      isDefined(this.writeQueue[treeIndex][nextIndex])
    ) {
      commitmentGroupIndices.push(nextIndex);
      const next = this.writeQueue[treeIndex][nextIndex];
      dataWriteGroups.push(next);
      nextIndex += next.length;
    }

    await this.insertLeaves(treeIndex, currentTreeLength, dataWriteGroups.flat());

    // Delete the batch after processing it.
    // Ensures bad batches are deleted, therefore halting update loop if one is found.
    commitmentGroupIndices.forEach((commitmentGroupIndex) => {
      delete this.writeQueue[treeIndex][commitmentGroupIndex];
    });

    return true;
  }

  static numNodesPerLevel(level: number): number {
    return TREE_MAX_ITEMS >> level;
  }

  private treeIndicesFromWriteQueue(): number[] {
    return this.writeQueue
      .map((_tree, treeIndex) => treeIndex)
      .filter((index) => !Number.isNaN(index));
  }

  async updateTreesFromWriteQueue(): Promise<void> {
    const treeIndices: number[] = this.treeIndicesFromWriteQueue();
    await Promise.all(treeIndices.map((treeIndex) => this.processWriteQueueForTree(treeIndex)));
  }

  /**
   * Adds leaves to queue to be added to tree
   * @param tree - tree number to add to
   * @param leaves - leaves to add
   * @param startingIndex - index of first leaf
   */
  async queueLeaves(tree: number, startingIndex: number, leaves: T[]): Promise<void> {
    if (this.lockUpdates) {
      return;
    }

    // Get tree length
    const treeLength = await this.getTreeLength(tree);

    // Ensure write queue for tree exists
    if (!isDefined(this.writeQueue[tree])) {
      this.writeQueue[tree] = [];
    }

    if (treeLength <= startingIndex) {
      // If starting index is greater or equal to tree length, insert to queue
      this.writeQueue[tree][startingIndex] = leaves;

      EngineDebug.log(
        `[${this.merkletreeType} queueLeaves: ${this.chain.type}:${this.chain.id}] treeLength ${treeLength}, startingIndex ${startingIndex}`,
      );
    }
  }

  /**
   * Gets latest tree
   * @returns latest tree
   */
  async latestTree(): Promise<number> {
    let latestTree = 0;
    while ((await this.getTreeLength(latestTree)) > 0) latestTree += 1;
    return Math.max(0, latestTree - 1);
  }
}
