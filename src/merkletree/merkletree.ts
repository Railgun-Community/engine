/* eslint-disable no-await-in-loop */
import type { PutBatch } from 'abstract-leveldown';
import BN from 'bn.js';
import { poseidon } from 'circomlibjs';
import msgpack from 'msgpack-lite';
import type { Database } from '../database/database';
import {
  fromUTF8String,
  numberify,
  hexlify,
  formatToByteLength,
  ByteLength,
  nToHex,
  hexToBigInt,
  arrayify,
} from '../utils/bytes';
import EngineDebug from '../debugger/debugger';
import { BytesData, Commitment, MerkleProof, Nullifier } from '../models/formatted-types';
import { Chain } from '../models/engine-types';
import { getChainFullNetworkID } from '../chain/chain';
import { SNARK_PRIME } from '../utils/constants';
import { keccak256 } from '../utils/hash';
import { UnshieldStoredEvent } from '../models';
import { isDefined } from '../utils/is-defined';

// eslint-disable-next-line no-unused-vars
export type RootValidator = (tree: number, root: string) => Promise<boolean>;

const TREE_DEPTH = 16;

type TreeMetadata = {
  scannedHeight: number;
  invalidMerklerootDetails: InvalidMerklerootDetails | null;
};
export type MerkletreesMetadata = {
  trees: { [tree: number]: TreeMetadata };
};

// Calculate tree zero value
export const MERKLE_ZERO_VALUE: string = formatToByteLength(
  numberify(keccak256(fromUTF8String('Railgun')))
    .mod(SNARK_PRIME)
    .toString('hex'),
  ByteLength.UINT_256,
);

const INVALID_MERKLE_ROOT_ERROR_MESSAGE = 'Cannot insert leaves. Invalid merkle root.';

type InvalidMerklerootDetails = {
  position: number;
  blockNumber: number;
};

// Optimization: process leaves for a many commitment groups before checking merkleroot against contract.
// If merkleroot is invalid, scan leaves as medium batches, and individually as a final backup.
enum CommitmentProcessingGroupSize {
  XXXLarge = 8000,
  XXLarge = 1600,
  XLarge = 800,
  Large = 200,
  Medium = 40,
  Small = 10,
  Single = 1,
}

class MerkleTree {
  private db: Database;

  readonly chain: Chain;

  readonly zeros: string[] = [];

  private treeLengths: number[] = [];

  // {tree: {startingIndex: [leaves]}}
  private writeQueue: Commitment[][][] = [];

  // Check function to test if merkle root is valid
  public rootValidator: RootValidator;

  public trees: bigint[][];

  public isScanning = false;

  private processingWriteQueueTrees: { [tree: number]: boolean } = {};

  invalidMerklerootDetailsByTree: { [tree: number]: InvalidMerklerootDetails } = {};

  private cachedNodeHashes: { [tree: number]: { [level: number]: { [index: number]: string } } } =
    {};

  /**
   * Create MerkleTree controller from database
   * @param db - database object to use
   * @param chain - Chain type/id
   * @param rootValidator - root validator callback
   */
  private constructor(db: Database, chain: Chain, rootValidator: RootValidator) {
    // Set passed values
    this.db = db;
    this.chain = chain;
    this.trees = Array(TREE_DEPTH)
      .fill(0)
      .map(() => []);
    this.rootValidator = rootValidator;

    // Calculate zero values
    this.zeros[0] = MERKLE_ZERO_VALUE;
    for (let level = 1; level <= TREE_DEPTH; level += 1) {
      this.zeros[level] = MerkleTree.hashLeftRight(this.zeros[level - 1], this.zeros[level - 1]);
    }
  }

  static async create(
    db: Database,
    chain: Chain,
    rootValidator: RootValidator,
  ): Promise<MerkleTree> {
    const merkleTree = new MerkleTree(db, chain, rootValidator);
    await merkleTree.getMetadataFromStorage();
    return merkleTree;
  }

