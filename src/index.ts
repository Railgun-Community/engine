import type { AbstractLevelDOWN } from 'abstract-leveldown';
import type { ethers } from 'ethers';
import BN from 'bn.js';
import EventEmitter from 'events';
import { RailgunLogicContract } from './contracts/railgun-logic';
import { Database, DatabaseNamespace } from './database';
import { bip39 } from './keyderivation';
import { MerkleTree } from './merkletree';
import { Prover, ArtifactsGetter } from './prover';
import { Transaction } from './transaction';
import { Note } from './note';
import { encode, decode } from './keyderivation/bech32-encode';
import { hexlify, padToLength } from './utils/bytes';
import { Wallet } from './wallet';
import { CommitmentEvent } from './contracts/railgun-logic/erc20';
import LeptonDebug from './debugger';
import { LeptonDebugger } from './models/types';
import { BytesData, Commitment, Nullifier } from './models/formatted-types';
import { LeptonEvent, MerkletreeHistoryScanEventData } from './models/event-types';

export type AccumulatedEvents = {
  commitmentEvents: CommitmentEvent[];
  nullifierEvents: Nullifier[];
};

export type QuickSync = (chainID: number, startingBlock: number) => Promise<AccumulatedEvents>;

class Lepton extends EventEmitter {
  readonly db;

  readonly merkletree: { erc20: MerkleTree /* erc721: MerkleTree */ }[] = [];

  readonly contracts: RailgunLogicContract[] = [];

  readonly prover: Prover;

  readonly wallets: { [key: string]: Wallet } = {};

  readonly deploymentBlocks: number[] = [];

  readonly quickSync: QuickSync | undefined;

  /**
   * Create a lepton instance
   * @param leveldown - abstract-leveldown compatible store
   * @param artifactsGetter - async function to retrieve artifacts, lepton doesn't handle caching
   * @param quickSync - quick sync function to speed up sync
   */
  constructor(
    leveldown: AbstractLevelDOWN,
    artifactsGetter: ArtifactsGetter,
    quickSync?: QuickSync,
    leptonDebugger?: LeptonDebugger,
  ) {
    super();
    this.db = new Database(leveldown);
    this.prover = new Prover(artifactsGetter);
    this.quickSync = quickSync;
    if (leptonDebugger) {
      LeptonDebug.init(leptonDebugger);
    }
  }

  static setLeptonDebugger = (leptonDebugger: LeptonDebugger) => {
    LeptonDebug.init(leptonDebugger);
  };

  /**
   * Handle new commitment events and kick off balance scan on wallets
   * @param {number} chainID - chainID of commitments
   * @param {number} treeNumber - tree of commitments
   * @param {number} startingIndex - starting index of commitments
   * @param {Commitment[]} leaves - commitment data from events
   */
  async listener(chainID: number, treeNumber: number, startingIndex: number, leaves: Commitment[]) {
    if (leaves.length) {
      LeptonDebug.log(`lepton.listener[${chainID}]: ${leaves.length} queued at ${startingIndex}`);
      // Queue leaves to merkle tree
      await this.merkletree[chainID].erc20.queueLeaves(treeNumber, startingIndex, leaves);
    }
  }

  /**
   * Handle new nullifiers
   * @param {number} chainID - chainID of nullifiers
   * @param {Nullifier[]} nullifiers - transaction info to nullify commitment
   */
  async nullifierListener(chainID: number, nullifiers: Nullifier[]) {
    if (nullifiers.length) {
      LeptonDebug.log(`lepton.nullifierListener[${chainID}] ${nullifiers.length}`);
      await this.merkletree[chainID].erc20.nullify(nullifiers);
    }
  }

  async getMostRecentValidCommitmentBlock(chainID: number): Promise<number | undefined> {
    const merkletree = this.merkletree[chainID].erc20;

    // Get latest tree
    const latestTree = await merkletree.latestTree();

    // Get latest synced event
    const treeLength = await merkletree.getTreeLength(latestTree);

    LeptonDebug.log(`scanHistory: treeLength ${treeLength}`);

    let startScanningBlock: number | undefined;

    let latestEventIndex = treeLength - 1;
    while (latestEventIndex >= 0 && !startScanningBlock) {
      // Get block number of last scanned event
      // eslint-disable-next-line no-await-in-loop
      const latestEvent = await this.merkletree[chainID].erc20.getCommitment(
        latestTree,
        latestEventIndex,
      );
      if (latestEvent) {
        // eslint-disable-next-line no-await-in-loop
        const { blockNumber } = await this.contracts[
          chainID
        ].contract.provider.getTransactionReceipt(hexlify(latestEvent.txid, true));
        startScanningBlock = blockNumber;
      }
      latestEventIndex -= 1;
    }

    return startScanningBlock;
  }

