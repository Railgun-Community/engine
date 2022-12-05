import type { AbstractLevelDOWN } from 'abstract-leveldown';
import type { ethers } from 'ethers';
import EventEmitter from 'events';
import { RailgunProxyContract } from './contracts/railgun-proxy/railgun-proxy';
import { RelayAdaptContract } from './contracts/relay-adapt/relay-adapt';
import { Database, DatabaseNamespace } from './database/database';
import { MerkleTree } from './merkletree/merkletree';
import { Prover } from './prover/prover';
import { encodeAddress, decodeAddress } from './key-derivation/bech32';
import { hexlify } from './utils/bytes';
import { RailgunWallet } from './wallet/railgun-wallet';
import EngineDebug from './debugger/debugger';
import { Chain, EngineDebugger } from './models/engine-types';
import { Commitment, Nullifier } from './models/formatted-types';
import {
  CommitmentEvent,
  EngineEvent,
  MerkletreeHistoryScanEventData,
  MerkletreeHistoryScanUpdateData,
  QuickSync,
  UnshieldStoredEvent,
} from './models/event-types';
import { ViewOnlyWallet } from './wallet/view-only-wallet';
import { AbstractWallet } from './wallet/abstract-wallet';
import WalletInfo from './wallet/wallet-info';
import { getChainFullNetworkID } from './chain/chain';
import { ArtifactsGetter } from './models/prover-types';

class RailgunEngine extends EventEmitter {
  readonly db;

  readonly merkletrees: { erc20: MerkleTree /* erc721: MerkleTree */ }[][] = [];

  readonly proxyContracts: RailgunProxyContract[][] = [];

  readonly relayAdaptContracts: RelayAdaptContract[][] = [];

  readonly prover: Prover;

  readonly wallets: { [key: string]: AbstractWallet } = {};

  readonly deploymentBlocks: number[][] = [];

  readonly quickSync: Optional<QuickSync>;

  static walletSource: Optional<string>;

  /**
   * Create a RAILGUN Engine instance.
   * @param walletSource - string representing your wallet's name (16 char max, lowercase and numerals only)
   * @param leveldown - abstract-leveldown compatible store
   * @param artifactsGetter - async function to retrieve artifacts, engine doesn't handle caching
   * @param quickSync - quick sync function to speed up sync
   * @param engineDebugger - log and error callbacks for verbose logging
   */
  constructor(
    walletSource: string,
    leveldown: AbstractLevelDOWN,
    artifactsGetter: ArtifactsGetter,
    quickSync?: QuickSync,
    engineDebugger?: EngineDebugger,
  ) {
    super();

    WalletInfo.setWalletSource(walletSource);
    this.db = new Database(leveldown);
    this.prover = new Prover(artifactsGetter);
    this.quickSync = quickSync;
    if (engineDebugger) {
      EngineDebug.init(engineDebugger);
    }
  }

  static setEngineDebugger = (engineDebugger: EngineDebugger): void => {
    EngineDebug.init(engineDebugger);
  };

  /**
   * Handle new commitment events and kick off balance scan on wallets
   * @param chain - chain type/id for commitments
   * @param treeNumber - tree of commitments
   * @param startingIndex - starting index of commitments
   * @param leaves - commitment data from events
   */
  async commitmentListener(
    chain: Chain,
    treeNumber: number,
    startingIndex: number,
    leaves: Commitment[],
    shouldUpdateTrees: boolean,
  ): Promise<void> {
    if (!leaves.length) {
      return;
    }
    EngineDebug.log(
      `[commitmentListener: ${chain.type}:${chain.id}]: ${leaves.length} leaves at ${startingIndex}`,
    );
    // Queue leaves to merkle tree
    await this.merkletrees[chain.type][chain.id].erc20.queueLeaves(
      treeNumber,
      startingIndex,
      leaves,
    );
    if (shouldUpdateTrees) {
      await this.merkletrees[chain.type][chain.id].erc20.updateTrees();
    }
  }

  /**
   * Handle new nullifiers
   * @param chain - chain type/id for nullifiers
   * @param nullifiers - transaction info to nullify commitment
   */
  async nullifierListener(chain: Chain, nullifiers: Nullifier[]): Promise<void> {
    if (!nullifiers.length) {
      return;
    }
    EngineDebug.log(`engine.nullifierListener[${chain.type}:${chain.id}] ${nullifiers.length}`);
    await this.merkletrees[chain.type][chain.id].erc20.nullify(nullifiers);
  }

