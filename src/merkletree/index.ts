/* eslint-disable no-bitwise */
import type { PutBatch } from 'abstract-leveldown';
import BN from 'bn.js';
import type { Database } from '../database';
import { constants, hash } from '../utils';
import {
  fromUTF8String,
  numberify,
  hexlify,
  formatToByteLength,
  ByteLength,
  nToHex,
  hexToBigInt,
} from '../utils/bytes';
import LeptonDebug from '../debugger';
import { Commitment, MerkleProof, Nullifier } from '../models/transaction-types';

// eslint-disable-next-line no-unused-vars
export type RootValidator = (tree: number, root: string) => Promise<boolean>;

// Declare depth
const depths = {
  erc20: 16,
  erc721: 8,
} as const;

// Declare purposes
export type TreePurpose = keyof typeof depths;

// Calculate tree zero value
export const MERKLE_ZERO_VALUE: string = formatToByteLength(
  numberify(hash.keccak256(fromUTF8String('Railgun')))
    .mod(constants.SNARK_PRIME)
    .toString('hex'),
  ByteLength.UINT_256,
);
class MerkleTree {
  private db: Database;

  readonly chainID: number;

  readonly purpose: TreePurpose;

  readonly depth: number;

  readonly zeros: string[] = [];

  private treeLengths: number[] = [];

  // tree[startingIndex[leaves]]
  private writeQueue: Commitment[][][] = [];

  // Check function to test if merkle root is valid
  public validateRoot: Function;

  public trees: bigint[][];

  private treeUpdateLock = false;

  /**
   * Create MerkleTree controller from database
   * @param db - database object to use
   * @param chainID - Chain ID to use
   * @param purpose - purpose of merkle tree
   * @param depth - merkle tree depth
   */
  constructor(
    db: Database,
    chainID: number,
    purpose: TreePurpose,
    validateRoot: RootValidator,
    depth: number = depths[purpose],
  ) {
    // Set passed values
    this.db = db;
    this.chainID = chainID;
    this.trees = Array(depth)
      .fill(0)
      .map(() => []);
    this.purpose = purpose;
    this.depth = depth;
    this.validateRoot = validateRoot;

    // Calculate zero values
    this.zeros[0] = MERKLE_ZERO_VALUE;
    for (let level = 1; level <= this.depth; level += 1) {
      this.zeros[level] = MerkleTree.hashLeftRight(this.zeros[level - 1], this.zeros[level - 1]);
    }
  }

  /**
   * Gets merkle proof for leaf
   * @param tree - tree number
   * @param index - index of leaf
   * @returns Merkle proof
   */
  async getProof(tree: number, index: number): Promise<MerkleProof> {
    // Fetch leaf
    const leaf = await this.getNode(tree, 0, index);

    // Get indexes of path elements to fetch
    const elementsIndexes: number[] = [index ^ 1];

    // Loop through each level and calculate index
    while (elementsIndexes.length < this.depth) {
      // Shift right and flip last bit
      elementsIndexes.push((elementsIndexes[elementsIndexes.length - 1] >> 1) ^ 1);
    }

    // Fetch path elements
    const elements = await Promise.all(
      elementsIndexes.map((elementIndex, level) => this.getNode(tree, level, elementIndex)),
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
    return nToHex(hash.poseidon([hexToBigInt(left), hexToBigInt(right)]), 32);
  }

  /**
   * Construct DB prefix for all trees
   * @returns database prefix
   */
  getChainDBPrefix(): string[] {
    return [fromUTF8String(`merkletree-${this.purpose}`), hexlify(new BN(this.chainID))].map(
      (element) => element.padStart(64, '0'),
    );
  }

  /**
   * Construct DB prefix from tree number
   * @param tree - tree number
   * @returns database prefix
   */
  getTreeDBPrefix(tree: number): string[] {
    return [...this.getChainDBPrefix(), hexlify(new BN(tree))].map((element) =>
      element.padStart(64, '0'),
    );
  }

  /**
   * Construct DB path from tree number, level, and index
   * @param tree - tree number
   * @param level - merkle tree level
   * @param index - node index
   * @returns database path
   */
  getNodeDBPath(tree: number, level: number, index: number): string[] {
    return [...this.getTreeDBPrefix(tree), hexlify(new BN(level)), hexlify(new BN(index))].map(
      (element) => element.padStart(64, '0'),
    );
  }

  /**
   * Construct DB path from tree number, and index
   * @param tree - tree number
   * @param index - commitment index
   * @returns database path
   */
  getCommitmentDBPath(tree: number, index: number): string[] {
    return [
      ...this.getTreeDBPrefix(tree),
      hexlify(new BN(0).notn(32)), // 2^256-1
      hexlify(new BN(index)),
    ].map((element) => element.padStart(64, '0'));
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
      hexlify(new BN(0).notn(32).subn(1)), // 2^256-2
      hexlify(nullifier),
    ].map((element) => element.padStart(64, '0'));
  }