  async getStartScanningBlock(chainID: number): Promise<number> {
    let startScanningBlock = await this.getMostRecentValidCommitmentBlock(chainID);
    if (startScanningBlock == null) {
      // If we haven't scanned anything yet, start scanning at deployment block
      startScanningBlock = this.deploymentBlocks[chainID];
    }

    const lastSyncedBlock = await this.getLastSyncedBlock(chainID);
    if (lastSyncedBlock && lastSyncedBlock > startScanningBlock) {
      startScanningBlock = lastSyncedBlock;
    }

    return startScanningBlock;
  }

  /**
   * Scan contract history and sync
   * @param chainID - chainID to scan
   */
  async scanHistory(chainID: number) {
    this.emit(LeptonEvent.MerkletreeHistoryScanStarted, {
      chainID,
    } as MerkletreeHistoryScanEventData);

    const startScanningBlockQuickSync = await this.getStartScanningBlock(chainID);

    // Call quicksync
    if (this.quickSync) {
      try {
        LeptonDebug.log(`quickSync: chainID ${chainID}`);

        // Fetch events
        const { commitmentEvents, nullifierEvents } = await this.quickSync(
          chainID,
          startScanningBlockQuickSync,
        );

        // Pass nullifier events to listener
        await this.nullifierListener(chainID, nullifierEvents);

        // Pass events to commitments listener and wait for resolution
        commitmentEvents.forEach(async (commitmentEvent) => {
          const { treeNumber, startPosition, commitments } = commitmentEvent;
          await this.listener(chainID, treeNumber, startPosition, commitments);
        });

        // Scan after all leaves added.
        if (commitmentEvents.length) {
          await this.scanAllWallets(chainID);
        }
      } catch (err: any) {
        LeptonDebug.error(err);
      }
    }

    // Get updated start-scanning block from new valid merkletree.
    const startScanningBlockSlowScan = await this.getStartScanningBlock(chainID);

    try {
      // Run slow scan
      await this.contracts[chainID].getHistoricalEvents(
        startScanningBlockSlowScan,
        async ({ startPosition, treeNumber, commitments }: CommitmentEvent) => {
          await this.listener(chainID, treeNumber, startPosition, commitments);
        },
        async (nullifiers: Nullifier[]) => {
          await this.nullifierListener(chainID, nullifiers);
        },
        (block: number) => this.setLastSyncedBlock(block, chainID),
      );

      // Final scan after all leaves added.
      await this.scanAllWallets(chainID);
      this.emit(LeptonEvent.MerkletreeHistoryScanComplete, {
        chainID,
      } as MerkletreeHistoryScanEventData);
    } catch (err: any) {
      LeptonDebug.log(`Scan incomplete for chain ${chainID}`);
      LeptonDebug.error(err);
      await this.scanAllWallets(chainID);
      this.emit(LeptonEvent.MerkletreeHistoryScanIncomplete, {
        chainID,
      } as MerkletreeHistoryScanEventData);
    }
  }

  /**
   * Clears all merkletree leaves stored in database.
   * @param chainID - chainID to clear
   */
  async clearSyncedMerkletreeLeaves(chainID: number) {
    await this.merkletree[chainID].erc20.clearLeavesFromDB();
    await this.db.clearNamespace(Lepton.getLastSyncedBlockDBPrefix(chainID));
  }

  /**
   * Clears stored merkletree leaves and wallet balances, and re-scans fully.
   * @param chainID - chainID to rescan
   */
  async fullRescanMerkletreesAndWallets(chainID: number) {
    await this.clearSyncedMerkletreeLeaves(chainID);
    await Promise.all(this.allWallets().map((wallet) => wallet.clearScannedBalances(chainID)));
    await this.scanHistory(chainID);
  }

  /**
   * Load network
   * @param address - address of railgun instance (proxy contract)
   * @param provider - ethers provider for network
   * @param deploymentBlock - block number to start scanning from
   */
  async loadNetwork(
    chainID: number,
    address: string,
    provider: ethers.providers.JsonRpcProvider | ethers.providers.FallbackProvider,
    deploymentBlock: number,
  ) {
    LeptonDebug.log(`loadNetwork: ${chainID}`);

    // If a network with this chainID exists, unload it and load the provider as a new network
    if (this.merkletree[chainID] || this.contracts[chainID]) this.unloadNetwork(chainID);

    // Create contract instance
    const contract = new RailgunLogicContract(address, provider);
    this.contracts[chainID] = contract;

    // Create tree controllers
    this.merkletree[chainID] = {
      erc20: new MerkleTree(this.db, chainID, 'erc20', (tree, root) =>
        contract.validateRoot(tree, root),
      ),
    };

    this.deploymentBlocks[chainID] = deploymentBlock;

    // Load merkle tree to wallets
    Object.values(this.wallets).forEach((wallet) => {
      wallet.loadTree(this.merkletree[chainID].erc20);
    });

    const eventsListener = async ({ startPosition, treeNumber, commitments }: CommitmentEvent) => {
      await this.listener(chainID, treeNumber, startPosition, commitments);
      await this.scanAllWallets(chainID);
    };
    const nullifierListener = async (nullifiers: Nullifier[]) => {
      await this.nullifierListener(chainID, nullifiers);
    };
    // Setup listeners
    this.contracts[chainID].treeUpdates(eventsListener, nullifierListener);

    await this.scanHistory(chainID);
  }