  /**
   * Handle new unshield events
   * @param chain - chain type/id
   * @param unshields - unshield events
   */
  async unshieldListener(chain: Chain, unshields: UnshieldStoredEvent[]): Promise<void> {
    if (!unshields.length) {
      return;
    }
    EngineDebug.log(
      `engine.unshieldListener[${chain.type}:${chain.id}] ${JSON.stringify(
        unshields.map((unshield) => unshield.txid),
      )}`,
    );
    await this.merkletrees[chain.type][chain.id].erc20.addUnshieldEvents(unshields);
  }

  async getMostRecentValidCommitmentBlock(chain: Chain): Promise<Optional<number>> {
    const merkletree = this.merkletrees[chain.type][chain.id].erc20;
    const proxyContract = this.proxyContracts[chain.type][chain.id];
    const { provider } = proxyContract.contract;

    // Get latest tree
    const latestTree = await merkletree.latestTree();

    // Get latest synced event
    const treeLength = await merkletree.getTreeLength(latestTree);

    EngineDebug.log(`scanHistory: latestTree ${latestTree}, treeLength ${treeLength}`);

    let startScanningBlock: Optional<number>;

    let latestEventIndex = treeLength - 1;
    while (latestEventIndex >= 0 && !startScanningBlock) {
      // Get block number of last scanned event
      // eslint-disable-next-line no-await-in-loop
      const latestEvent = await merkletree.getCommitment(latestTree, latestEventIndex);
      if (latestEvent) {
        if (latestEvent.blockNumber) {
          startScanningBlock = latestEvent.blockNumber;
        } else {
          // eslint-disable-next-line no-await-in-loop
          const txReceipt = await provider.getTransactionReceipt(hexlify(latestEvent.txid, true));
          if (txReceipt) {
            startScanningBlock = txReceipt.blockNumber;
          }
        }
      } else {
        EngineDebug.log(
          `Could not find latest event for index ${latestEventIndex}. Trying prior index.`,
        );
      }
      latestEventIndex -= 1;
    }

    return startScanningBlock;
  }

  async getStartScanningBlock(chain: Chain): Promise<number> {
    let startScanningBlock = await this.getMostRecentValidCommitmentBlock(chain);
    EngineDebug.log(`most recent valid commitment block: ${startScanningBlock}`);
    if (startScanningBlock == null) {
      // If we haven't scanned anything yet, start scanning at deployment block
      startScanningBlock = this.deploymentBlocks[chain.type][chain.id];
    }
    return startScanningBlock;
  }

  private async performQuickScan(chain: Chain, endProgress: number) {
    if (!this.quickSync) {
      return;
    }
    try {
      EngineDebug.log(`quickSync: chain ${chain.type}:${chain.id}`);
      const merkletree = this.merkletrees[chain.type][chain.id].erc20;

      const startScanningBlockQuickSync = await this.getStartScanningBlock(chain);
      EngineDebug.log(`Start scanning block for QuickSync: ${startScanningBlockQuickSync}`);

      this.emitScanUpdateEvent(chain, endProgress * 0.1); // 5% / 50%

      // Fetch events
      const { commitmentEvents, unshieldEvents, nullifierEvents } = await this.quickSync(
        chain,
        startScanningBlockQuickSync,
      );

      this.emitScanUpdateEvent(chain, endProgress * 0.2); // 10% / 50%

      // Pass unshield events to listener
      await this.unshieldListener(chain, unshieldEvents);

      // Pass nullifier events to listener
      await this.nullifierListener(chain, nullifierEvents);

      this.emitScanUpdateEvent(chain, endProgress * 0.24); // 12% / 50%

      // Pass events to commitments listener and wait for resolution
      await Promise.all(
        commitmentEvents.map(async (commitmentEvent) => {
          const { treeNumber, startPosition, commitments } = commitmentEvent;
          await this.commitmentListener(
            chain,
            treeNumber,
            startPosition,
            commitments,
            false, // shouldUpdateTrees - wait until after all commitments added
          );
        }),
      );

      // Scan after all leaves added.
      if (commitmentEvents.length) {
        this.emitScanUpdateEvent(chain, endProgress * 0.3); // 15% / 50%
        await merkletree.updateTrees();
        const preScanProgressMultiplier = 0.4;
        this.emitScanUpdateEvent(chain, endProgress * preScanProgressMultiplier); // 20% / 50%
        await this.scanAllWallets(chain, (progress: number) => {
          const overallProgress =
            progress * (endProgress - preScanProgressMultiplier) + preScanProgressMultiplier;
          this.emitScanUpdateEvent(chain, overallProgress); // 20 - 50% / 50%
        });
      }
    } catch (err) {
      if (!(err instanceof Error)) {
        throw err;
      }
      EngineDebug.error(err);
    }
  }

