import type { AbstractLevelDOWN } from 'abstract-leveldown';
import type { ethers } from 'ethers';
import BN from 'bn.js';
import EventEmitter from 'events';
import { RailgunProxyContract, CommitmentEvent } from './contracts/railgun-proxy';
import { RelayAdaptContract } from './contracts/relay-adapt';
import { Database, DatabaseNamespace } from './database';
import { bip39 } from './keyderivation';
import { MerkleTree } from './merkletree';
import { Prover, ArtifactsGetter } from './prover';
import { Transaction } from './transaction';
import { Note } from './note';
import { encode, decode } from './keyderivation/bech32-encode';
import { hexlify, padToLength } from './utils/bytes';
import { Wallet } from './wallet/wallet';
import LeptonDebug from './debugger';
import { LeptonDebugger } from './models/lepton-types';
import { Commitment, Nullifier } from './models/formatted-types';
import {
  LeptonEvent,
  MerkletreeHistoryScanEventData,
  MerkletreeHistoryScanUpdateData,
} from './models/event-types';
import { ViewOnlyWallet } from './wallet/view-only-wallet';
import { AbstractWallet } from './wallet/abstract-wallet';

export type AccumulatedEvents = {
  commitmentEvents: CommitmentEvent[];
  nullifierEvents: Nullifier[];
};

export type QuickSync = (chainID: number, startingBlock: number) => Promise<AccumulatedEvents>;

class Lepton extends EventEmitter {
  readonly db;

  readonly merkletree: { erc20: MerkleTree /* erc721: MerkleTree */ }[] = [];

  readonly proxyContracts: RailgunProxyContract[] = [];

  readonly relayAdaptContracts: RelayAdaptContract[] = [];

  readonly prover: Prover;

  readonly wallets: { [key: string]: AbstractWallet } = {};

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

