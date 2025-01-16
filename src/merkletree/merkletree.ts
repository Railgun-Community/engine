/* eslint-disable no-await-in-loop */
import type { PutBatch } from 'abstract-leveldown';
import msgpack from 'msgpack-lite';
import { poseidonHex } from '../utils/poseidon';
import type { Database } from '../database/database';
import { fromUTF8String, ByteLength, ByteUtils } from '../utils/bytes';
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

  private treeLengths: Map<number, number> = new Map();

  // {tree: {startingIndex: [leaves]}}
  protected writeQueue: Map<number, Map<number, T[]>> = new Map();

  private lockPromise: Promise<void> | null = null;

  private lockResolve: (() => void) | null = null;

  private lockRefCount: number = 0;

  txidVersion: TXIDVersion;

  // Check function to test if merkle root is valid
  merklerootValidator: MerklerootValidator;

  isScanning = false;

  private processingWriteQueueTrees: Map<number, boolean> = new Map();

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

  protected async waitForUpdatesLock(): Promise<void> {
    if (this.lockPromise) {
      await this.lockPromise;
    }
  }

  protected acquireUpdatesLock(): unknown {
    this.lockPromise ??= new Promise<void>((resolve) => {
      this.lockResolve = resolve;
    });
    this.lockRefCount += 1;
    return this.lockPromise;
  }

  protected releaseUpdatesLock(): void {
    this.lockRefCount -= 1;
    if (this.lockRefCount <= 0 && this.lockResolve) {
      const resolve = this.lockResolve;
      this.lockPromise = null;
      this.lockResolve = null;
      this.lockRefCount = 0;
      resolve();
    }
  }

  private isCurrentLock(lock: unknown): boolean {
    return isDefined(lock) && lock === this.lockPromise;
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
    const indices = ByteUtils.nToHex(BigInt(index), ByteLength.UINT_256);

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
    return poseidonHex([left, right]);
  }

  private getTXIDVersionPrefix(): string {
    switch (this.txidVersion) {
      case TXIDVersion.V2_PoseidonMerkle:
        return 'V2';
      case TXIDVersion.V3_PoseidonMerkle:
        return 'V3';
    }
    throw new Error('Unrecognized txid version for merkletree');
  }

  getMerkletreeDBPrefix(): string[] {
    const merkletreePrefix = fromUTF8String(this.merkletreePrefix);
    const txidVersionPrefix = fromUTF8String(this.getTXIDVersionPrefix());

    return [merkletreePrefix, getChainFullNetworkID(this.chain), txidVersionPrefix].map((el) =>
      ByteUtils.formatToByteLength(el, ByteLength.UINT_256),
    );
  }

  /**
   * Construct DB prefix from tree number
   */
  getTreeDBPrefix(tree: number): string[] {
    return [...this.getMerkletreeDBPrefix(), ByteUtils.hexlify(tree)].map((el) =>
      ByteUtils.formatToByteLength(el, ByteLength.UINT_256),
    );
  }

  /**
   * Construct node hash DB path from tree number and level
   */
  private getNodeHashLevelPath(tree: number, level: number): string[] {
    return [...this.getTreeDBPrefix(tree), ByteUtils.hexlify(level)].map((el) =>
      ByteUtils.formatToByteLength(el, ByteLength.UINT_256),
    );
  }

  /**
   * Construct node hash DB path from tree number, level, and index
   */
  getNodeHashDBPath(tree: number, level: number, index: number): string[] {
    const dbPath = [...this.getNodeHashLevelPath(tree, level), ByteUtils.hexlify(index)];
    return dbPath.map((el) => ByteUtils.formatToByteLength(el, ByteLength.UINT_256));
  }

  async clearAllNodeHashes(tree: number): Promise<void> {
    this.acquireUpdatesLock();
    try {
      for (let level = 0; level < TREE_DEPTH; level += 1) {
        // eslint-disable-next-line no-await-in-loop
        await this.db.clearNamespace(this.getNodeHashLevelPath(tree, level));
      }
      if (isDefined(this.cachedNodeHashes[tree])) {
        this.cachedNodeHashes[tree] = {};
      }
    } finally {
      this.releaseUpdatesLock();
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
  protected getDataDBPath(tree: number, index: number): string[] {
    return [
      ...this.getTreeDBPrefix(tree),
      ByteUtils.hexlify(ByteUtils.FULL_32_BITS), // 2^32-1
      ByteUtils.hexlify(index),
    ].map((el) => ByteUtils.formatToByteLength(el, ByteLength.UINT_256));
  }

  async updateData(tree: number, index: number, data: T): Promise<void> {
    await this.waitForUpdatesLock();
    this.acquireUpdatesLock();
    try {
      const oldData = await this.getData(tree, index);
      if (oldData.hash !== data.hash) {
        throw new Error('Cannot update merkletree data with different hash.');
      }
      await this.db.put(this.getDataDBPath(tree, index), data, 'json');
    } catch (cause) {
      if (!(cause instanceof Error)) {
        throw new Error('Non-error thrown in Merkletree updateData', { cause });
      }
      throw new Error('Failed to update merkletree data', { cause });
    } finally {
      this.releaseUpdatesLock();
    }
  }

  protected async getData(tree: number, index: number): Promise<T> {
    try {
      const data = (await this.db.get(this.getDataDBPath(tree, index), 'json')) as T;
      return data;
    } catch (cause) {
      if (!(cause instanceof Error)) {
        throw new Error('Non-error thrown in Merkletree getData', { cause });
      }
      throw new Error('Failed to get merkletree data', { cause });
    }
  }

  protected getDataRange(tree: number, start: number, end: number): Promise<T[]> {
    return new Promise((resolve, reject) => {
      const datas: T[] = [];
      try {
        this.db
          .streamRange(this.getDataDBPath(tree, start), this.getDataDBPath(tree, end), 'json')
          .on('data', (data: T) => {
            datas.push(data);
          })
          .on('error', (cause) => {
            reject(new Error('Failed to stream merkletree data range', { cause }));
          })
          .on('end', () => {
            resolve(datas);
          });
      } catch (cause) {
        if (!(cause instanceof Error)) {
          throw new Error('Non-error thrown in Merkletree getDataRange', { cause });
        }
        throw new Error('Failed to stream merkletree data range', { cause });
      }
    });
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

  hasTreeMetadata(tree: number): boolean {
    return this.treeLengths.has(tree);
  }
  
  getTreeMetadata(tree: number): number | undefined {
    return this.treeLengths.get(tree);
  }

  async getMetadataFromStorage(): Promise<void> {
    const storedMetadata = await this.getMerkletreesMetadata();
    
    if (!storedMetadata) {
      return;
    }
  
    for (const [treeKey, treeMetadata] of Object.entries(storedMetadata.trees)) {
      const tree = Number(treeKey);
      
      // update tree lengths
      this.treeLengths.set(tree, treeMetadata.scannedHeight);
      
      // update invalid merkle root details if they exist
      if (treeMetadata.invalidMerklerootDetails) {
        this.invalidMerklerootDetailsByTree[tree] = treeMetadata.invalidMerklerootDetails;
      }
    }
  }
  
  /**
   * Gets merkletrees metadata
   * @returns metadata
   */
  async getMerkletreesMetadata(): Promise<Optional<MerkletreesMetadata>> {
    try {
      const metadata = msgpack.decode(
        ByteUtils.arrayify((await this.db.get(this.getMerkletreeDBPrefix())) as BytesData),
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
    try {
      await this.db.put(this.getMerkletreeDBPrefix(), msgpack.encode(metadata));
    } catch (cause) {
      if (!(cause instanceof Error)) {
        throw new Error('Non-error thrown in Merkletree storeMerkletreesMetadata', { cause });
      }
      if (EngineDebug.isTestRun()) {
        return;
      }
      throw new Error('Failed to store merkletrees metadata', { cause });
    }
  }


  // Tree length helper method
  protected setTreeLength(treeIndex: number, length: number): void {
    this.treeLengths.set(treeIndex, length);
  }

  // Tree length helper method
  protected hasTreeLength(treeIndex: number): boolean {
    return this.treeLengths.has(treeIndex);
  }

  // Tree length helper method
  protected clearTreeLength(treeIndex: number): void {
    this.treeLengths.delete(treeIndex);
  }

  /**
   * Gets length of tree
   * @param treeIndex - tree to get length of
   * @returns tree length
   */
  async getTreeLength(treeIndex: number): Promise<number> {
    
    // get length from cache if it exists
    const treeLength = this.treeLengths.get(treeIndex);
    if (treeLength !== undefined) {
      return treeLength;
    }

    // if cache does not exist check if its on stored metadata
    const storedMetadata = await this.getMerkletreesMetadata();
    const storedTreeMetadata = storedMetadata?.trees[treeIndex];

    if (storedTreeMetadata) {
      const storedLength = storedTreeMetadata.scannedHeight;
      // save on cache
      this.treeLengths.set(treeIndex, storedLength);
      return storedLength;
    }

    // neither on cache nor on stored metadata, get from db
    const calculatedLength = await this.getTreeLengthFromDBCount(treeIndex);
    // save on cache
    this.treeLengths.set(treeIndex, calculatedLength);
    
    // update stored metadata if found items
    if (calculatedLength > 0) {
      await this.updateStoredMerkletreesMetadata(treeIndex);
    }
  
    return calculatedLength;


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
    this.treeLengths.delete(treeIndex);
    const merkletreesMetadata = await this.getMerkletreesMetadata();
    if (!merkletreesMetadata) {
      return;
    }  
    if (treeIndex in merkletreesMetadata.trees) {
      delete merkletreesMetadata.trees[treeIndex];
      await this.storeMerkletreesMetadata(merkletreesMetadata);
    }
  }

  /**
   * WARNING: This operation takes a long time.
   */
  private async getTreeLengthFromDBCount(tree: number): Promise<number> {
    return this.db.countNamespace([
      ...this.getTreeDBPrefix(tree),
      ByteUtils.hexlify(ByteUtils.FULL_32_BITS), // 2^32-1
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
    this.acquireUpdatesLock();
    try {
      await this.db.clearNamespace(this.getMerkletreeDBPrefix());
    } finally {
      this.releaseUpdatesLock();
      this.cachedNodeHashes = {};
      this.treeLengths.clear();
    }
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
    lock?: unknown,
  ): Promise<void> {
    const newTreeLength = hashWriteGroup[0].length;

    const nodeWriteBatch: PutBatch[] = [];
    for (const [level, levelNodes] of hashWriteGroup.entries()) {
      if (!isDefined(levelNodes)) continue;
      for (const [index, node] of levelNodes.entries()) {
        if (!isDefined(node)) continue;
        nodeWriteBatch.push({
          type: 'put',
          key: this.getNodeHashDBPath(treeIndex, level, index).join(':'),
          value: node,
        });
        this.cacheNodeHash(treeIndex, level, index, node);
      }
    }

    const dataWriteBatch: PutBatch[] = [];
    const globalHashLookupBatch: PutBatch[] = [];
    for (const [index, data] of dataWriteGroup.entries()) {
      if (!isDefined(data)) continue;
      dataWriteBatch.push({
        type: 'put',
        key: this.getDataDBPath(treeIndex, index).join(':'),
        value: data,
      });
    }

    if (!this.isCurrentLock(lock)) {
      await this.waitForUpdatesLock();
    }

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
    this.treeLengths.set(treeIndex, newTreeLength);
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
    for (const leaf of leaves) {
      // Set writecache value
      firstLevelHashWriteGroup[0][index] = leaf.hash;

      dataWriteGroup[index] = leaf;

      // Increment index
      index += 1;
    }

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
  async rebuildAndWriteTree(tree: number, lock?: unknown): Promise<void> {
    const firstLevelHashWriteGroup: string[][] = [];

    firstLevelHashWriteGroup[0] = [];

    // Cannot used cached treeLength value here because it is stale.
    const treeLength = await this.getTreeLengthFromDBCount(tree);

    const leaves = await this.getDataRange(tree, 0, treeLength - 1);

    // Push values to leaves of write index
    for (const [index, leaf] of leaves.entries()) {
      if (!isDefined(leaf)) continue;
      firstLevelHashWriteGroup[0][index] = leaf.hash ?? this.zeros[0];
    }

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

    await this.writeTreeToDB(tree, hashWriteGroup, dataWriteGroup, lock);
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
    const treeWriteQueue = this.writeQueue.get(treeIndex);

    if (!treeWriteQueue) {
      return;
    }

    const writeQueueKeys = treeWriteQueue.keys();

    for (const writeQueueKey of writeQueueKeys) {
      if (!isDefined(writeQueueKey)) continue;
      const writeQueueIndex = Number(writeQueueKey);
      const alreadyAddedToTree = writeQueueIndex < currentTreeLength;
      if (alreadyAddedToTree) {
        treeWriteQueue.delete(writeQueueIndex);
      }
    }

    if (this.processingWriteQueueTrees.has(treeIndex)) {
      EngineDebug.log(
        `[processWriteQueueForTree: ${this.chain.type}:${this.chain.id}] Already processing writeQueue. Killing re-process.`,
      );
      return;
    }

    while (this.writeQueue.has(treeIndex)) {
      // Process leaves as a group until we hit an invalid merkleroot.
      // Then, process each single item.
      // This optimizes for fewer `merklerootValidator` calls, while still protecting
      // users against invalid roots and broken trees.

      this.processingWriteQueueTrees.set(treeIndex, true);

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
      } catch (cause) {
        if (!(cause instanceof Error)) {
          EngineDebug.log(`${processWriteQueuePrefix} Unknown error found. ${cause as string}`);
          return;
        }
        const ignoreInTests = true;
        const err = new Error('Failed to process merkletree write queue', { cause });
        EngineDebug.error(err, ignoreInTests);
        if (cause.message.startsWith(INVALID_MERKLE_ROOT_ERROR_MESSAGE)) {
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
      if (treeWriteQueue.size === 0) {
        this.writeQueue.delete(treeIndex);
      }
    }

    this.processingWriteQueueTrees.set(treeIndex, false);
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
    const writeQueueTree = this.writeQueue.get(treeIndex);

    if (!writeQueueTree) {
      return false;
    }

    // Get next commitment group
    const nextCommitmentGroup = writeQueueTree?.get(currentTreeLength);

    if (!nextCommitmentGroup) {
      return false;
    }

    const commitmentGroupIndices = [currentTreeLength];
    let nextIndex = currentTreeLength + nextCommitmentGroup.length;

    const dataWriteGroups: T[][] = [nextCommitmentGroup];

    while (
      maxCommitmentGroupsToProcess > dataWriteGroups.length &&
      writeQueueTree.has(treeIndex)
    ) {
      commitmentGroupIndices.push(nextIndex);
      const next = writeQueueTree.get(nextIndex);
      if (!next) continue;
      dataWriteGroups.push(next);
      nextIndex += next.length;
    }

    await this.insertLeaves(treeIndex, currentTreeLength, dataWriteGroups.flat());

    // Delete the batch after processing it.
    // Ensures bad batches are deleted, therefore halting update loop if one is found.
    for (const commitmentGroupIndex of commitmentGroupIndices) {
      writeQueueTree.delete(commitmentGroupIndex);
    }

    return true;
  }

  static numNodesPerLevel(level: number): number {
    return TREE_MAX_ITEMS >> level;
  }

  private treeIndicesFromWriteQueue(): number[] {
    const writeQueueKeys = this.writeQueue.keys();
    return Array.from(writeQueueKeys);
  }
  
  async updateTreesFromWriteQueue(): Promise<void> {
    const treeIndices = Array.from(this.writeQueue.keys());
    await Promise.all(treeIndices.map((treeIndex) => this.processWriteQueueForTree(treeIndex)));
  }

  /**
   * Adds leaves to queue to be added to tree
   * @param tree - tree number to add to
   * @param leaves - leaves to add
   * @param startingIndex - index of first leaf
   */
  async queueLeaves(tree: number, startingIndex: number, leaves: T[]): Promise<void> {
    // Get tree length
    const treeLength = await this.getTreeLength(tree);

    // Ensure write queue for tree exists
    if (!this.writeQueue.has(tree)) {
      this.writeQueue.set(tree, new Map());
    }

    if (treeLength <= startingIndex) {
      // If starting index is greater or equal to tree length, insert to queue
      const writeQueueTree = this.writeQueue.get(tree);
      writeQueueTree?.set(startingIndex, leaves)

      if (EngineDebug.verboseScanLogging()) {
        EngineDebug.log(
          `[${this.merkletreeType} queueLeaves: ${this.chain.type}:${this.chain.id}] treeLength ${treeLength}, startingIndex ${startingIndex}`,
        );
      }
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