  private emitScanUpdateEvent(chain: Chain, progress: number) {
    const updateData: MerkletreeHistoryScanUpdateData = {
      chain,
      progress,
    };
    this.emit(EngineEvent.MerkletreeHistoryScanUpdate, updateData);
  }

  /**
   * Scan contract history and sync
   * @param chain - chain type/id to scan
   */
  async scanHistory(chain: Chain) {
    if (!this.merkletrees[chain.type] || !this.merkletrees[chain.type][chain.id]) {
      EngineDebug.log(
        `Cannot scan history. Merkletree not yet loaded for chain ${chain.type}:${chain.id}.`,
      );
      return;
    }
    if (!this.proxyContracts[chain.type] || !this.proxyContracts[chain.type][chain.id]) {
      EngineDebug.log(
        `Cannot scan history. Proxy contract not yet loaded for chain ${chain.type}:${chain.id}.`,
      );
      return;
    }
    const merkletree = this.merkletrees[chain.type][chain.id].erc20;
    const proxyContract = this.proxyContracts[chain.type][chain.id];
    if (merkletree.isScanning) {
      // Do not allow multiple simultaneous scans.
      EngineDebug.log('Already scanning. Stopping additional re-scan.');
      return;
    }
    merkletree.isScanning = true;

    this.emitScanUpdateEvent(chain, 0.03); // 3%

    const postQuickSyncProgress = 0.5;
    await this.performQuickScan(chain, postQuickSyncProgress);

    this.emitScanUpdateEvent(chain, postQuickSyncProgress); // 50%

    // Get updated start-scanning block from new valid merkletree.
    let startScanningBlockSlowScan = await this.getStartScanningBlock(chain);
    const lastSyncedBlock = await this.getLastSyncedBlock(chain);
    EngineDebug.log(`last synced block: ${lastSyncedBlock}`);
    if (lastSyncedBlock && lastSyncedBlock > startScanningBlockSlowScan) {
      startScanningBlockSlowScan = lastSyncedBlock;
    }
    EngineDebug.log(`startScanningBlockSlowScan: ${startScanningBlockSlowScan}`);

    const latestBlock = (await proxyContract.contract.provider.getBlock('latest')).number;
    const totalBlocksToScan = latestBlock - startScanningBlockSlowScan;
    EngineDebug.log(`Total blocks to SlowScan: ${totalBlocksToScan}`);

    try {
      // Run slow scan
      await proxyContract.getHistoricalEvents(
        chain,
        startScanningBlockSlowScan,
        latestBlock,
        async ({ startPosition, treeNumber, commitments }: CommitmentEvent) => {
          await this.commitmentListener(
            chain,
            treeNumber,
            startPosition,
            commitments,
            true, // shouldUpdateTrees
          );
        },
        async (nullifiers: Nullifier[]) => {
          await this.nullifierListener(chain, nullifiers);
        },
        async (unshields: UnshieldStoredEvent[]) => {
          await this.unshieldListener(chain, unshields);
        },
        async (syncedBlock: number) => {
          const scannedBlocks = syncedBlock - startScanningBlockSlowScan;
          const scanUpdateData: MerkletreeHistoryScanUpdateData = {
            chain,
            progress:
              postQuickSyncProgress +
              ((1 - postQuickSyncProgress) * scannedBlocks) / totalBlocksToScan, // From 50% -> 100%
          };
          this.emit(EngineEvent.MerkletreeHistoryScanUpdate, scanUpdateData);
          await this.setLastSyncedBlock(syncedBlock, chain);
        },
      );

      // Final scan after all leaves added.
      await this.scanAllWallets(chain, undefined);
      const scanCompleteData: MerkletreeHistoryScanEventData = { chain };
      this.emit(EngineEvent.MerkletreeHistoryScanComplete, scanCompleteData);
      merkletree.isScanning = false;
    } catch (err) {
      if (!(err instanceof Error)) {
        throw err;
      }
      EngineDebug.log(`Scan incomplete for chain ${chain.type}:${chain.id}`);
      EngineDebug.error(err);
      await this.scanAllWallets(chain, undefined);
      const scanIncompleteData: MerkletreeHistoryScanEventData = { chain };
      this.emit(EngineEvent.MerkletreeHistoryScanIncomplete, scanIncompleteData);
      merkletree.isScanning = false;
    }
  }

  /**
   * Clears all merkletree leaves stored in database.
   * @param chain - chain type/id to clear
   */
  async clearSyncedMerkletreeLeaves(chain: Chain) {
    await this.merkletrees[chain.type][chain.id].erc20.clearLeavesFromDB();
    await this.db.clearNamespace(RailgunEngine.getLastSyncedBlockDBPrefix(chain));
  }