    LeptonDebug.log(`scanHistory: latestTree ${latestTree}, treeLength ${treeLength}`);

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
        const txReceipt = await this.proxyContracts[
          chainID
        ].contract.provider.getTransactionReceipt(hexlify(latestEvent.txid, true));
        if (txReceipt) {
          startScanningBlock = txReceipt.blockNumber;
        } else {
          LeptonDebug.log(
            `Could not find tx receipt for latest event: ${latestEvent.txid}. Trying prior index.`,
          );
        }
      } else {
        LeptonDebug.log(
          `Could not find latest event for index ${latestEventIndex}. Trying prior index.`,
        );
      }
      latestEventIndex -= 1;
    }

    return startScanningBlock;
  }

  async getStartScanningBlock(chainID: number): Promise<number> {
    let startScanningBlock = await this.getMostRecentValidCommitmentBlock(chainID);
    LeptonDebug.log(`most recent valid commitment block: ${startScanningBlock}`);
    if (startScanningBlock == null) {
      // If we haven't scanned anything yet, start scanning at deployment block
      startScanningBlock = this.deploymentBlocks[chainID];
    }

    const lastSyncedBlock = await this.getLastSyncedBlock(chainID);
    LeptonDebug.log(`last synced block: ${startScanningBlock}`);
    if (lastSyncedBlock && lastSyncedBlock > startScanningBlock) {
      startScanningBlock = lastSyncedBlock;
    }

    return startScanningBlock;
  }

  private async performQuickScan(chainID: number, endProgress: number) {
    if (!this.quickSync) {
      return;
    }
    try {
      LeptonDebug.log(`quickSync: chainID ${chainID}`);
      const merkletree = this.merkletree[chainID].erc20;

      const startScanningBlockQuickSync = await this.getStartScanningBlock(chainID);

      // Fetch events
      const { commitmentEvents, nullifierEvents } = await this.quickSync(
        chainID,
        startScanningBlockQuickSync,
      );

      this.emitScanUpdateEvent(chainID, endProgress * 0.3); // 3%
      // Pass nullifier events to listener
      await this.nullifierListener(chainID, nullifierEvents);

      // Pass events to commitments listener and wait for resolution
      await Promise.all(
        commitmentEvents.map(async (commitmentEvent) => {
          const { treeNumber, startPosition, commitments } = commitmentEvent;
          await this.listener(chainID, treeNumber, startPosition, commitments);
        }),
      );

      // Scan after all leaves added.
      if (commitmentEvents.length) {
        this.emitScanUpdateEvent(chainID, endProgress * 0.5); // 6%
        await merkletree.waitForTreesToFullyUpdate();
        this.emitScanUpdateEvent(chainID, endProgress * 0.8); // 9%
        await this.scanAllWallets(chainID);
      }
    } catch (err: any) {
      LeptonDebug.error(err);
    }
  }

  private emitScanUpdateEvent(chainID: number, progress: number) {
    const updateData: MerkletreeHistoryScanUpdateData = {
      chainID,
      progress,
    };
    this.emit(LeptonEvent.MerkletreeHistoryScanUpdate, updateData);
  }

  /**
   * Scan contract history and sync
   * @param chainID - chainID to scan
   */
  async scanHistory(chainID: number) {
    if (!this.merkletree[chainID]) {
      LeptonDebug.log(`Cannot scan history. Merkletree not yet loaded for chain ${chainID}.`);
      return;
    }
    const merkletree = this.merkletree[chainID].erc20;
    if (merkletree.isScanning) {
      // Do not allow multiple simultaneous scans.
      LeptonDebug.log('Already scanning. Killing additional re-scan.');
      return;
    }
    merkletree.isScanning = true;

    this.emitScanUpdateEvent(chainID, 0.01); // 1%

    const postQuickSyncProgress = 0.1;
    await this.performQuickScan(chainID, postQuickSyncProgress);

    this.emitScanUpdateEvent(chainID, postQuickSyncProgress); // 10%

    // Get updated start-scanning block from new valid merkletree.
    const startScanningBlockSlowScan = await this.getStartScanningBlock(chainID);
    LeptonDebug.log(`startScanningBlockSlowScan: ${startScanningBlockSlowScan}`);

    const latestBlock = (await this.proxyContracts[chainID].contract.provider.getBlock('latest'))
      .number;
    const totalBlocksToScan = latestBlock - startScanningBlockSlowScan;

    try {
      // Run slow scan
      await this.proxyContracts[chainID].getHistoricalEvents(
        startScanningBlockSlowScan,
        latestBlock,
        async ({ startPosition, treeNumber, commitments }: CommitmentEvent) => {
          await this.listener(chainID, treeNumber, startPosition, commitments);
        },
        async (nullifiers: Nullifier[]) => {
          await this.nullifierListener(chainID, nullifiers);
        },
        async (syncedBlock: number) => {
          const scannedBlocks = syncedBlock - startScanningBlockSlowScan;
          const scanUpdateData: MerkletreeHistoryScanUpdateData = {
            chainID,
            progress:
              postQuickSyncProgress +
              ((1 - postQuickSyncProgress) * scannedBlocks) / totalBlocksToScan, // From 10% -> 100%
          };
          this.emit(LeptonEvent.MerkletreeHistoryScanUpdate, scanUpdateData);
          await this.setLastSyncedBlock(syncedBlock, chainID);
        },
      );

      // Final scan after all leaves added.
      await this.scanAllWallets(chainID);
      const scanCompleteData: MerkletreeHistoryScanEventData = { chainID };
      this.emit(LeptonEvent.MerkletreeHistoryScanComplete, scanCompleteData);
      merkletree.isScanning = false;
    } catch (err: any) {
      LeptonDebug.log(`Scan incomplete for chain ${chainID}`);
      LeptonDebug.error(err);
      await this.scanAllWallets(chainID);
      const scanIncompleteData: MerkletreeHistoryScanEventData = { chainID };
      this.emit(LeptonEvent.MerkletreeHistoryScanIncomplete, scanIncompleteData);
      merkletree.isScanning = false;
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
    if (!this.merkletree[chainID]) {
      LeptonDebug.log(`Cannot re-scan history. Merkletree not yet loaded for chain ${chainID}.`);
      return;
    }
    if (this.merkletree[chainID].erc20.isScanning) {
      LeptonDebug.log('Already scanning. Killing full re-scan.');
      return;
    }
    await this.clearSyncedMerkletreeLeaves(chainID);
    await Promise.all(this.allWallets().map((wallet) => wallet.clearScannedBalances(chainID)));
    await this.scanHistory(chainID);
  }

  /**
   * Load network
   * @param proxyContractAddress - address of railgun instance (proxy contract)
   * @param relayAdaptContractAddress - address of railgun instance (proxy contract)
   * @param provider - ethers provider for network
   * @param deploymentBlock - block number to start scanning from
   */
  async loadNetwork(
    chainID: number,
    proxyContractAddress: string,
    relayAdaptContractAddress: string,
    provider: ethers.providers.JsonRpcProvider | ethers.providers.FallbackProvider,
    deploymentBlock: number,
  ) {
    LeptonDebug.log(`loadNetwork: ${chainID}`);

    // If a network with this chainID exists, unload it and load the provider as a new network
    if (
      this.merkletree[chainID] ||
      this.proxyContracts[chainID] ||
      this.relayAdaptContracts[chainID]
    )
      this.unloadNetwork(chainID);

    // Create proxy contract instance
    const proxyContract = new RailgunProxyContract(proxyContractAddress, provider);
    this.proxyContracts[chainID] = proxyContract;

    // Create relay adapt contract instance
    const relayAdaptContract = new RelayAdaptContract(relayAdaptContractAddress, provider);
    this.relayAdaptContracts[chainID] = relayAdaptContract;

    // Create tree controllers
    this.merkletree[chainID] = {
      erc20: new MerkleTree(this.db, chainID, 'erc20', (tree, root) =>
        proxyContract.validateRoot(tree, root),
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
    this.proxyContracts[chainID].treeUpdates(eventsListener, nullifierListener);

    await this.scanHistory(chainID);
  }

  /**
   * Unload network
   * @param chainID - chainID of network to unload
   */
  unloadNetwork(chainID: number) {
    if (this.proxyContracts[chainID]) {
      // Unload listeners
      this.proxyContracts[chainID].unload();

      // Unlaod tree from wallets
      Object.values(this.wallets).forEach((wallet) => {
        wallet.unloadTree(chainID);
      });

      // Delete contract and merkle tree objects
      delete this.proxyContracts[chainID];
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

  private allWallets(): AbstractWallet[] {
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
    this.proxyContracts.forEach((contract, chainID) => {
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
    return this.proxyContracts.map((element, index) => index);
  }

  private loadWallet(wallet: AbstractWallet): void {
    // Store wallet against ID
    this.wallets[wallet.id] = wallet;

    // Load merkle trees for wallet
    this.merkletree.forEach((tree) => {
      wallet.loadTree(tree.erc20);
    });
  }

  /**
   * Load existing wallet
   * @param {string} encryptionKey - encryption key of wallet
   * @param {string} id - wallet ID
   * @returns id
   */
  async loadExistingWallet(encryptionKey: string, id: string): Promise<Wallet> {
    const wallet = await Wallet.loadExisting(this.db, encryptionKey, id);
    this.loadWallet(wallet);
    return wallet;
  }

  /**
   * Load existing wallet
   * @param {string} encryptionKey - encryption key of wallet
   * @param {string} id - wallet ID
   * @returns id
   */
  async loadExistingViewOnlyWallet(encryptionKey: string, id: string): Promise<ViewOnlyWallet> {
    const wallet = await ViewOnlyWallet.loadExisting(this.db, encryptionKey, id);
    this.loadWallet(wallet);
    return wallet;
  }

  /**
   * Creates wallet from mnemonic
   * @param {string} encryptionKey - encryption key of wallet
   * @param {string} mnemonic - mnemonic to load
   * @param {number} index - derivation index to load
   * @returns id
   */
  async createWalletFromMnemonic(
    encryptionKey: string,
    mnemonic: string,
    index: number = 0,
  ): Promise<Wallet> {
    const wallet = await Wallet.fromMnemonic(this.db, encryptionKey, mnemonic, index);
    this.loadWallet(wallet);
    return wallet;
  }

  async createViewOnlyWalletFromShareableViewingKey(
    encryptionKey: string,
    shareableViewingKey: string,
  ): Promise<ViewOnlyWallet> {
    const wallet = await ViewOnlyWallet.fromShareableViewingKey(
      this.db,
      encryptionKey,
      shareableViewingKey,
    );
    this.loadWallet(wallet);
    return wallet;
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