  /**
   * Gets merkle proof for leaf
   * @param tree - tree number
   * @param index - index of leaf
   * @returns Merkle proof
   */
  async getMerkleProof(tree: number, index: number): Promise<MerkleProof> {
    // Fetch leaf
    const leaf = await this.getNodeHash(tree, 0, index);

    // Get indexes of path elements to fetch
    const elementsIndexes: number[] = [index ^ 1];

    // Loop through each level and calculate index
    while (elementsIndexes.length < TREE_DEPTH) {
      // Shift right and flip last bit
      elementsIndexes.push((elementsIndexes[elementsIndexes.length - 1] >> 1) ^ 1);
    }

    // Fetch path elements
    const elements = await Promise.all(
      elementsIndexes.map((elementIndex, level) => this.getNodeHash(tree, level, elementIndex)),
    );

    // Convert index to bytes data, the binary representation is the indices of the merkle path
    // Pad to 32 bytes
    const indices = hexlify(new BN(index));

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
   * @param left - left element
   * @param right - right element
   * @returns hash
   */
  static hashLeftRight(left: string, right: string): string {
    return nToHex(poseidon([hexToBigInt(left), hexToBigInt(right)]), ByteLength.UINT_256);
  }

  /**
   * Construct DB prefix for all trees
   * @returns database prefix
   */
  getChainDBPrefix(): string[] {
    // DO NOT change this string.
    const merkletreePrefix = fromUTF8String('merkletree-erc20');

    return [merkletreePrefix, getChainFullNetworkID(this.chain)].map((el) =>
      formatToByteLength(el, ByteLength.UINT_256),
    );
  }

  /**
   * Construct DB prefix from tree number
   * @param tree - tree number
   * @returns database prefix
   */
  getTreeDBPrefix(tree: number): string[] {
    return [...this.getChainDBPrefix(), hexlify(new BN(tree))].map((el) =>
      formatToByteLength(el, ByteLength.UINT_256),
    );
  }

  /**
   * Construct node hash DB path from tree number, level, and index
   * @param tree - tree number
   * @param level - merkle tree level
   * @param index - node index
   * @returns database path
   */
  getNodeHashDBPath(tree: number, level: number, index: number): string[] {
    return [...this.getTreeDBPrefix(tree), hexlify(new BN(level)), hexlify(new BN(index))].map(
      (el) => formatToByteLength(el, ByteLength.UINT_256),
    );
  }

  /**
   * Construct commitments DB path from tree number, and index
   * @param tree - tree number
   * @param index - commitment index
   * @returns database path
   */
  getCommitmentDBPath(tree: number, index: number): string[] {
    return [
      ...this.getTreeDBPrefix(tree),
      hexlify(new BN(0).notn(32)), // 2^32-1
      hexlify(new BN(index)),
    ].map((el) => formatToByteLength(el, ByteLength.UINT_256));
  }

  /**
   * Construct DB path from nullifier
   * @param tree - tree nullifier is for
   * @param nullifier - nullifier to get path for
   * @returns database path
   */
  getNullifierDBPath(tree: number, nullifier: string): string[] {
    return [
      ...this.getTreeDBPrefix(tree),
      hexlify(new BN(0).notn(32).subn(1)), // 2^32-2
      hexlify(nullifier),
    ].map((el) => formatToByteLength(el, ByteLength.UINT_256));
  }

  /**
   * Construct DB path from unshield transaction
   * @param txid - unshield txid to get path for
   * @returns database path
   */
  getUnshieldEventsDBPath(txid?: string, eventLogIndex?: number): string[] {
    const path = [
      ...this.getChainDBPrefix(),
      hexlify(new BN(0).notn(32).subn(2)), // 2^32-3
    ];
    if (txid != null) {
      path.push(hexlify(txid));
    }
    if (eventLogIndex != null) {
      path.push(eventLogIndex.toString(16));
    }
    return path.map((el) => formatToByteLength(el, ByteLength.UINT_256));
  }

  /**
   * Gets nullifier by its id
   * @param {string} nullifier - nullifier to check
   * @returns txid of spend transaction if spent, else undefined
   */
  async getStoredNullifierTxid(nullifier: string): Promise<Optional<string>> {
    // Return if nullifier is set
    let txid: Optional<string>;
    const latestTree = await this.latestTree();
    for (let tree = latestTree; tree >= 0; tree -= 1) {
      try {
        txid = (await this.db.get(this.getNullifierDBPath(tree, nullifier))) as string;
        break;
      } catch {
        txid = undefined;
      }
    }
    return txid;
  }

  /**
   * Adds nullifiers to database
   * @param nullifiers - nullifiers to add to db
   */
  async nullify(nullifiers: Nullifier[]): Promise<void> {
    // Build write batch for nullifiers
    const nullifierWriteBatch: PutBatch[] = nullifiers.map((nullifier) => ({
      type: 'put',
      key: this.getNullifierDBPath(nullifier.treeNumber, nullifier.nullifier).join(':'),
      value: nullifier.txid,
    }));

    // Write to DB
    return this.db.batch(nullifierWriteBatch);
  }

  /**
   * Adds unshield event to database
   * @param unshields - unshield events to add to db
   */
  async addUnshieldEvents(unshields: UnshieldStoredEvent[]): Promise<void> {
    // Build write batch for nullifiers
    const writeBatch: PutBatch[] = unshields.map((unshield) => ({
      type: 'put',
      key: this.getUnshieldEventsDBPath(unshield.txid, unshield.eventLogIndex).join(':'),
      value: unshield,
    }));

    // Write to DB
    return this.db.batch(writeBatch, 'json');
  }

  /**
   * Gets Commitment from tree
   * @param tree - tree to get commitment from
   * @param index - index of commitment
   * @returns commitment
   */
  async getCommitment(tree: number, index: number): Promise<Commitment> {
    try {
      const commitment = (await this.db.get(
        this.getCommitmentDBPath(tree, index),
        'json',
      )) as Commitment;
      return commitment;
    } catch (err) {
      if (!(err instanceof Error)) {
        throw err;
      }
      throw new Error(err.message);
    }
  }

  /**
   * Gets Unshield event
   * @param txid - txid of commitment
   * @returns commitment
   */
  async getUnshieldEvents(txid: string): Promise<UnshieldStoredEvent[]> {
    const namespace = this.getUnshieldEventsDBPath(txid);
    const keys: string[] = await this.db.getNamespaceKeys(namespace);
    const keySplits = keys.map((key) => key.split(':')).filter((keySplit) => keySplit.length === 5);

    return Promise.all(
      keySplits.map(async (keySplit) => {
        const unshieldEvent = (await this.db.get(keySplit, 'json')) as UnshieldStoredEvent;
        unshieldEvent.timestamp = unshieldEvent.timestamp ?? undefined;
        return unshieldEvent;
      }),
    );
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
        arrayify((await this.db.get(this.getChainDBPrefix())) as BytesData),
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
    await this.db.put(this.getChainDBPrefix(), msgpack.encode(metadata));
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

  /**
   * WARNING: This operation takes a long time.
   */
  private async getTreeLengthFromDBCount(tree: number): Promise<number> {
    return this.db.countNamespace([
      ...this.getTreeDBPrefix(tree),
      hexlify(new BN(0).notn(32)), // 2^32-1
    ]);
  }

  async clearLeavesFromDB(): Promise<void> {
    await this.db.clearNamespace(this.getChainDBPrefix());
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
    commitmentWriteGroup: Commitment[],
  ): Promise<void> {
    // Build write batch operation
    const nodeWriteBatch: PutBatch[] = [];
    const commitmentWriteBatch: PutBatch[] = [];

    // Get new leaves
    const newTreeLength = hashWriteGroup[0].length;

    // Loop through each level
    hashWriteGroup.forEach((levelNodes, level) => {
      // Loop through each index
      levelNodes.forEach((node, index) => {
        // Push to node writeBatch array
        nodeWriteBatch.push({
          type: 'put',
          key: this.getNodeHashDBPath(treeIndex, level, index).join(':'),
          value: node,
        });
        this.cacheNodeHash(treeIndex, level, index, node);
      });
    });

    // Loop through each index
    commitmentWriteGroup.forEach((commitment, index) => {
      // Push to commitment writeBatch array
      commitmentWriteBatch.push({
        type: 'put',
        key: this.getCommitmentDBPath(treeIndex, index).join(':'),
        value: commitment,
      });
    });

    // Batch write to DB
    await Promise.all([this.db.batch(nodeWriteBatch), this.db.batch(commitmentWriteBatch, 'json')]);

    // Update tree length
    this.treeLengths[treeIndex] = newTreeLength;
    await this.updateStoredMerkletreesMetadata(treeIndex);
  }

  /**
   * Inserts array of leaves into tree
   * @param tree - Tree to insert leaves into
   * @param leaves - Leaves to insert
   * @param startIndex - Starting index of leaves to insert
   */
  private async insertLeaves(
    tree: number,
    startIndex: number,
    leaves: Commitment[],
  ): Promise<void> {
    // Start insertion at startIndex
    let index = startIndex;

    // Calculate ending index
    let endIndex = startIndex + leaves.length;

    // Start at level 0
    let level = 0;

    // Store next level index for when we begin updating the next level up
    let nextLevelStartIndex = startIndex;

    const hashWriteGroup: string[][] = [];
    const commitmentWriteGroup: Commitment[] = [];

    hashWriteGroup[level] = [];

    EngineDebug.log(`insertLeaves: startIndex ${startIndex}, group length ${leaves.length}`);

    // Push values to leaves of write index
    leaves.forEach((leaf) => {
      // Set writecache value
      hashWriteGroup[level][index] = leaf.hash;

      commitmentWriteGroup[index] = leaf;

      // Increment index
      index += 1;
    });

    // Loop through each level and calculate values
    while (level < TREE_DEPTH) {
      // Set starting index for this level
      index = nextLevelStartIndex;

      // Ensure writecache array exists for next level
      hashWriteGroup[level] = hashWriteGroup[level] ?? [];
      hashWriteGroup[level + 1] = hashWriteGroup[level + 1] ?? [];

      // Loop through every pair
      for (index; index <= endIndex + 1; index += 2) {
        if (index % 2 === 0) {
          // Left
          hashWriteGroup[level + 1][index >> 1] = MerkleTree.hashLeftRight(
            hashWriteGroup[level][index] || (await this.getNodeHash(tree, level, index)),
            hashWriteGroup[level][index + 1] || (await this.getNodeHash(tree, level, index + 1)),
          );
        } else {
          // Right
          hashWriteGroup[level + 1][index >> 1] = MerkleTree.hashLeftRight(
            hashWriteGroup[level][index - 1] || (await this.getNodeHash(tree, level, index - 1)),
            hashWriteGroup[level][index] || (await this.getNodeHash(tree, level, index)),
          );
        }
      }

      // Calculate starting and ending index for the next level
      nextLevelStartIndex >>= 1;
      endIndex >>= 1;

      // Increment level
      level += 1;
    }

    const rootNode = hashWriteGroup[TREE_DEPTH][0];
    const validRoot = await this.rootValidator(tree, rootNode);

    const leafIndex = leaves.length - 1;
    const lastLeafIndex = startIndex + leafIndex;

    if (validRoot) {
      await this.removeInvalidMerklerootDetailsIfNecessary(tree, lastLeafIndex);
    } else {
      await this.updateInvalidMerklerootDetails(tree, lastLeafIndex, leaves[leafIndex].blockNumber);
      throw new Error(
        `${INVALID_MERKLE_ROOT_ERROR_MESSAGE} Tree ${tree}, startIndex ${startIndex}, group length ${leaves.length}.`,
      );
    }

    // If new root is valid, write to DB.
    await this.writeTreeToDB(tree, hashWriteGroup, commitmentWriteGroup);
  }

  async updateInvalidMerklerootDetails(
    tree: number,
    lastKnownInvalidLeafIndex: number,
    lastKnownInvalidLeafBlockNumber: number,
  ) {
    const invalidMerklerootDetails: Optional<InvalidMerklerootDetails> =
      this.invalidMerklerootDetailsByTree[tree];
    if (isDefined(invalidMerklerootDetails)) {
      if (invalidMerklerootDetails.position < lastKnownInvalidLeafIndex) {
        return;
      }
    }

    // Update invalid merkleroot details
    this.invalidMerklerootDetailsByTree[tree] = {
      position: lastKnownInvalidLeafIndex,
      blockNumber: lastKnownInvalidLeafBlockNumber,
    };
    await this.updateStoredMerkletreesMetadata(tree);
  }

  async removeInvalidMerklerootDetailsIfNecessary(tree: number, lastValidLeafIndex: number) {
    const invalidMerklerootDetails: Optional<InvalidMerklerootDetails> =
      this.invalidMerklerootDetailsByTree[tree];
    if (!isDefined(invalidMerklerootDetails)) {
      return;
    }
    if (invalidMerklerootDetails.position > lastValidLeafIndex) {
      return;
    }
    delete this.invalidMerklerootDetailsByTree[tree];
    await this.updateStoredMerkletreesMetadata(tree);
  }

  getFirstInvalidMerklerootTree(): Optional<number> {
    const invalidTrees = Object.keys(this.invalidMerklerootDetailsByTree);
    if (!invalidTrees.length) {
      return undefined;
    }
    return Number(invalidTrees.sort()[0]);
  }

  private async processWriteQueueForTree(treeIndex: number): Promise<void> {
    let processingGroupSize = CommitmentProcessingGroupSize.XXXLarge;

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
      // This optimizes for fewer `rootValidator` calls, while still protecting
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
          const nextProcessingGroupSize = MerkleTree.nextProcessingGroupSize(processingGroupSize);
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

    const commitmentGroups: Commitment[][] = [nextCommitmentGroup];
    while (
      maxCommitmentGroupsToProcess > commitmentGroups.length &&
      isDefined(this.writeQueue[treeIndex][nextIndex])
    ) {
      commitmentGroupIndices.push(nextIndex);
      const next = this.writeQueue[treeIndex][nextIndex];
      commitmentGroups.push(next);
      nextIndex += next.length;
    }

    await this.insertLeaves(treeIndex, currentTreeLength, commitmentGroups.flat());

    // Delete the batch after processing it.
    // Ensures bad batches are deleted, therefore halting update loop if one is found.
    commitmentGroupIndices.forEach((commitmentGroupIndex) => {
      delete this.writeQueue[treeIndex][commitmentGroupIndex];
    });

    return true;
  }

  private treeIndicesFromWriteQueue(): number[] {
    return this.writeQueue
      .map((_tree, treeIndex) => treeIndex)
      .filter((index) => !Number.isNaN(index));
  }

  async updateTrees(): Promise<void> {
    const treeIndices: number[] = this.treeIndicesFromWriteQueue();
    await Promise.all(treeIndices.map((treeIndex) => this.processWriteQueueForTree(treeIndex)));
  }

  /**
   * Adds leaves to queue to be added to tree
   * @param tree - tree number to add to
   * @param leaves - leaves to add
   * @param startingIndex - index of first leaf
   */
  async queueLeaves(tree: number, startingIndex: number, leaves: Commitment[]): Promise<void> {
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
        `[queueLeaves: ${this.chain.type}:${this.chain.id}] treeLength ${treeLength}, startingIndex ${startingIndex}`,
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

  /**
   * Verifies a merkle proof
   * @param proof - proof to verify
   * @returns is valid
   */
  static verifyProof(proof: MerkleProof): boolean {
    // Get indicies as BN form
    const indices = numberify(proof.indices);

    // Calculate proof root and return if it matches the proof in the MerkleProof
    // Loop through each element and hash till we've reduced to 1 element
    const calculatedRoot = proof.elements.reduce((current, element, index) => {
      // If index is right
      if (indices.testn(index)) {
        return MerkleTree.hashLeftRight(element, current);
      }

      // If index is left
      return MerkleTree.hashLeftRight(current, element);
    }, proof.leaf);
    return hexlify(proof.root) === hexlify(calculatedRoot);
  }
}

export { MerkleTree };