  /**
   * Gets if a nullifier has been seen
   * @param {string} nullifier - nullifier to check
   * @returns txid of spend transaction if spent, else undefined
   */
  async getStoredNullifier(nullifier: string): Promise<string | undefined> {
    // Return if nullifier is set
    let txid: string | undefined;
    const latestTree = await this.latestTree();
    for (let tree = 0; tree < latestTree + 1; tree += 1) {
      try {
        // eslint-disable-next-line no-await-in-loop
        txid = await this.db.get(this.getNullifierDBPath(tree, nullifier));
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
   * Gets Commitment from tree
   * @param tree - tree to get commitment from
   * @param index - index of commitment
   * @returns commitment
   */
  getCommitment(tree: number, index: number): Promise<Commitment | undefined> {
    return this.db.get(this.getCommitmentDBPath(tree, index), 'json');
  }

  /**
   * Gets node from tree
   * @param tree - tree to get node from
   * @param level - tree level
   * @param index - index of node
   * @returns node
   */
  async getNode(tree: number, level: number, index: number): Promise<string> {
    try {
      const node = await this.db.get(this.getNodeDBPath(tree, level, index));
      return node;
    } catch {
      return this.zeros[level];
    }
  }

  /**
   * Gets length of tree
   * @param tree - tree to get length of
   * @returns tree length
   */
  async getTreeLength(tree: number): Promise<number> {
    this.treeLengths[tree] = this.treeLengths[tree] || (await this.getTreeLengthFromDB(tree));
    return this.treeLengths[tree];
  }

  private async getTreeLengthFromDB(tree: number): Promise<number> {
    return this.db.countNamespace([
      ...this.getTreeDBPrefix(tree),
      hexlify(new BN(0).notn(32)), // 2^256-1
    ]);
  }

  async clearLeavesFromDB(): Promise<void> {
    await this.db.clearNamespace(this.getChainDBPrefix());
    this.treeLengths = [];
  }

  /**
   * Gets node from tree
   * @param tree - tree to get root of
   * @returns tree root
   */
  getRoot(tree: number): Promise<string> {
    return this.getNode(tree, this.depth, 0);
  }

  /**
   * Write tree to DB
   * @param tree - tree to write
   */
  private async writeTreeToDB(
    tree: number,
    nodeWriteGroup: string[][],
    commitmentWriteGroup: Commitment[],
  ): Promise<void> {
    // Build write batch operation
    const nodeWriteBatch: PutBatch[] = [];
    const commitmentWriteBatch: PutBatch[] = [];

    // Get new leaves
    const newTreeLength = nodeWriteGroup[0].length;

    // Loop through each level
    nodeWriteGroup.forEach((levelNodes, level) => {
      // Loop through each index
      levelNodes.forEach((node, index) => {
        // Push to node writeBatch array
        nodeWriteBatch.push({
          type: 'put',
          key: this.getNodeDBPath(tree, level, index).join(':'),
          value: node,
        });
      });
    });

    // Loop through each index
    commitmentWriteGroup.forEach((commitment, index) => {
      // Push to commitment writeBatch array
      commitmentWriteBatch.push({
        type: 'put',
        key: this.getCommitmentDBPath(tree, index).join(':'),
        value: commitment,
      });
    });

    // Batch write to DB
    await Promise.all([this.db.batch(nodeWriteBatch), this.db.batch(commitmentWriteBatch, 'json')]);

    // Update tree length
    this.treeLengths[tree] = newTreeLength;
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

    const nodeWriteGroup: string[][] = [];
    const commitmentWriteGroup: Commitment[] = [];

    nodeWriteGroup[level] = [];

    LeptonDebug.log(
      `insertLeaves: level ${level}, depth ${this.depth}, leaves ${JSON.stringify(leaves)}`,
    );

    // Push values to leaves of write index
    leaves.forEach((leaf, leafIndex) => {
      LeptonDebug.log(`index ${leafIndex}: leaf ${JSON.stringify(leaf)}`);

      // Set writecache value
      nodeWriteGroup[level][index] = hexlify(leaf.hash);

      commitmentWriteGroup[index] = leaf;

      // Increment index
      index += 1;
    });

    // Loop through each level and calculate values
    while (level < this.depth) {
      // Set starting index for this level
      index = nextLevelStartIndex;

      // Ensure writecache array exists for next level
      nodeWriteGroup[level] = nodeWriteGroup[level] || [];
      nodeWriteGroup[level + 1] = nodeWriteGroup[level + 1] || [];

      // Loop through every pair
      for (index; index <= endIndex + 1; index += 2) {
        if (index % 2 === 0) {
          // Left
          nodeWriteGroup[level + 1][index >> 1] = MerkleTree.hashLeftRight(
            // eslint-disable-next-line no-await-in-loop
            nodeWriteGroup[level][index] || (await this.getNode(tree, level, index)),
            nodeWriteGroup[level][index + 1] ||
              // eslint-disable-next-line no-await-in-loop
              (await this.getNode(tree, level, index + 1)),
          );
        } else {
          // Right
          nodeWriteGroup[level + 1][index >> 1] = MerkleTree.hashLeftRight(
            nodeWriteGroup[level][index - 1] ||
              // eslint-disable-next-line no-await-in-loop
              (await this.getNode(tree, level, index - 1)),
            // eslint-disable-next-line no-await-in-loop
            nodeWriteGroup[level][index] || (await this.getNode(tree, level, index)),
          );
        }
      }

      // Calculate starting and ending index for the next level
      nextLevelStartIndex >>= 1;
      endIndex >>= 1;

      // Increment level
      level += 1;
    }

    // If new root is valid, write to DB.
    if (await this.validateRoot(tree, nodeWriteGroup[this.depth][0])) {
      await this.writeTreeToDB(tree, nodeWriteGroup, commitmentWriteGroup);
      return;
    }

    LeptonDebug.error(new Error('Cannot insert leaves. Invalid merkle root.'), true);
  }

  private async processWriteQueueForTree(treeIndex: number): Promise<boolean> {
    const treeWriteQueue = this.writeQueue[treeIndex];
    const currentTreeLength = await this.getTreeLength(treeIndex);

    treeWriteQueue.forEach((_writeQueue, writeQueueIndex) => {
      const alreadyAddedToTree = writeQueueIndex < currentTreeLength;
      if (alreadyAddedToTree) {
        delete treeWriteQueue[writeQueueIndex];
      }
    });

    const noElementsInTreeWriteQueue = treeWriteQueue.reduce((x) => x + 1, 0) === 0;
    if (noElementsInTreeWriteQueue) {
      // Delete treeWriteQueue.
      delete this.writeQueue[treeIndex];
    }

    let writeQueueProcessed = false;
    if (this.writeQueue[treeIndex]) {
      // If there is an element in the write queue equal to the tree length, process it.
      const writeQueueNext = this.writeQueue[treeIndex][currentTreeLength];
      if (writeQueueNext) {
        try {
          await this.insertLeaves(treeIndex, currentTreeLength, writeQueueNext);

          // Delete the batch after processing it.
          // Ensures bad batches are deleted, therefore halting update loop if one is found.
          delete this.writeQueue[treeIndex][currentTreeLength];

          writeQueueProcessed = true;
        } catch (err: any) {
          LeptonDebug.error(new Error('Could not insert leaves'));
          LeptonDebug.error(err);
        }
      }
    }

    return writeQueueProcessed;
  }

  async updateTrees(): Promise<void> {
    if (this.treeUpdateLock) {
      return;
    }
    this.treeUpdateLock = true;
    let finishedProcessing = false;

    while (!finishedProcessing) {
      let anyWritesProcessed = false;

      const treeIndices = this.writeQueue
        .map((_tree, treeIndex) => treeIndex)
        .filter((index) => !Number.isNaN(index));

      // eslint-disable-next-line no-restricted-syntax
      for (const treeIndex of treeIndices) {
        // eslint-disable-next-line no-await-in-loop
        const writeQueueProcessed = await this.processWriteQueueForTree(treeIndex);
        anyWritesProcessed = anyWritesProcessed || writeQueueProcessed;
      }

      // If no work was done, exit
      if (!anyWritesProcessed) {
        finishedProcessing = true;
      }
    }

    this.treeUpdateLock = false;
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

    LeptonDebug.log(`queueLeaves: treeLength ${treeLength}, startingIndex ${startingIndex}`);

    // Ensure write queue for tree exists
    this.writeQueue[tree] = this.writeQueue[tree] || [];

    if (treeLength <= startingIndex) {
      // If starting index is greater or equal to tree length, insert to queue
      this.writeQueue[tree][startingIndex] = leaves;
    }

    // Process tree updates

    await this.updateTrees();
  }

  /**
   * Gets latest tree
   * @returns latest tree
   */
  async latestTree(): Promise<number> {
    let latestTree = 0;
    // eslint-disable-next-line no-await-in-loop
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

export { MerkleTree, depths };