  /**
   * Clears stored merkletree leaves and wallet balances, and re-scans fully.
   * @param chain - chain type/id to rescan
   */
  async fullRescanMerkletreesAndWallets(chain: Chain) {
    if (!this.merkletrees[chain.type] || !this.merkletrees[chain.type][chain.id]) {
      const err = new Error(
        `Cannot re-scan history. Merkletree not yet loaded for chain ${chain.type}:${chain.id}.`,
      );
      EngineDebug.error(err);
      throw err;
    }
    const merkletree = this.merkletrees[chain.type][chain.id].erc20;
    if (merkletree.isScanning) {
      const err = new Error(`Full rescan already in progress.`);
      EngineDebug.error(err);
      throw err;
    }
    this.emitScanUpdateEvent(chain, 0.01); // 1%
    merkletree.isScanning = true; // Don't allow scans while removing leaves.
    await this.clearSyncedMerkletreeLeaves(chain);
    await Promise.all(this.allWallets().map((wallet) => wallet.clearScannedBalances(chain)));
    merkletree.isScanning = false; // Clear before calling scanHistory.
    await this.scanHistory(chain);
  }

  /**
   * Load network
   * @param proxyContractAddress - address of railgun instance (proxy contract)
   * @param relayAdaptContractAddress - address of railgun instance (proxy contract)
   * @param provider - ethers provider for network
   * @param deploymentBlock - block number to start scanning from
   */
  async loadNetwork(
    chain: Chain,
    proxyContractAddress: string,
    relayAdaptContractAddress: string,
    provider: ethers.providers.JsonRpcProvider | ethers.providers.FallbackProvider,
    deploymentBlock: number,
  ) {
    EngineDebug.log(`loadNetwork: ${chain.type}:${chain.id}`);

    try {
      // Test that provider responds.
      await provider.getBlockNumber();
    } catch (err) {
      EngineDebug.error(err as Error);
      throw new Error(`Cannot connect to RPC provider.`);
    }

    if (
      (this.merkletrees[chain.type] && this.merkletrees[chain.type][chain.id]) ||
      (this.proxyContracts[chain.type] && this.proxyContracts[chain.type][chain.id]) ||
      (this.relayAdaptContracts[chain.type] && this.relayAdaptContracts[chain.type][chain.id])
    ) {
      // If a network with this chainID exists, unload it and load the provider as a new network
      this.unloadNetwork(chain);
    }

    // Create proxy contract instance
    if (!this.proxyContracts[chain.type]) {
      this.proxyContracts[chain.type] = [];
    }
    this.proxyContracts[chain.type][chain.id] = new RailgunProxyContract(
      proxyContractAddress,
      provider,
      chain,
    );

    // Create relay adapt contract instance
    if (!this.relayAdaptContracts[chain.type]) {
      this.relayAdaptContracts[chain.type] = [];
    }
    this.relayAdaptContracts[chain.type][chain.id] = new RelayAdaptContract(
      relayAdaptContractAddress,
      provider,
    );

    // Create tree controllers
    if (!this.merkletrees[chain.type]) {
      this.merkletrees[chain.type] = [];
    }
    this.merkletrees[chain.type][chain.id] = {
      erc20: new MerkleTree(this.db, chain, 'erc20', (tree, root) =>
        this.proxyContracts[chain.type][chain.id].validateRoot(tree, root),
      ),
    };

    if (!this.deploymentBlocks[chain.type]) {
      this.deploymentBlocks[chain.type] = [];
    }
    this.deploymentBlocks[chain.type][chain.id] = deploymentBlock;

    // Load erc20 merkletrees to wallets
    Object.values(this.wallets).forEach((wallet) => {
      wallet.loadERC20Merkletree(this.merkletrees[chain.type][chain.id].erc20);
    });

    // Setup listeners
    const eventsListener = async ({ startPosition, treeNumber, commitments }: CommitmentEvent) => {
      await this.commitmentListener(
        chain,
        treeNumber,
        startPosition,
        commitments,
        true, // shouldUpdateTrees
      );
      await this.scanAllWallets(chain, undefined);
    };
    const nullifierListener = async (nullifiers: Nullifier[]) => {
      await this.nullifierListener(chain, nullifiers);
    };
    const unshieldListener = async (unshields: UnshieldStoredEvent[]) => {
      await this.unshieldListener(chain, unshields);
    };
    this.proxyContracts[chain.type][chain.id].treeUpdates(
      eventsListener,
      nullifierListener,
      unshieldListener,
    );
  }

