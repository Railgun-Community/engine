import BN from 'bn.js';
import type { PutBatch } from 'abstract-leveldown';
import { Database } from '../database/database';
import { Chain } from '../models/engine-types';
import { InvalidMerklerootDetails, RootValidator } from '../models/merkletree-types';
import { ByteLength, formatToByteLength, hexlify } from '../utils/bytes';
import { Merkletree } from './merkletree';
import { Commitment, Nullifier } from '../models/formatted-types';
import { UnshieldStoredEvent } from '../models/event-types';
import { isDefined } from '../utils/is-defined';

export class UTXOMerkletree extends Merkletree<Commitment> {
  // DO NOT MODIFY
  protected merkletreePrefix = 'merkletree-erc20';

  protected merkletreeType = 'UTXO';

  private constructor(db: Database, chain: Chain, rootValidator: RootValidator) {
    super(db, chain, rootValidator);
  }

  static async create(
    db: Database,
    chain: Chain,
    rootValidator: RootValidator,
  ): Promise<UTXOMerkletree> {
    const merkletree = new UTXOMerkletree(db, chain, rootValidator);
    await merkletree.init();
    return merkletree;
  }

  /**
   * Gets Commitment from UTXO tree
   */
  async getCommitment(tree: number, index: number): Promise<Commitment> {
    try {
      const commitment = (await this.db.get(this.getDataDBPath(tree, index), 'json')) as Commitment;
      return commitment;
    } catch (err) {
      if (!(err instanceof Error)) {
        throw err;
      }
      throw new Error(err.message);
    }
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
        // eslint-disable-next-line no-await-in-loop
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

  protected validRootCallback(tree: number, lastValidLeafIndex: number): Promise<void> {
    return this.removeInvalidMerklerootDetailsIfNecessary(tree, lastValidLeafIndex);
  }

  protected invalidRootCallback(
    tree: number,
    lastKnownInvalidLeafIndex: number,
    lastKnownInvalidLeaf: Commitment,
  ): Promise<void> {
    return this.updateInvalidMerklerootDetails(
      tree,
      lastKnownInvalidLeafIndex,
      lastKnownInvalidLeaf.blockNumber,
    );
  }

  async updateInvalidMerklerootDetails(
    tree: number,
    lastKnownInvalidLeafIndex: number,
    lastKnownInvalidLeafBlockNumber: number,
  ): Promise<void> {
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
}