  /**
   * Unload network
   * @param chainID - chainID of network to unload
   */
  unloadNetwork(chainID: number) {
    if (this.contracts[chainID]) {
      // Unload listeners
      this.contracts[chainID].unload();

      // Unlaod tree from wallets
      Object.values(this.wallets).forEach((wallet) => {
        wallet.unloadTree(chainID);
      });

      // Delete contract and merkle tree objects
      delete this.contracts[chainID];
      delete this.merkletree[chainID];
    }
  }

  private static getLastSyncedBlockDBPrefix(chainID?: number): string[] {
    const path = [DatabaseNamespace.ChainSyncInfo, 'last_synced_block'];
    if (chainID != null) path.push(hexlify(padToLength(new BN(chainID), 32)));
    return path;
  }

  /**
   * Sets last synced block to resume syncing on next load.
   * @param lastSyncedBlock - last synced block
   * @param chainID - chain to store value for
   */
  setLastSyncedBlock(lastSyncedBlock: number, chainID: number): Promise<void> {
    return this.db.put(Lepton.getLastSyncedBlockDBPrefix(chainID), lastSyncedBlock, 'utf8');
  }

  /**
   * Gets last synced block to resume syncing from.
   * @param chainID - chain to get value for
   * @returns lastSyncedBlock - last synced block
   */
  getLastSyncedBlock(chainID: number): Promise<number | undefined> {
    return this.db
      .get(Lepton.getLastSyncedBlockDBPrefix(chainID), 'utf8')
      .then((val) => parseInt(val, 10))
      .catch(() => Promise.resolve(undefined));
  }

  private async scanAllWallets(chainID: number) {
    await Promise.all(this.allWallets().map((wallet) => wallet.scanBalances(chainID)));
  }

  private allWallets(): Wallet[] {
    return Object.values(this.wallets);
  }

  /**
   * Unload wallet
   * @param id - wallet id to unload
   */
  unloadWallet(id: string) {
    delete this.wallets[id];
  }

  /**
   * Unloads everything and closes DB
   */
  unload() {
    // Unload chains
    this.contracts.forEach((contract, chainID) => {
      LeptonDebug.log(`unload contract for ${chainID}`);
      this.unloadNetwork(chainID);
    });

    // Unload wallets
    Object.keys(this.wallets).forEach((walletID) => {
      this.unloadWallet(walletID);
    });

    this.db.close();
  }

  /**
   * Get list of loaded networks
   */
  get networks(): number[] {
    return this.contracts.map((element, index) => index);
  }

  private initializeWallet(wallet: Wallet): string {
    // Store wallet against ID
    this.wallets[wallet.id] = wallet;

    // Load merkle trees for wallet
    this.merkletree.forEach((tree) => {
      wallet.loadTree(tree.erc20);
    });

    // Return wallet ID
    return wallet.id;
  }

  /**
   * Load existing wallet
   * @param {BytesData} encryptionKey - encryption key of wallet
   * @param {string} _id - wallet ID
   * @returns id
   */
  async loadExistingWallet(encryptionKey: BytesData, _id: string): Promise<string> {
    const id = hexlify(_id);
    // Instantiate wallet
    const wallet = await Wallet.loadExisting(this.db, encryptionKey, id);

    return this.initializeWallet(wallet);
  }

  /**
   * Creates wallet from mnemonic
   * @param {string} encryptionKey - encryption key of wallet
   * @param {string} mnemonic - mnemonic to load
   * @param {number} index - derivation index to load
   * @returns id
   */
  async createWalletFromMnemonic(
    encryptionKey: BytesData,
    mnemonic: string,
    index: number = 0,
  ): Promise<string> {
    // Instantiate wallet
    const wallet = await Wallet.fromMnemonic(this.db, encryptionKey, mnemonic, index);

    return this.initializeWallet(wallet);
  }

  /**
   * Generate mnemonic
   */
  static createMnemonic(): string {
    return bip39.generateMnemonic();
  }

  static encodeAddress = encode;

  static decodeAddress = decode;
}

export { Lepton, Note, Transaction };