  /**
   * Unload network
   * @param chain - chainID of network to unload
   */
  unloadNetwork(chain: Chain) {
    if (this.proxyContracts[chain.type] && this.proxyContracts[chain.id]) {
      // Unload listeners
      this.proxyContracts[chain.type][chain.id].unload();

      // Unlaod erc20 merkletrees from wallets
      Object.values(this.wallets).forEach((wallet) => {
        wallet.unloadERC20Merkletree(chain);
      });

      // Delete contract and merkle tree objects
      delete this.proxyContracts[chain.id][chain.type];
      delete this.relayAdaptContracts[chain.id][chain.type];
      delete this.merkletrees[chain.id][chain.type];
    }
  }

  private static getLastSyncedBlockDBPrefix(chain?: Chain): string[] {
    const path = [DatabaseNamespace.ChainSyncInfo, 'last_synced_block'];
    if (chain != null) path.push(getChainFullNetworkID(chain));
    return path;
  }

  /**
   * Sets last synced block to resume syncing on next load.
   * @param lastSyncedBlock - last synced block
   * @param chain - chain type/id to store value for
   */
  setLastSyncedBlock(lastSyncedBlock: number, chain: Chain): Promise<void> {
    return this.db.put(RailgunEngine.getLastSyncedBlockDBPrefix(chain), lastSyncedBlock, 'utf8');
  }

  /**
   * Gets last synced block to resume syncing from.
   * @param chain - chain type/id to get value for
   * @returns lastSyncedBlock - last synced block
   */
  getLastSyncedBlock(chain: Chain): Promise<Optional<number>> {
    return this.db
      .get(RailgunEngine.getLastSyncedBlockDBPrefix(chain), 'utf8')
      .then((val: string) => parseInt(val, 10))
      .catch(() => Promise.resolve(undefined));
  }

  async scanAllWallets(chain: Chain, progressCallback: Optional<(progress: number) => void>) {
    const wallets = this.allWallets();
    // eslint-disable-next-line no-restricted-syntax
    for (let i = 0; i < wallets.length; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await wallets[i].scanBalances(chain, (walletProgress: number) => {
        if (progressCallback) {
          const finishedWalletsProgress = i / wallets.length;
          const newWalletProgress = walletProgress / wallets.length;
          progressCallback(finishedWalletsProgress + newWalletProgress);
        }
      });
    }
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
   * Unloads wallets, removes listeners and closes DB.
   */
  unload() {
    // Unload chains
    this.proxyContracts.forEach((contractsForChainType, chainType) => {
      contractsForChainType.forEach((proxyContract, chainID) => {
        EngineDebug.log(`unload contract for ${chainType}:${chainID}`);
        this.unloadNetwork({ type: chainType, id: chainID });
        proxyContract.contract.removeAllListeners();
      });
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

    // Load erc20 merkletrees for wallet
    this.merkletrees.forEach((merkletreesForChainType) => {
      merkletreesForChainType.forEach((merkletree) => {
        wallet.loadERC20Merkletree(merkletree.erc20);
      });
    });
  }

  /**
   * Load existing wallet
   * @param {string} encryptionKey - encryption key of wallet
   * @param {string} id - wallet ID
   * @returns id
   */
  async loadExistingWallet(encryptionKey: string, id: string): Promise<RailgunWallet> {
    if (this.wallets[id]) {
      return this.wallets[id] as RailgunWallet;
    }
    const wallet = await RailgunWallet.loadExisting(this.db, encryptionKey, id);
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
    if (this.wallets[id]) {
      return this.wallets[id] as ViewOnlyWallet;
    }
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
    creationBlockNumbers: Optional<number[][]> = undefined,
  ): Promise<RailgunWallet> {
    const wallet = await RailgunWallet.fromMnemonic(
      this.db,
      encryptionKey,
      mnemonic,
      index,
      creationBlockNumbers,
    );
    this.loadWallet(wallet);
    return wallet;
  }

  async createViewOnlyWalletFromShareableViewingKey(
    encryptionKey: string,
    shareableViewingKey: string,
    creationBlockNumbers: Optional<number[][]>,
  ): Promise<ViewOnlyWallet> {
    const wallet = await ViewOnlyWallet.fromShareableViewingKey(
      this.db,
      encryptionKey,
      shareableViewingKey,
      creationBlockNumbers,
    );
    this.loadWallet(wallet);
    return wallet;
  }

  static encodeAddress = encodeAddress;

  static decodeAddress = decodeAddress;
}

export { RailgunEngine };
