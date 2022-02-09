/* eslint-disable no-bitwise, no-await-in-loop */
import BN from 'bn.js';
import type { AbstractBatch } from 'abstract-leveldown';
import { bytes, hash, constants } from '../utils';
import type { Database } from '../database';
import type { Ciphertext } from '../utils/encryption';
import type { ERC20NoteSerialized } from '../note/erc20';
import { LeptonDebugger } from '../models/types';

export type MerkleProof = {
  leaf: bytes.BytesData;
  elements: bytes.BytesData[];
  indices: bytes.BytesData;
  root: bytes.BytesData;
};

export type GeneratedCommitment = {
  hash: bytes.BytesData;
  txid: bytes.BytesData;
  data: ERC20NoteSerialized; // | ERC721NoteSerialized
};

export type EncryptedCommitment = {
  hash: bytes.BytesData;
  txid: bytes.BytesData;
  senderPubKey: bytes.BytesData;
  ciphertext: Ciphertext;
};

export type Commitment = GeneratedCommitment | EncryptedCommitment;

export type Nullifier = {
  nullifier: bytes.BytesData;
  txid: bytes.BytesData;
};

// eslint-disable-next-line no-unused-vars
export type RootValidator = (tree: number, root: bytes.BytesData) => Promise<boolean>;

// Declare depth
const depths = {
  erc20: 16,
  erc721: 8,
} as const;

// Declare purposes
export type TreePurpose = keyof typeof depths;

// Calculate tree zero value
const MERKLE_ZERO_VALUE: string = bytes.hexlify(
  bytes.numberify(hash.keccak256(bytes.fromUTF8String('Railgun'))).mod(constants.SNARK_PRIME),
);

class MerkleTree {
  private db: Database;

  readonly chainID: number;

  readonly purpose: TreePurpose;

  readonly leptonDebugger: LeptonDebugger | undefined;

  readonly depth: number;

  readonly zeroValues: string[] = [];

  private treeLengthCache: number[] = [];

  // tree[level[index]]
  private nodeWriteCache: bytes.BytesData[][][] = [];

  // tree[index]
  private commitmentWriteCache: Commitment[][] = [];

  // tree[startingIndex[leaves]]
  private writeQueue: Commitment[][][] = [];

  // Check function to test if merkle root is valid
  private validateRoot: Function;

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
    leptonDebugger?: LeptonDebugger,
    depth: number = depths[purpose],
  ) {
    // Set passed values
    this.db = db;
    this.chainID = chainID;
    this.purpose = purpose;
    this.leptonDebugger = leptonDebugger;
    this.depth = depth;
    this.validateRoot = validateRoot;

    // Calculate zero values
    this.zeroValues[0] = MERKLE_ZERO_VALUE;
    for (let level = 1; level <= this.depth; level += 1) {
      this.zeroValues[level] = MerkleTree.hashLeftRight(
        this.zeroValues[level - 1],
        this.zeroValues[level - 1],
      );
    }
  }

  /**
   * Hash 2 elements together
   * @param left - left element
   * @param right - right element
   * @returns hash
   */
  static hashLeftRight(left: bytes.BytesData, right: bytes.BytesData): string {
    return hash.poseidon([left, right]);
  }

  /**
   * Clears write cache of merkle tree
   * @param tree - tree number to clear
   */
  clearWriteCache(tree: number) {
    this.nodeWriteCache[tree] = [];
    this.commitmentWriteCache[tree] = [];
  }

  /**
   * Construct DB prefix from tree number, level
   * @param tree - tree number
   * @param level - merkle tree level
   * @returns database prefix
   */
  getTreeDBPrefix(tree: number): string[] {
    return [
      bytes.fromUTF8String(`merkletree-${this.purpose}`),
      bytes.hexlify(new BN(this.chainID)),
      bytes.hexlify(new BN(tree)),
    ].map((element) => element.padStart(64, '0'));
  }

  /**
   * Construct DB path from tree number, level, and index
   * @param tree - tree number
   * @param level - merkle tree level
   * @param index - node index
   * @returns database path
   */
  getNodeDBPath(tree: number, level: number, index: number): string[] {
    return [
      ...this.getTreeDBPrefix(tree),
      bytes.hexlify(new BN(level)),
      bytes.hexlify(new BN(index)),
    ].map((element) => element.padStart(64, '0'));
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
      bytes.hexlify(new BN(0).notn(32)), // 2^256-1
      bytes.hexlify(new BN(index)),
    ].map((element) => element.padStart(64, '0'));
  }

  /**
   * Construct DB path from nullifier
   * @param nullifier - nullifier to get path for
   * @returns database path
   */
  getNullifierDBPath(nullifier: bytes.BytesData): string[] {
    return [
      bytes.fromUTF8String(`merkletree-${this.purpose}`),
      bytes.hexlify(new BN(this.chainID)),
      bytes.hexlify(new BN(0).notn(32)), // 2^256-1
      bytes.hexlify(nullifier),
    ].map((element) => element.padStart(64, '0'));
  }

  /**
   * Gets if a nullifier has been seen
   * @param nullifier - nullifier to check
   * @returns txid of spend transaction if spent, else false
   */
  async getNullified(nullifier: bytes.BytesData): Promise<string | false> {
    // Return if nullifier is set
    try {
      return await this.db.get(this.getNullifierDBPath(nullifier));
    } catch {
      return false;
    }
  }

  /**
   * Adds nullifiers to database
   * @param nullifiers - nullifiers to add to db
   */
  async nullify(nullifiers: Nullifier[]): Promise<void> {
    // Build write batch for nullifiers
    const nullifierWriteBatch: AbstractBatch[] = nullifiers.map((nullifier) => ({
      type: 'put',
      key: this.getNullifierDBPath(bytes.hexlify(nullifier.nullifier)).join(':'),
      value: bytes.hexlify(nullifier.txid),
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
  getCommitment(tree: number, index: number): Promise<Commitment> {
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
      return await this.db.get(this.getNodeDBPath(tree, level, index));
    } catch {
      return this.zeroValues[level];
    }
  }

  /**
   * Gets length of tree
   * @param tree - tree to get length of
   * @retruns tree length
   */
  async getTreeLength(tree: number): Promise<number> {
    this.treeLengthCache[tree] =
      this.treeLengthCache[tree] ||
      (await this.db.countNamespace([
        ...this.getTreeDBPrefix(tree),
        bytes.hexlify(new BN(0).notn(32)), // 2^256-1
      ]));

    return this.treeLengthCache[tree];
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
   * Write tree cache to DB
   * @param tree - tree to write
   */
  private async writeTreeCache(tree: number): Promise<void> {
    // Build write batch operation
    const nodeWriteBatch: AbstractBatch[] = [];
    const commitmentWriteBatch: AbstractBatch[] = [];

    // Get new leaves
    const newTreeLength = this.nodeWriteCache[tree][0].length;

    // Loop through each level
    this.nodeWriteCache[tree].forEach((levelElement, level) => {
      // Loop through each index
      levelElement.forEach((node, index) => {
        // Push to node writeBatch array
        nodeWriteBatch.push({
          type: 'put',
          key: this.getNodeDBPath(tree, level, index).join(':'),
          value: node,
        });
      });
    });

    // Loop through each index
    this.commitmentWriteCache[tree].forEach((commitment, index) => {
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
    this.treeLengthCache[tree] = newTreeLength;

    // Clear write cache
    this.clearWriteCache(tree);
  }

  /**
   * Inserts array of leaves into tree
   * @param tree - Tree to insert leaves into
   * @param leaves - Leaves to insert
   * @param startIndex - Starting index of leaves to insert
   */
  private async insertLeaves(tree: number, startIndex: number, leaves: Commitment[]) {
    // Clear write cache before starting to avoid errors from leftover data
    this.clearWriteCache(tree);

    // Start insertion at startIndex
    let index = startIndex;

    // Calculate ending index
    let endIndex = startIndex + leaves.length;

    // Start at level 0
    let level = 0;

    // Store next level index for when we begin updating the next level up
    let nextLevelStartIndex = startIndex;

    // Ensure writecache array exists
    this.nodeWriteCache[tree][level] = this.nodeWriteCache[tree][level] || [];

    this.leptonDebugger?.log(
      `insertLeaves: level ${level}, depth ${this.depth}, leaves ${JSON.stringify(leaves)}`,
    );

    // Push values to leaves of write index
    leaves.forEach((leaf, leafIndex) => {
      this.leptonDebugger?.log(`index ${leafIndex}: leaf ${JSON.stringify(leaf)}`);

      // Set writecache value
      this.nodeWriteCache[tree][level][index] = bytes.hexlify(leaf.hash);

      if ('ciphertext' in leaf) {
        this.commitmentWriteCache[tree][index] = {
          hash: bytes.hexlify(leaf.hash),
          txid: bytes.hexlify(leaf.txid),
          senderPubKey: bytes.hexlify(leaf.senderPubKey),
          ciphertext: {
            iv: bytes.hexlify(leaf.ciphertext.iv),
            data: leaf.ciphertext.data.map((element) => bytes.hexlify(element)),
          },
        };
      } else {
        this.commitmentWriteCache[tree][index] = {
          hash: bytes.hexlify(leaf.hash),
          txid: bytes.hexlify(leaf.txid),
          data: {
            pubkey: bytes.hexlify(leaf.data.pubkey),
            random: bytes.hexlify(leaf.data.random),
            amount: bytes.hexlify(leaf.data.amount),
            token: bytes.hexlify(leaf.data.token),
          },
        };
      }

      // Increment index
      index += 1;
    });

    // Loop through each level and calculate values
    while (level < this.depth) {
      // Set starting index for this level
      index = nextLevelStartIndex;

      // Ensure writecache array exists for next level
      this.nodeWriteCache[tree][level + 1] = this.nodeWriteCache[tree][level + 1] || [];

      // Loop through every pair
      for (index; index <= endIndex + 1; index += 2) {
        if (index % 2 === 0) {
          // Left
          this.nodeWriteCache[tree][level + 1][index >> 1] = MerkleTree.hashLeftRight(
            this.nodeWriteCache[tree][level][index] || (await this.getNode(tree, level, index)),
            this.nodeWriteCache[tree][level][index + 1] ||
              (await this.getNode(tree, level, index + 1)),
          );
        } else {
          // Right
          this.nodeWriteCache[tree][level + 1][index >> 1] = MerkleTree.hashLeftRight(
            this.nodeWriteCache[tree][level][index - 1] ||
              (await this.getNode(tree, level, index - 1)),
            this.nodeWriteCache[tree][level][index] || (await this.getNode(tree, level, index)),
          );
        }
      }

      // Calculate starting and ending index for the next level
      nextLevelStartIndex >>= 1;
      endIndex >>= 1;

      // Increment level
      level += 1;
    }

    // Check if new root is valid
    if (await this.validateRoot(tree, this.nodeWriteCache[tree][this.depth][0])) {
      // Commit to DB if valid
      await this.writeTreeCache(tree);
    } else {
      // Clear cache if invalid
      this.clearWriteCache(tree);
    }
  }

  async updateTrees() {
    // Loop until there isn't work to do
    let workToDo = true;

    while (workToDo) {
      const treeLengthPromises: Promise<number>[] = [];

      // Loop through each tree present in write queue and get tree length
      this.writeQueue.forEach((tree, index) => {
        treeLengthPromises[index] = this.getTreeLength(index);
      });

      // eslint-disable-next-line no-await-in-loop
      const treeLengths = await Promise.all(treeLengthPromises);

      const updatePromises: (Promise<void> | null)[] = [];

      // Loop through each tree and check if there are updates to be made
      this.writeQueue.forEach((tree, treeIndex) => {
        // If there aren't any elements in the write queue delete it
        if (tree.reduce((x) => x + 1, 0) === 0) delete this.writeQueue[treeIndex];

        // If there is an element in the write queue equal to the tree length, process it
        if (this.writeQueue[treeIndex]?.[treeLengths[treeIndex]]) {
          updatePromises.push(
            this.insertLeaves(
              treeIndex,
              treeLengths[treeIndex],
              this.writeQueue[treeIndex][treeLengths[treeIndex]],
            ),
          );

          // Delete the batch after processing it
          // Ensures bad batches are deleted therefore halting update loop if one is found
          delete this.writeQueue[treeIndex][treeLengths[treeIndex]];
        }
      });

      // Wait for updates to complete
      // eslint-disable-next-line no-await-in-loop
      await Promise.all(updatePromises);

      // If no work was done exit
      if (updatePromises.length === 0) workToDo = false;
    }
  }

  /**
   * Adds leaves to queue to be added to tree
   * @param tree - tree number to add to
   * @param leaves - leaves to add
   * @param startingIndex - index of first leaf
   */
  async queueLeaves(tree: number, startingIndex: number, leaves: Commitment[]) {
    // Get tree length
    const treeLength = await this.getTreeLength(tree);

    this.leptonDebugger?.log(
      `queueLeaves: treeLength ${treeLength}, startingIndex ${startingIndex}`,
    );

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
  async latestTree() {
    let latestTree = 0;
    while ((await this.getTreeLength(latestTree)) > 0) latestTree += 1;
    return Math.max(0, latestTree - 1);
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
    const indices = bytes.hexlify(new BN(index));

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
   * Verifies a merkle proof
   * @param proof - proof to verify
   * @returns is valid
   */
  static verifyProof(proof: MerkleProof): boolean {
    // Get indicies as BN form
    const indices = bytes.numberify(proof.indices);

    // Calculate proof root and return if it matches the proof in the MerkleProof
    return (
      bytes.hexlify(proof.root) ===
      bytes.hexlify(
        // Loop through each element and hash till we've reduced to 1 element
        proof.elements.reduce((current, element, index) => {
          // If index is right
          if (indices.testn(index)) {
            return MerkleTree.hashLeftRight(element, current);
          }

          // If index is left
          return MerkleTree.hashLeftRight(current, element);
        }, proof.leaf),
      )
    );
  }
}

export { MerkleTree, depths };
