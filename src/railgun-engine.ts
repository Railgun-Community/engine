import type { AbstractLevelDOWN } from 'abstract-leveldown';
import EventEmitter from 'events';
import { FallbackProvider } from 'ethers';
import { RailgunSmartWalletContract } from './contracts/railgun-smart-wallet/railgun-smart-wallet';
import { RelayAdaptContract } from './contracts/relay-adapt/relay-adapt';
import { Database, DatabaseNamespace } from './database/database';
import { Prover } from './prover/prover';
import { encodeAddress, decodeAddress } from './key-derivation/bech32';
import { ByteLength, formatToByteLength, hexlify } from './utils/bytes';
import { RailgunWallet } from './wallet/railgun-wallet';
import EngineDebug from './debugger/debugger';
import { Chain, EngineDebugger } from './models/engine-types';
import {
  Commitment,
  CommitmentType,
  LegacyGeneratedCommitment,
  Nullifier,
  RailgunTransaction,
  RailgunTransactionWithHash,
  ShieldCommitment,
} from './models/formatted-types';
import {
  CommitmentEvent,
  EngineEvent,
  GetLatestValidatedRailgunTxid,
  MerkletreeHistoryScanEventData,
  MerkletreeScanStatus,
  QuickSyncEvents,
  QuickSyncRailgunTransactions,
  UnshieldStoredEvent,
} from './models/event-types';
import { ViewOnlyWallet } from './wallet/view-only-wallet';
import { AbstractWallet } from './wallet/abstract-wallet';
import WalletInfo from './wallet/wallet-info';
import { getChainFullNetworkID } from './chain/chain';
import { ArtifactGetter } from './models/prover-types';
import { ContractStore } from './contracts/contract-store';
import {
  CURRENT_TXID_MERKLETREE_HISTORY_VERSION,
  CURRENT_UTXO_MERKLETREE_HISTORY_VERSION,
} from './utils/constants';
import { PollingJsonRpcProvider } from './provider/polling-json-rpc-provider';
import { assertIsPollingProvider } from './provider/polling-util';
import { isDefined } from './utils/is-defined';
import { UTXOMerkletree } from './merkletree/utxo-merkletree';
import { TXIDMerkletree } from './merkletree/txid-merkletree';
import { MerklerootValidator } from './models/merkletree-types';
import { delay, isSentCommitment } from './utils';
import { createRailgunTransactionWithHash } from './transaction/railgun-txid';
import {
  ACTIVE_TXID_VERSIONS,
  ACTIVE_UTXO_MERKLETREE_TXID_VERSIONS,
  TXIDVersion,
} from './models/poi-types';
import { getUnshieldTokenHash } from './note/note-util';

class RailgunEngine extends EventEmitter {
  readonly db: Database;

  private readonly utxoMerkletrees: { [txidVersion: string]: UTXOMerkletree[][] } = {};

  private readonly txidMerkletrees: { [txidVersion: string]: TXIDMerkletree[][] } = {};

  readonly prover: Prover;

  readonly wallets: { [key: string]: AbstractWallet } = {};

  readonly deploymentBlocks: { [txidVersion: string]: number[][] } = {};

  readonly quickSyncEvents: QuickSyncEvents;

  readonly quickSyncRailgunTransactions: QuickSyncRailgunTransactions;

  readonly validateRailgunTxidMerkleroot: MerklerootValidator;

  readonly getLatestValidatedRailgunTxid: GetLatestValidatedRailgunTxid;

  static walletSource: Optional<string>;

  private readonly skipMerkletreeScans: boolean;

  private readonly pollingRailgunTransactions: boolean[][] = [];

  readonly isPOINode: boolean;

  private constructor(
    walletSource: string,
    leveldown: AbstractLevelDOWN,
    artifactGetter: ArtifactGetter,
    quickSyncEvents: QuickSyncEvents,
    quickSyncRailgunTransactions: QuickSyncRailgunTransactions,
    validateRailgunTxidMerkleroot: Optional<MerklerootValidator>,
    getLatestValidatedRailgunTxid: Optional<GetLatestValidatedRailgunTxid>,
    engineDebugger: Optional<EngineDebugger>,
    skipMerkletreeScans: boolean,
    isPOINode: boolean,
  ) {
    super();

    WalletInfo.setWalletSource(walletSource);
    this.db = new Database(leveldown);
    this.prover = new Prover(artifactGetter);

    this.quickSyncEvents = quickSyncEvents;
    this.quickSyncRailgunTransactions = quickSyncRailgunTransactions;
    this.validateRailgunTxidMerkleroot = validateRailgunTxidMerkleroot ?? (async () => true);
    this.getLatestValidatedRailgunTxid =
      getLatestValidatedRailgunTxid ??
      (async () => ({ txidIndex: undefined, merkleroot: undefined }));

    if (engineDebugger) {
      EngineDebug.init(engineDebugger);
    }

    this.skipMerkletreeScans = skipMerkletreeScans;
    this.isPOINode = isPOINode;
  }

  /**
   * Create a RAILGUN Engine instance for a RAILGUN-compatible Wallet.
   * @param walletSource - string representing your wallet's name (16 char max, lowercase and numerals only)
   * @param leveldown - abstract-leveldown compatible store
   * @param artifactGetter - async function to retrieve artifacts
   * @param quickSync - quick sync function to speed up sync
   * @param engineDebugger - log and error callbacks for verbose logging
   * @param skipMerkletreeScans - whether to skip UTXO merkletree scans - useful for shield-only interfaces without Railgun wallets.
   * @param isPOINode - run as POI node with full Railgun Txid merkletrees. set to false for all wallet implementations.
   */
  static initForWallet(
    walletSource: string,
    leveldown: AbstractLevelDOWN,
    artifactGetter: ArtifactGetter,
    quickSyncEvents: QuickSyncEvents,
    quickSyncRailgunTransactions: QuickSyncRailgunTransactions,
    validateRailgunTxidMerkleroot: MerklerootValidator,
    getLatestValidatedRailgunTxid: GetLatestValidatedRailgunTxid,
    engineDebugger: Optional<EngineDebugger>,
    skipMerkletreeScans: boolean = false,
  ) {
    return new RailgunEngine(
      walletSource,
      leveldown,
      artifactGetter,
      quickSyncEvents,
      quickSyncRailgunTransactions,
      validateRailgunTxidMerkleroot,
      getLatestValidatedRailgunTxid,
      engineDebugger,
      skipMerkletreeScans,
      false, // isPOINode
    );
  }

  static initForPOINode(
    leveldown: AbstractLevelDOWN,
    artifactGetter: ArtifactGetter,
    quickSyncEvents: QuickSyncEvents,
    quickSyncRailgunTransactions: QuickSyncRailgunTransactions,
    engineDebugger: Optional<EngineDebugger>,
  ) {
    return new RailgunEngine(
      'poinode',
      leveldown,
      artifactGetter,
      quickSyncEvents,
      quickSyncRailgunTransactions,
      undefined, // validateRailgunTxidMerkleroot
      undefined, // getLatestValidatedRailgunTxid
      engineDebugger,
      false, // skipMerkletreeScans
      true, // isPOINode
    );
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
    txidVersion: TXIDVersion,
    chain: Chain,
    treeNumber: number,
    startingIndex: number,
    leaves: Commitment[],
    shouldUpdateTrees: boolean,
    shouldTriggerTxidSync: boolean,
  ): Promise<void> {
    if (this.db.isClosed()) {
      return;
    }
    if (!leaves.length) {
      return;
    }
    EngineDebug.log(
      `[commitmentListener: ${chain.type}:${chain.id}]: ${leaves.length} leaves at ${startingIndex}`,
    );
    leaves.forEach((leaf) => {
      // eslint-disable-next-line no-param-reassign
      leaf.txid = formatToByteLength(leaf.txid, ByteLength.UINT_256, false);
    });

    // Queue leaves to merkle tree
    const utxoMerkletree = this.getUTXOMerkletree(txidVersion, chain);
    await utxoMerkletree.queueLeaves(treeNumber, startingIndex, leaves);
    if (shouldUpdateTrees) {
      await utxoMerkletree.updateTreesFromWriteQueue();
    }

    if (shouldTriggerTxidSync) {
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      this.triggerDelayedTXIDMerkletreeSync(txidVersion, chain);
    }
  }

  async triggerDelayedTXIDMerkletreeSync(txidVersion: TXIDVersion, chain: Chain): Promise<void> {
    // Delay 15 seconds, and then trigger a Railgun Txid Merkletree sync.
    await delay(15000);
    await this.syncRailgunTransactionsForTXIDVersion(txidVersion, chain);
  }

  /**
   * Handle new nullifiers
   * @param chain - chain type/id for nullifiers
   * @param nullifiers - transaction info to nullify commitment
   */
  async nullifierListener(
    txidVersion: TXIDVersion,
    chain: Chain,
    nullifiers: Nullifier[],
  ): Promise<void> {
    if (this.db.isClosed()) {
      return;
    }
    if (!nullifiers.length) {
      return;
    }
    EngineDebug.log(`engine.nullifierListener[${chain.type}:${chain.id}] ${nullifiers.length}`);

    nullifiers.forEach((nullifier) => {
      // eslint-disable-next-line no-param-reassign
      nullifier.txid = formatToByteLength(nullifier.txid, ByteLength.UINT_256, false);
      // eslint-disable-next-line no-param-reassign
      nullifier.nullifier = formatToByteLength(nullifier.nullifier, ByteLength.UINT_256, false);
    });
    const utxoMerkletree = this.getUTXOMerkletree(txidVersion, chain);
    await utxoMerkletree.nullify(nullifiers);
  }

  /**
   * Handle new unshield events
   * @param chain - chain type/id
   * @param unshields - unshield events
   */
  async unshieldListener(
    txidVersion: TXIDVersion,
    chain: Chain,
    unshields: UnshieldStoredEvent[],
  ): Promise<void> {
    if (this.db.isClosed()) {
      return;
    }
    if (!unshields.length) {
      return;
    }
    EngineDebug.log(`engine.unshieldListener[${chain.type}:${chain.id}] ${unshields.length}`);
    unshields.forEach((unshield) => {
      // eslint-disable-next-line no-param-reassign
      unshield.txid = formatToByteLength(unshield.txid, ByteLength.UINT_256, false);
    });
    const utxoMerkletree = this.getUTXOMerkletree(txidVersion, chain);
    await utxoMerkletree.addUnshieldEvents(unshields);
  }

  async getMostRecentValidCommitmentBlock(
    txidVersion: TXIDVersion,
    chain: Chain,
  ): Promise<Optional<number>> {
    const utxoMerkletree = this.getUTXOMerkletree(txidVersion, chain);
    const railgunSmartWalletContract =
      ContractStore.railgunSmartWalletContracts[chain.type]?.[chain.id];
    const provider = railgunSmartWalletContract.contract.runner?.provider;
    if (!provider) {
      throw new Error('Requires provider for commitment block lookup');
    }

    // Get latest tree
    const firstInvalidMerklerootTree = utxoMerkletree.getFirstInvalidMerklerootTree();
    const searchTree = firstInvalidMerklerootTree ?? (await utxoMerkletree.latestTree());

    // Get latest synced event
    const treeLength = await utxoMerkletree.getTreeLength(searchTree);

    EngineDebug.log(`scanHistory: searchTree ${searchTree}, treeLength ${treeLength}`);

    let startScanningBlock: Optional<number>;

    let latestEventIndex = treeLength - 1;
    while (latestEventIndex >= 0 && !isDefined(startScanningBlock)) {
      // Get block number of last scanned event
      // eslint-disable-next-line no-await-in-loop
      const latestEvent = await utxoMerkletree.getCommitment(searchTree, latestEventIndex);
      if (isDefined(latestEvent)) {
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

  async getStartScanningBlock(txidVersion: TXIDVersion, chain: Chain): Promise<number> {
    let startScanningBlock = await this.getMostRecentValidCommitmentBlock(txidVersion, chain);
    EngineDebug.log(`most recent valid commitment block: ${startScanningBlock ?? 'unknown'}`);
    if (startScanningBlock == null) {
      // If we haven't scanned anything yet, start scanning at deployment block
      startScanningBlock = this.deploymentBlocks[txidVersion]?.[chain.type]?.[chain.id];
      if (!isDefined(startScanningBlock)) {
        throw new Error(
          `Deployment block not defined for ${txidVersion} and chain ${chain.type}:${chain.id}`,
        );
      }
    }
    return startScanningBlock;
  }

  private async performQuickSync(
    txidVersion: TXIDVersion,
    chain: Chain,
    endProgress: number,
    retryCount = 0,
  ) {
    try {
      if (txidVersion !== TXIDVersion.V2_PoseidonMerkle) {
        throw new Error(
          'Quick sync only supported for V2 Poseidon Merkle - also needs migration of progress indicator for multiple txid versions.',
        );
      }

      EngineDebug.log(`quickSync: chain ${chain.type}:${chain.id}`);
      const utxoMerkletree = this.getUTXOMerkletree(txidVersion, chain);

      const startScanningBlockQuickSync = await this.getStartScanningBlock(txidVersion, chain);
      EngineDebug.log(`Start scanning block for QuickSync: ${startScanningBlockQuickSync}`);

      this.emitUTXOMerkletreeScanUpdateEvent(txidVersion, chain, endProgress * 0.1); // 5% / 50%

      // Fetch events
      const { commitmentEvents, unshieldEvents, nullifierEvents } = await this.quickSyncEvents(
        txidVersion,
        chain,
        startScanningBlockQuickSync,
      );

      this.emitUTXOMerkletreeScanUpdateEvent(txidVersion, chain, endProgress * 0.2); // 10% / 50%

      await this.unshieldListener(txidVersion, chain, unshieldEvents);
      await this.nullifierListener(txidVersion, chain, nullifierEvents);

      this.emitUTXOMerkletreeScanUpdateEvent(txidVersion, chain, endProgress * 0.24); // 12% / 50%

      // Make sure commitments are scanned after Unshields and Nullifiers.
      await Promise.all(
        commitmentEvents.map(async (commitmentEvent) => {
          const { treeNumber, startPosition, commitments } = commitmentEvent;
          await this.commitmentListener(
            txidVersion,
            chain,
            treeNumber,
            startPosition,
            commitments,
            false, // shouldUpdateTrees - wait until after all commitments added
            false, // shouldTriggerTxidSync - not during quick sync
          );
        }),
      );

      // Scan after all leaves added.
      if (commitmentEvents.length) {
        this.emitUTXOMerkletreeScanUpdateEvent(txidVersion, chain, endProgress * 0.3); // 15% / 50%
        await utxoMerkletree.updateTreesFromWriteQueue();
        const preScanProgressMultiplier = 0.4;
        this.emitUTXOMerkletreeScanUpdateEvent(
          txidVersion,
          chain,
          endProgress * preScanProgressMultiplier,
        ); // 20% / 50%
        await this.scanAllWallets(txidVersion, chain, (progress: number) => {
          const overallProgress =
            progress * (endProgress - preScanProgressMultiplier) + preScanProgressMultiplier;
          this.emitUTXOMerkletreeScanUpdateEvent(txidVersion, chain, overallProgress); // 20 - 50% / 50%
        });
      }
    } catch (err) {
      if (!(err instanceof Error)) {
        throw err;
      }
      if (retryCount < 1) {
        await this.performQuickSync(txidVersion, chain, endProgress, retryCount + 1);
        return;
      }
      EngineDebug.error(err);
    }
  }

  private emitUTXOMerkletreeScanUpdateEvent(
    txidVersion: TXIDVersion,
    chain: Chain,
    progress: number,
  ) {
    const updateData: MerkletreeHistoryScanEventData = {
      scanStatus: MerkletreeScanStatus.Updated,
      txidVersion,
      chain,
      progress,
    };
    this.emit(EngineEvent.UTXOMerkletreeHistoryScanUpdate, updateData);
  }

  private emitTXIDMerkletreeScanUpdateEvent(
    txidVersion: TXIDVersion,
    chain: Chain,
    progress: number,
  ) {
    const updateData: MerkletreeHistoryScanEventData = {
      scanStatus: MerkletreeScanStatus.Updated,
      txidVersion,
      chain,
      progress,
    };
    this.emit(EngineEvent.TXIDMerkletreeHistoryScanUpdate, updateData);
  }

  async getNextStartingBlockSlowScan(txidVersion: TXIDVersion, chain: Chain): Promise<number> {
    // Get updated start-scanning block from new valid utxoMerkletree.
    let startScanningBlockSlowScan = await this.getStartScanningBlock(txidVersion, chain);
    const lastSyncedBlock = await this.getLastSyncedBlock(chain);
    EngineDebug.log(`lastSyncedBlock: ${lastSyncedBlock ?? 'unknown'}`);
    if (isDefined(lastSyncedBlock) && lastSyncedBlock > startScanningBlockSlowScan) {
      startScanningBlockSlowScan = lastSyncedBlock;
    }
    return startScanningBlockSlowScan;
  }

  /**
   * Scan contract history and sync
   * @param chain - chain type/id to scan
   */
  async scanHistory(chain: Chain) {
    // eslint-disable-next-line no-restricted-syntax
    for (const txidVersion of ACTIVE_TXID_VERSIONS) {
      // eslint-disable-next-line no-await-in-loop
      await this.scanHistoryForTXIDVersion(txidVersion, chain);
    }

    if (this.pollingRailgunTransactions[chain.type]?.[chain.id] !== true) {
      await this.startSyncRailgunTransactionsPoller(chain);
    }
  }

  async scanHistoryForTXIDVersion(txidVersion: TXIDVersion, chain: Chain) {
    if (this.skipMerkletreeScans) {
      EngineDebug.log(`Skipping merkletree scan: skipMerkletreeScans set on RAILGUN Engine.`);
      return;
    }
    if (!this.hasTXIDMerkletree(txidVersion, chain)) {
      EngineDebug.log(
        `Cannot scan history. TXID merkletree not yet loaded for ${txidVersion}, chain ${chain.type}:${chain.id}.`,
      );
      return;
    }
    if (!isDefined(ContractStore.railgunSmartWalletContracts[chain.type]?.[chain.id])) {
      EngineDebug.log(
        `Cannot scan history. Proxy contract not yet loaded for chain ${chain.type}:${chain.id}.`,
      );
      return;
    }

    const utxoMerkletreeHistoryVersion = await this.getUTXOMerkletreeHistoryVersion(chain);
    if (
      !isDefined(utxoMerkletreeHistoryVersion) ||
      utxoMerkletreeHistoryVersion < CURRENT_UTXO_MERKLETREE_HISTORY_VERSION
    ) {
      await this.clearUTXOMerkletreeAndWallets(txidVersion, chain);
      await this.setUTXOMerkletreeHistoryVersion(chain, CURRENT_UTXO_MERKLETREE_HISTORY_VERSION);
    }

    const utxoMerkletree = this.getUTXOMerkletree(txidVersion, chain);
    const railgunSmartWalletContract =
      ContractStore.railgunSmartWalletContracts[chain.type]?.[chain.id];
    if (utxoMerkletree.isScanning) {
      // Do not allow multiple simultaneous scans.
      EngineDebug.log('Already scanning. Stopping additional re-scan.');
      return;
    }
    utxoMerkletree.isScanning = true;

    this.emitUTXOMerkletreeScanUpdateEvent(txidVersion, chain, 0.03); // 3%

    const postQuickSyncProgress = 0.5;
    await this.performQuickSync(txidVersion, chain, postQuickSyncProgress);

    this.emitUTXOMerkletreeScanUpdateEvent(txidVersion, chain, postQuickSyncProgress); // 50%

    // Get updated start-scanning block from new valid utxoMerkletree.
    const startScanningBlockSlowScan = await this.getNextStartingBlockSlowScan(txidVersion, chain);
    EngineDebug.log(
      `startScanningBlockSlowScan: ${startScanningBlockSlowScan} (note: continously updated during scan)`,
    );

    if (!railgunSmartWalletContract.contract.runner?.provider) {
      throw new Error('Requires provider for RailgunSmartWallet contract');
    }
    const latestBlock = await railgunSmartWalletContract.contract.runner.provider.getBlockNumber();
    const totalBlocksToScan = latestBlock - startScanningBlockSlowScan;
    EngineDebug.log(`Total blocks to SlowScan: ${totalBlocksToScan}`);

    try {
      // Run slow scan
      await railgunSmartWalletContract.getHistoricalEvents(
        chain,
        startScanningBlockSlowScan,
        latestBlock,
        () => this.getNextStartingBlockSlowScan(txidVersion, chain),
        async (
          _txidVersion: TXIDVersion,
          { startPosition, treeNumber, commitments }: CommitmentEvent,
        ) => {
          await this.commitmentListener(
            txidVersion,
            chain,
            treeNumber,
            startPosition,
            commitments,
            true, // shouldUpdateTrees
            false, // shouldTriggerTxidSync - not during slow sync
          );
        },
        async (_txidVersion: TXIDVersion, nullifiers: Nullifier[]) => {
          await this.nullifierListener(txidVersion, chain, nullifiers);
        },
        async (_txidVersion: TXIDVersion, unshields: UnshieldStoredEvent[]) => {
          await this.unshieldListener(txidVersion, chain, unshields);
        },
        async (syncedBlock: number) => {
          const scannedBlocks = syncedBlock - startScanningBlockSlowScan;
          const progress =
            postQuickSyncProgress +
            ((1 - postQuickSyncProgress - 0.05) * scannedBlocks) / totalBlocksToScan;
          this.emitUTXOMerkletreeScanUpdateEvent(txidVersion, chain, progress);

          if (utxoMerkletree.getFirstInvalidMerklerootTree() != null) {
            // Do not save lastSyncedBlock in case of merkleroot error.
            // This will force a scan from the last valid commitment on next run.
            return;
          }
          await this.setLastSyncedBlock(chain, syncedBlock);
        },
      );

      // Final scan after all leaves added.
      await this.scanAllWallets(txidVersion, chain, undefined);

      this.emitUTXOMerkletreeScanUpdateEvent(txidVersion, chain, 1.0); // 100%

      const scanCompleteData: MerkletreeHistoryScanEventData = {
        scanStatus: MerkletreeScanStatus.Complete,
        txidVersion,
        chain,
      };
      this.emit(EngineEvent.UTXOMerkletreeHistoryScanUpdate, scanCompleteData);
      utxoMerkletree.isScanning = false;
    } catch (err) {
      if (!(err instanceof Error)) {
        throw err;
      }
      EngineDebug.log(`Scan incomplete for chain ${chain.type}:${chain.id}`);
      EngineDebug.error(err);
      await this.scanAllWallets(txidVersion, chain, undefined);
      const scanIncompleteData: MerkletreeHistoryScanEventData = {
        scanStatus: MerkletreeScanStatus.Incomplete,
        txidVersion,
        chain,
      };
      this.emit(EngineEvent.UTXOMerkletreeHistoryScanUpdate, scanIncompleteData);
      utxoMerkletree.isScanning = false;
    }
  }

  async startSyncRailgunTransactionsPoller(chain: Chain) {
    // eslint-disable-next-line no-restricted-syntax
    for (const txidVersion of ACTIVE_TXID_VERSIONS) {
      if (!this.hasTXIDMerkletree(txidVersion, chain)) {
        EngineDebug.log(
          `Cannot sync txids. Txid merkletree not yet loaded for chain ${chain.type}:${chain.id}.`,
        );
        return;
      }

      switch (txidVersion) {
        case TXIDVersion.V2_PoseidonMerkle: {
          // Every 1 min for POI nodes, 3 min for wallets
          const refreshDelayMin = this.isPOINode ? 1 * 60 * 1000 : 3 * 60 * 1000;
          // eslint-disable-next-line @typescript-eslint/no-floating-promises
          this.syncRailgunTransactionsPoller(txidVersion, chain, refreshDelayMin);
          break;
        }
        // case TXIDVersion.V3_PoseidonMerkle:
        //   throw new Error('Railgun transaction sync not implemented for V3 Poseidon Merkle');
        // case TXIDVersion.V3_KZG:
        //   throw new Error('Railgun transaction sync not implemented for V3 KZG');
      }
    }

    this.pollingRailgunTransactions[chain.type] = [];
    this.pollingRailgunTransactions[chain.type][chain.id] = true;
  }

  async syncRailgunTransactionsPoller(
    txidVersion: TXIDVersion,
    chain: Chain,
    refreshDelayMin: number,
  ) {
    await this.syncRailgunTransactionsForTXIDVersion(txidVersion, chain);

    await delay(refreshDelayMin);

    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    this.syncRailgunTransactionsPoller(txidVersion, chain, refreshDelayMin);
  }

  /**
   * Sync Railgun txid merkletree.
   * @param chain - chain type/id to scan
   */
  async syncRailgunTransactionsForTXIDVersion(txidVersion: TXIDVersion, chain: Chain) {
    if (!this.hasTXIDMerkletree(txidVersion, chain)) {
      EngineDebug.log(
        `Cannot sync txids. Txid merkletree not yet loaded for chain ${chain.type}:${chain.id}.`,
      );
      return;
    }

    const txidMerkletreeHistoryVersion = await this.getTxidMerkletreeHistoryVersion(chain);
    if (
      !isDefined(txidMerkletreeHistoryVersion) ||
      txidMerkletreeHistoryVersion < CURRENT_TXID_MERKLETREE_HISTORY_VERSION
    ) {
      await this.clearAllTXIDMerkletrees(txidVersion, chain);
      await this.setTxidMerkletreeHistoryVersion(chain, CURRENT_TXID_MERKLETREE_HISTORY_VERSION);
    }

    const txidMerkletree = this.getTXIDMerkletree(txidVersion, chain);
    if (txidMerkletree.isScanning) {
      // Do not allow multiple simultaneous scans.
      EngineDebug.log('[Txid] Already syncing. Stopping additional re-sync.');
      return;
    }
    txidMerkletree.isScanning = true;

    switch (txidVersion) {
      case TXIDVersion.V2_PoseidonMerkle:
        await this.performSyncRailgunTransactionsV2(chain);
        break;
      // case TXIDVersion.V3_PoseidonMerkle:
      //   throw new Error('Sync not implemented for V3 Poseidon Merkle');
      // case TXIDVersion.V3_KZG:
      //   throw new Error('Sync not implemented for V3 KZG');
    }

    txidMerkletree.isScanning = false;
  }

  private async performSyncRailgunTransactionsV2(chain: Chain) {
    const txidVersion = TXIDVersion.V2_PoseidonMerkle;

    try {
      EngineDebug.log(`sync railgun txids: chain ${chain.type}:${chain.id}`);

      this.emitTXIDMerkletreeScanUpdateEvent(txidVersion, chain, 0.03); // 3%

      let maxTxidIndex: Optional<number>;
      if (!this.isPOINode) {
        const { txidIndex: latestTxidIndex } = await this.getLatestRailgunTxidData(
          txidVersion,
          chain,
        );

        // TODO: Optimization - use this merkleroot from validated railgun txid to auto-validate merkletree.
        const { txidIndex: latestValidatedTxidIndex /* merkleroot */ } =
          await this.getLatestValidatedRailgunTxid(txidVersion, chain);

        EngineDebug.log(
          `syncing railgun transactions to validated index: ${
            latestValidatedTxidIndex ?? 'NOT FOUND'
          }`,
        );

        const isAheadOfValidatedTxids =
          !isDefined(latestValidatedTxidIndex) || latestTxidIndex >= latestValidatedTxidIndex;
        if (isAheadOfValidatedTxids) {
          // Do not sync. Wait for POI node to sync / validate.
          const scanCompleteData: MerkletreeHistoryScanEventData = {
            scanStatus: MerkletreeScanStatus.Complete,
            txidVersion,
            chain,
          };
          this.emit(EngineEvent.TXIDMerkletreeHistoryScanUpdate, scanCompleteData);
          return;
        }
        maxTxidIndex = latestValidatedTxidIndex;
      }

      this.emitTXIDMerkletreeScanUpdateEvent(txidVersion, chain, 0.15); // 15%

      const txidMerkletree = this.getTXIDMerkletree(txidVersion, chain);
      const latestGraphID: Optional<string> = await txidMerkletree.getLatestGraphID();
      const railgunTransactions: RailgunTransaction[] = await this.quickSyncRailgunTransactions(
        chain,
        latestGraphID,
      );

      this.emitTXIDMerkletreeScanUpdateEvent(txidVersion, chain, 0.4); // 40%

      await this.handleNewRailgunTransactions(
        txidVersion,
        chain,
        railgunTransactions,
        maxTxidIndex,
      );

      const scanCompleteData: MerkletreeHistoryScanEventData = {
        scanStatus: MerkletreeScanStatus.Complete,
        txidVersion,
        chain,
      };
      this.emit(EngineEvent.TXIDMerkletreeHistoryScanUpdate, scanCompleteData);
    } catch (err) {
      if (!(err instanceof Error)) {
        throw err;
      }
      EngineDebug.error(err);

      const scanIncompleteData: MerkletreeHistoryScanEventData = {
        scanStatus: MerkletreeScanStatus.Incomplete,
        txidVersion,
        chain,
      };
      this.emit(EngineEvent.TXIDMerkletreeHistoryScanUpdate, scanIncompleteData);
    }
  }

  async handleNewRailgunTransactions(
    txidVersion: TXIDVersion,
    chain: Chain,
    railgunTransactions: RailgunTransaction[],
    maxTxidIndex?: number,
  ) {
    const utxoMerkletree = this.getUTXOMerkletree(txidVersion, chain);
    const txidMerkletree = this.getTXIDMerkletree(txidVersion, chain);

    const v3BlockNumber = RailgunSmartWalletContract.getEngineV2StartBlockNumber(chain);

    const toQueue: RailgunTransactionWithHash[] = [];

    // eslint-disable-next-line no-restricted-syntax
    for (const railgunTransaction of railgunTransactions) {
      const railgunTransactionWithTxid = createRailgunTransactionWithHash(
        railgunTransaction,
        txidVersion,
      );
      const {
        commitments,
        hasUnshield,
        txid,
        unshieldTokenHash,
        railgunTxid,
        utxoTreeOut: tree,
        utxoBatchStartPositionOut,
        blockNumber,
      } = railgunTransactionWithTxid;

      // Update existing commitments/unshield events.
      // If any commitments are missing, wait for UTXO tree to sync first.

      const unshieldCommitment: Optional<string> = hasUnshield
        ? commitments[commitments.length - 1]
        : undefined;
      const standardCommitments: string[] = hasUnshield ? commitments.slice(0, -1) : commitments;

      let missingAnyCommitments = false;

      // No Unshield events exist pre-V3.
      const isPreV3 = blockNumber < v3BlockNumber;

      if (isDefined(unshieldCommitment) && !isPreV3) {
        // eslint-disable-next-line no-await-in-loop
        const unshieldEventsForTxid = await utxoMerkletree.getUnshieldEvents(txid);
        const matchingUnshieldEvent = unshieldEventsForTxid.find((unshieldEvent) => {
          const tokenHash = getUnshieldTokenHash(unshieldEvent);
          return tokenHash === unshieldTokenHash;
        });
        if (matchingUnshieldEvent) {
          if (matchingUnshieldEvent.railgunTxid !== railgunTxid) {
            matchingUnshieldEvent.railgunTxid = railgunTxid;
            // eslint-disable-next-line no-await-in-loop
            await utxoMerkletree.updateUnshieldEvent(matchingUnshieldEvent);
          }
        } else {
          EngineDebug.log(
            `Missing unshield from TXID scan: txid ${txid}, token ${
              unshieldTokenHash ?? 'UNKNOWN'
            }`,
          );
          missingAnyCommitments = true;
        }
      }

      // eslint-disable-next-line no-restricted-syntax
      for (let i = 0; i < standardCommitments.length; i += 1) {
        const position = utxoBatchStartPositionOut + i;
        // eslint-disable-next-line no-await-in-loop
        const commitment = await utxoMerkletree.getCommitmentSafe(tree, position);
        if (isDefined(commitment)) {
          if (isSentCommitment(commitment) && commitment.railgunTxid !== railgunTxid) {
            commitment.railgunTxid = railgunTxid;
            // eslint-disable-next-line no-await-in-loop
            await utxoMerkletree.updateData(tree, position, commitment);
          }
        } else {
          missingAnyCommitments = true;
          EngineDebug.log(`Missing commitment from TXID scan: UTXO ${tree}:${position}.`);
          break;
        }
      }

      if (missingAnyCommitments) {
        EngineDebug.error(
          new Error(`Missing a commitment. Cannot continue queuing Railgun TXIDs.`),
        );
        break;
      }

      toQueue.push(railgunTransactionWithTxid);
    }

    await txidMerkletree.queueRailgunTransactions(toQueue, maxTxidIndex);
    await txidMerkletree.updateTreesFromWriteQueue();
  }

  async validateHistoricalRailgunTxidMerkleroot(
    txidVersion: TXIDVersion,
    chain: Chain,
    tree: number,
    index: number,
    merkleroot: string,
  ): Promise<boolean> {
    const historicalMerkleroot = await this.getHistoricalRailgunTxidMerkleroot(
      txidVersion,
      chain,
      tree,
      index,
    );
    return historicalMerkleroot === merkleroot;
  }

  async validateRailgunTxidOccurredBeforeBlockNumber(
    txidVersion: TXIDVersion,
    chain: Chain,
    tree: number,
    index: number,
    blockNumber: number,
  ): Promise<boolean> {
    const txidMerkletree = this.getTXIDMerkletree(txidVersion, chain);
    return txidMerkletree.railgunTxidOccurredBeforeBlockNumber(tree, index, blockNumber);
  }

  async getHistoricalRailgunTxidMerkleroot(
    txidVersion: TXIDVersion,
    chain: Chain,
    tree: number,
    index: number,
  ): Promise<Optional<string>> {
    if (!this.isPOINode) {
      throw new Error('Only POI nodes process historical merkleroots');
    }
    const txidMerkletree = this.getTXIDMerkletree(txidVersion, chain);
    const historicalMerkleroot = await txidMerkletree.getHistoricalMerkleroot(tree, index);
    return historicalMerkleroot;
  }

  async getLatestRailgunTxidData(
    txidVersion: TXIDVersion,
    chain: Chain,
  ): Promise<{ txidIndex: number; merkleroot: string }> {
    const txidMerkletree = this.getTXIDMerkletree(txidVersion, chain);
    const { tree, index } = await txidMerkletree.getLatestTreeAndIndex();
    const merkleroot = await txidMerkletree.getRoot(tree);
    const txidIndex = TXIDMerkletree.getGlobalPosition(tree, index);
    return { txidIndex, merkleroot };
  }

  /**
   * Clears all merkletree leaves stored in database.
   * @param chain - chain type/id to clear
   */
  async clearSyncedUTXOMerkletreeLeaves(txidVersion: TXIDVersion, chain: Chain) {
    const utxoMerkletree = this.getUTXOMerkletree(txidVersion, chain);
    await utxoMerkletree.clearDataForMerkletree();
    await this.db.clearNamespace(RailgunEngine.getLastSyncedBlockDBPrefix(chain));
  }

  private async clearUTXOMerkletreeAndWallets(txidVersion: TXIDVersion, chain: Chain) {
    await this.clearSyncedUTXOMerkletreeLeaves(txidVersion, chain);
    await Promise.all(
      this.allWallets().map((wallet) => wallet.clearScannedBalances(txidVersion, chain)),
    );
  }

  private async clearSyncedUnshieldEvents(txidVersion: TXIDVersion, chain: Chain) {
    const utxoMerkletree = this.getUTXOMerkletree(txidVersion, chain);
    await this.db.clearNamespace(utxoMerkletree.getUnshieldEventsDBPath());
  }

  private async clearAllTXIDMerkletrees(txidVersion: TXIDVersion, chain: Chain) {
    const txidMerkletree = this.getTXIDMerkletree(txidVersion, chain);
    await txidMerkletree.clearDataForMerkletree();
    txidMerkletree.savedPOILaunchSnapshot = false;
  }

  /**
   * Clears stored merkletree leaves and wallet balances, and re-scans fully.
   * @param chain - chain type/id to rescan
   * @param forceRescanDevOnly - can corrupt an existing scan, so only recommended in extreme cases (DEV only)
   */
  async fullRescanUTXOMerkletreesAndWallets(chain: Chain, forceRescanDevOnly = false) {
    // eslint-disable-next-line no-restricted-syntax
    for (const txidVersion of ACTIVE_TXID_VERSIONS) {
      if (!this.hasUTXOMerkletree(txidVersion, chain)) {
        const err = new Error(
          `Cannot re-scan history. Merkletree not yet loaded for ${txidVersion}, chain ${chain.type}:${chain.id}.`,
        );
        EngineDebug.error(err);
        throw err;
      }
      const utxoMerkletree = this.getUTXOMerkletree(txidVersion, chain);
      if (utxoMerkletree.isScanning && !forceRescanDevOnly) {
        const err = new Error(`Full rescan already in progress.`);
        EngineDebug.error(err);
        throw err;
      }
    }

    // eslint-disable-next-line no-restricted-syntax
    for (const txidVersion of ACTIVE_TXID_VERSIONS) {
      const utxoMerkletree = this.getUTXOMerkletree(txidVersion, chain);

      this.emitUTXOMerkletreeScanUpdateEvent(txidVersion, chain, 0.01); // 1%
      utxoMerkletree.isScanning = true; // Don't allow scans while removing leaves.
      // eslint-disable-next-line no-await-in-loop
      await this.clearUTXOMerkletreeAndWallets(txidVersion, chain);
      // eslint-disable-next-line no-await-in-loop
      await this.clearSyncedUnshieldEvents(txidVersion, chain);
      utxoMerkletree.isScanning = false; // Clear before calling scanHistory.
      // eslint-disable-next-line no-await-in-loop
      await this.scanHistoryForTXIDVersion(txidVersion, chain);
    }

    // Must reset txid merkletree which is mapped to UTXO commitments.
    // TODO: Remove after V3.
    await this.fullResetTXIDMerkletrees(chain);
  }

  async fullResetTXIDMerkletrees(chain: Chain): Promise<void> {
    if (this.pollingRailgunTransactions[chain.type]?.[chain.id] !== true) {
      const err = new Error(
        `Cannot re-scan railgun txids. Must get UTXO history first. Please wait and try again.`,
      );
      EngineDebug.error(err);
      throw err;
    }

    // eslint-disable-next-line no-restricted-syntax
    for (const txidVersion of ACTIVE_TXID_VERSIONS) {
      const hasMerkletree = this.hasTXIDMerkletree(txidVersion, chain);
      if (!hasMerkletree) {
        const err = new Error(
          `Cannot re-scan railgun txids. Merkletree not yet loaded for chain ${chain.type}:${chain.id}.`,
        );
        EngineDebug.error(err);
        throw err;
      }
      const txidMerkletree = this.getTXIDMerkletree(txidVersion, chain);
      if (txidMerkletree.isScanning) {
        const err = new Error(`Full reset of txids already in progress.`);
        EngineDebug.error(err);
        throw err;
      }
    }

    // eslint-disable-next-line no-restricted-syntax
    for (const txidVersion of ACTIVE_TXID_VERSIONS) {
      const txidMerkletree = this.getTXIDMerkletree(txidVersion, chain);
      txidMerkletree.isScanning = true; // Don't allow scans while removing leaves.
      // eslint-disable-next-line no-await-in-loop
      await txidMerkletree.clearDataForMerkletree();
      txidMerkletree.savedPOILaunchSnapshot = false;
      txidMerkletree.isScanning = false; // Clear before calling syncRailgunTransactions.
      // eslint-disable-next-line no-await-in-loop
      await this.syncRailgunTransactionsForTXIDVersion(txidVersion, chain);
    }
  }

  async resetRailgunTxidsAfterTxidIndex(
    txidVersion: TXIDVersion,
    chain: Chain,
    txidIndex: number,
  ): Promise<void> {
    const txidMerkletree = this.getTXIDMerkletree(txidVersion, chain);
    txidMerkletree.isScanning = true; // Don't allow scans while removing leaves.
    await txidMerkletree.clearLeavesAfterTxidIndex(txidIndex);
    txidMerkletree.isScanning = false; // Clear before calling syncRailgunTransactions.
    await this.syncRailgunTransactionsForTXIDVersion(txidVersion, chain);
  }

  /**
   * Load network
   * @param railgunSmartWalletContractAddress - address of railgun instance (proxy contract)
   * @param relayAdaptContractAddress - address of railgun instance (proxy contract)
   * @param provider - ethers provider for network
   * @param deploymentBlock - block number to start scanning from
   */
  async loadNetwork(
    chain: Chain,
    railgunSmartWalletContractAddress: string,
    relayAdaptContractAddress: string,
    defaultProvider: PollingJsonRpcProvider | FallbackProvider,
    pollingProvider: PollingJsonRpcProvider,
    deploymentBlocks: Record<TXIDVersion, number>,
    poiLaunchBlock: Optional<number>,
  ) {
    EngineDebug.log(`loadNetwork: ${chain.type}:${chain.id}`);

    try {
      await defaultProvider.getBlockNumber();
    } catch (err) {
      EngineDebug.error(err as Error);
      throw new Error(`Cannot connect to default fallback RPC provider.`);
    }

    assertIsPollingProvider(pollingProvider);
    try {
      await pollingProvider.getBlockNumber();
    } catch (err) {
      EngineDebug.error(err as Error);
      throw new Error(`Cannot connect to polling RPC provider.`);
    }

    const hasAnyMerkletree = ACTIVE_TXID_VERSIONS.every(
      (txidVersion) =>
        !this.hasUTXOMerkletree(txidVersion, chain) && !this.hasTXIDMerkletree(txidVersion, chain),
    );
    const hasSmartWalletContract = isDefined(
      ContractStore.railgunSmartWalletContracts[chain.type]?.[chain.id],
    );
    const hasRelayAdaptContract = isDefined(
      ContractStore.relayAdaptContracts[chain.type]?.[chain.id],
    );
    if (hasAnyMerkletree || hasSmartWalletContract || hasRelayAdaptContract) {
      // If a network with this chainID exists, unload it and load the provider as a new network
      await this.unloadNetwork(chain);
    }

    // Create proxy contract instance
    ContractStore.railgunSmartWalletContracts[chain.type] ??= [];
    ContractStore.railgunSmartWalletContracts[chain.type][chain.id] =
      new RailgunSmartWalletContract(
        railgunSmartWalletContractAddress,
        defaultProvider,
        pollingProvider,
        chain,
      );

    // Create relay adapt contract instance
    ContractStore.relayAdaptContracts[chain.type] ??= [];
    ContractStore.relayAdaptContracts[chain.type][chain.id] = new RelayAdaptContract(
      relayAdaptContractAddress,
      defaultProvider,
    );

    // eslint-disable-next-line no-restricted-syntax
    for (const txidVersion of ACTIVE_UTXO_MERKLETREE_TXID_VERSIONS) {
      // Create utxo merkletrees
      this.utxoMerkletrees[txidVersion] ??= [];
      this.utxoMerkletrees[txidVersion][chain.type] ??= [];

      // eslint-disable-next-line no-await-in-loop
      const utxoMerkletree = await UTXOMerkletree.create(
        this.db,
        chain,
        txidVersion,
        (_txidVersion, _chain, tree, _index, merkleroot) =>
          ContractStore.railgunSmartWalletContracts[chain.type]?.[chain.id].validateMerkleroot(
            tree,
            merkleroot,
          ),
      );
      this.utxoMerkletrees[txidVersion][chain.type][chain.id] = utxoMerkletree;

      // Load utxo merkletree to all wallets
      Object.values(this.wallets).forEach((wallet) => {
        wallet.loadUTXOMerkletree(txidVersion, utxoMerkletree);
      });

      // Create railgun txid merkletrees
      this.txidMerkletrees[txidVersion] ??= [];
      this.txidMerkletrees[txidVersion][chain.type] ??= [];

      let txidMerkletree: TXIDMerkletree;

      if (isDefined(poiLaunchBlock)) {
        if (this.isPOINode) {
          // POI Node Txid merkletree
          // eslint-disable-next-line no-await-in-loop
          txidMerkletree = await TXIDMerkletree.createForPOINode(
            this.db,
            chain,
            txidVersion,
            poiLaunchBlock,
          );
          this.txidMerkletrees[txidVersion][chain.type][chain.id] = txidMerkletree;
        } else {
          // Wallet Txid merkletree
          // eslint-disable-next-line no-await-in-loop
          txidMerkletree = await TXIDMerkletree.createForWallet(
            this.db,
            chain,
            txidVersion,
            poiLaunchBlock,
            this.validateRailgunTxidMerkleroot,
          );
          this.txidMerkletrees[txidVersion][chain.type][chain.id] = txidMerkletree;
        }
      }

      // Load txid merkletree to all wallets
      Object.values(this.wallets).forEach((wallet) => {
        wallet.loadRailgunTXIDMerkletree(txidVersion, txidMerkletree);
      });

      // Set deployment block for txidVersion
      this.deploymentBlocks[txidVersion] ??= [];
      this.deploymentBlocks[txidVersion][chain.type] ??= [];
      this.deploymentBlocks[txidVersion][chain.type][chain.id] = deploymentBlocks[txidVersion];
    }

    if (this.skipMerkletreeScans) {
      return;
    }

    // Setup listeners
    const eventsListener = async (
      txidVersion: TXIDVersion,
      { startPosition, treeNumber, commitments }: CommitmentEvent,
    ) => {
      await this.commitmentListener(
        txidVersion,
        chain,
        treeNumber,
        startPosition,
        commitments,
        true, // shouldUpdateTrees
        true, // shouldTriggerTxidSync - only for live listener events
      );
      await this.scanAllWallets(txidVersion, chain, undefined);
    };
    const nullifierListener = async (txidVersion: TXIDVersion, nullifiers: Nullifier[]) => {
      await this.nullifierListener(txidVersion, chain, nullifiers);
      await this.scanAllWallets(txidVersion, chain, undefined);
    };
    const unshieldListener = async (txidVersion: TXIDVersion, unshields: UnshieldStoredEvent[]) => {
      await this.unshieldListener(txidVersion, chain, unshields);
    };
    await ContractStore.railgunSmartWalletContracts[chain.type]?.[chain.id].setTreeUpdateListeners(
      eventsListener,
      nullifierListener,
      unshieldListener,
    );
  }

  /**
   * Unload network
   * @param chain - chainID of network to unload
   */
  async unloadNetwork(chain: Chain): Promise<void> {
    if (!isDefined(ContractStore.railgunSmartWalletContracts[chain.type]?.[chain.id])) {
      return;
    }

    // Unload merkletrees from wallets
    Object.values(this.wallets).forEach((wallet) => {
      ACTIVE_TXID_VERSIONS.forEach((txidVersion) => {
        wallet.unloadUTXOMerkletree(txidVersion, chain);
        wallet.unloadRailgunTXIDMerkletree(txidVersion, chain);
      });
    });

    // Unload listeners
    await ContractStore.railgunSmartWalletContracts[chain.type]?.[chain.id].unload();

    // Delete contracts
    delete ContractStore.railgunSmartWalletContracts[chain.type]?.[chain.id];
    delete ContractStore.relayAdaptContracts[chain.type]?.[chain.id];

    ACTIVE_TXID_VERSIONS.forEach((txidVersion) => {
      // Delete UTXO merkletree
      delete this.utxoMerkletrees[txidVersion]?.[chain.type]?.[chain.id];
      // Delete Txid merkletree
      delete this.txidMerkletrees[txidVersion]?.[chain.type]?.[chain.id];
    });
  }

  private static getLastSyncedBlockDBPrefix(chain: Chain): string[] {
    const path = [DatabaseNamespace.ChainSyncInfo, 'last_synced_block'];
    if (chain != null) {
      path.push(getChainFullNetworkID(chain));
    }
    return path;
  }

  /**
   * Sets last synced block to resume syncing on next load.
   * @param chain - chain type/id to store value for
   * @param lastSyncedBlock - last synced block
   */
  setLastSyncedBlock(chain: Chain, lastSyncedBlock: number): Promise<void> {
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

  private static getUTXOMerkletreeHistoryVersionDBPrefix(chain?: Chain): string[] {
    const path = [DatabaseNamespace.ChainSyncInfo, 'merkleetree_history_version'];
    if (chain != null) {
      path.push(getChainFullNetworkID(chain));
    }
    return path;
  }

  private static getTxidMerkletreeHistoryVersionDBPrefix(chain?: Chain): string[] {
    const path = [DatabaseNamespace.ChainSyncInfo, 'txid_merkletree_history_version'];
    if (chain != null) {
      path.push(getChainFullNetworkID(chain));
    }
    return path;
  }

  setUTXOMerkletreeHistoryVersion(chain: Chain, merkletreeHistoryVersion: number): Promise<void> {
    return this.db.put(
      RailgunEngine.getUTXOMerkletreeHistoryVersionDBPrefix(chain),
      merkletreeHistoryVersion,
      'utf8',
    );
  }

  getUTXOMerkletreeHistoryVersion(chain: Chain): Promise<Optional<number>> {
    return this.db
      .get(RailgunEngine.getUTXOMerkletreeHistoryVersionDBPrefix(chain), 'utf8')
      .then((val: string) => parseInt(val, 10))
      .catch(() => Promise.resolve(undefined));
  }

  setTxidMerkletreeHistoryVersion(chain: Chain, merkletreeHistoryVersion: number): Promise<void> {
    return this.db.put(
      RailgunEngine.getTxidMerkletreeHistoryVersionDBPrefix(chain),
      merkletreeHistoryVersion,
      'utf8',
    );
  }

  getTxidMerkletreeHistoryVersion(chain: Chain): Promise<Optional<number>> {
    return this.db
      .get(RailgunEngine.getTxidMerkletreeHistoryVersionDBPrefix(chain), 'utf8')
      .then((val: string) => parseInt(val, 10))
      .catch(() => Promise.resolve(undefined));
  }

  getUTXOMerkletree(txidVersion: TXIDVersion, chain: Chain): UTXOMerkletree {
    const merkletree = this.utxoMerkletrees[txidVersion]?.[chain.type]?.[chain.id];
    if (!isDefined(merkletree)) {
      throw new Error(
        `No utxo merkletree for txidVersion ${txidVersion}, chain ${chain.type}:${chain.id}`,
      );
    }
    return merkletree;
  }

  private hasUTXOMerkletree(txidVersion: TXIDVersion, chain: Chain): boolean {
    try {
      this.getUTXOMerkletree(txidVersion, chain);
      return true;
    } catch {
      return false;
    }
  }

  getTXIDMerkletree(txidVersion: TXIDVersion, chain: Chain): TXIDMerkletree {
    const merkletree = this.txidMerkletrees[txidVersion]?.[chain.type]?.[chain.id];
    if (!isDefined(merkletree)) {
      throw new Error(
        `No railgun txid merkletree for txidVersion ${txidVersion}, chain ${chain.type}:${chain.id}`,
      );
    }
    return merkletree;
  }

  private hasTXIDMerkletree(txidVersion: TXIDVersion, chain: Chain): boolean {
    try {
      this.getTXIDMerkletree(txidVersion, chain);
      return true;
    } catch {
      return false;
    }
  }

  async getCompletedTxidFromNullifiers(
    txidVersion: TXIDVersion,
    chain: Chain,
    nullifiers: string[],
  ): Promise<Optional<string>> {
    if (!nullifiers.length) {
      return undefined;
    }

    const utxoMerkletree = this.getUTXOMerkletree(txidVersion, chain);

    const firstNullifier = nullifiers[0];
    const firstTxid = await utxoMerkletree.getNullifierTxid(firstNullifier);
    if (!isDefined(firstTxid)) {
      return undefined;
    }

    const otherTxids: Optional<string>[] = await Promise.all(
      nullifiers
        .slice(1)
        .map(async (nullifier) => await utxoMerkletree.getNullifierTxid(nullifier)),
    );

    const matchingTxids = otherTxids.filter((txid) => txid === firstTxid);
    const allMatch = matchingTxids.length === nullifiers.length - 1;
    return allMatch ? formatToByteLength(firstTxid, ByteLength.UINT_256, true) : undefined;
  }

  async scanAllWallets(
    txidVersion: TXIDVersion,
    chain: Chain,
    progressCallback: Optional<(progress: number) => void>,
  ) {
    const wallets = this.allWallets();
    // eslint-disable-next-line no-restricted-syntax
    for (let i = 0; i < wallets.length; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await wallets[i].scanBalances(txidVersion, chain, (walletProgress: number) => {
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
  async unload() {
    // Unload chains
    await Promise.all(
      ContractStore.railgunSmartWalletContracts.map(async (contractsForChainType, chainType) => {
        await Promise.all(
          contractsForChainType.map(async (_railgunSmartWalletContract, chainID) => {
            EngineDebug.log(`unload network ${chainType}:${chainID}`);
            await this.unloadNetwork({ type: chainType, id: chainID });
          }),
        );
      }),
    );

    // Unload wallets
    Object.keys(this.wallets).forEach((walletID) => {
      this.unloadWallet(walletID);
    });

    await this.db.close();
  }

  private loadWallet(wallet: AbstractWallet): void {
    // Store wallet against ID
    this.wallets[wallet.id] = wallet;

    if (this.skipMerkletreeScans) {
      throw new Error(
        'Cannot load wallet: skipMerkletreeScans set to true. Wallets require merkle scans to load balances and history.',
      );
    }

    // eslint-disable-next-line no-restricted-syntax
    for (const txidVersion of ACTIVE_TXID_VERSIONS) {
      // Load UTXO and TXID merkletrees for wallet
      this.utxoMerkletrees[txidVersion]?.forEach((merkletreesForChainType) => {
        merkletreesForChainType.forEach((merkletree) => {
          wallet.loadUTXOMerkletree(txidVersion, merkletree);
        });
      });
      this.txidMerkletrees[txidVersion]?.forEach((merkletreesForChainType) => {
        merkletreesForChainType.forEach((merkletree) => {
          wallet.loadRailgunTXIDMerkletree(txidVersion, merkletree);
        });
      });
    }
  }

  /**
   * Load existing wallet
   * @param {string} encryptionKey - encryption key of wallet
   * @param {string} id - wallet ID
   * @returns id
   */
  async loadExistingWallet(encryptionKey: string, id: string): Promise<RailgunWallet> {
    if (isDefined(this.wallets[id])) {
      return this.wallets[id] as RailgunWallet;
    }
    const wallet = await RailgunWallet.loadExisting(this.db, encryptionKey, id, this.prover);
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
    if (isDefined(this.wallets[id])) {
      return this.wallets[id] as ViewOnlyWallet;
    }
    const wallet = await ViewOnlyWallet.loadExisting(this.db, encryptionKey, id, this.prover);
    this.loadWallet(wallet);
    return wallet;
  }

  async deleteWallet(id: string) {
    this.unloadWallet(id);
    return AbstractWallet.delete(this.db, id);
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
      this.prover,
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
      this.prover,
    );
    this.loadWallet(wallet);
    return wallet;
  }

  async getAllShieldCommitments(
    txidVersion: TXIDVersion,
    chain: Chain,
    startingBlock: number,
  ): Promise<(ShieldCommitment | LegacyGeneratedCommitment)[]> {
    const utxoMerkletree = this.getUTXOMerkletree(txidVersion, chain);
    const latestTree = await utxoMerkletree.latestTree();

    // TODO: use blockNumber to find exact starting position... But the logic is currently broken.

    // const treeInfo = await AbstractWallet.getTreeAndPositionBeforeBlock(
    //   merkletree,
    //   latestTree,
    //   startingBlock,
    // );

    const shieldCommitments: (ShieldCommitment | LegacyGeneratedCommitment)[] = [];

    const startScanTree = 0;

    for (let treeIndex = startScanTree; treeIndex <= latestTree; treeIndex += 1) {
      // eslint-disable-next-line no-await-in-loop
      const treeHeight = await utxoMerkletree.getTreeLength(treeIndex);
      const fetcher = new Array<Promise<Optional<Commitment>>>(treeHeight);

      // const isInitialTree = treeIndex === startScanTree;
      // const startScanHeight = isInitialTree && treeInfo ? treeInfo.position : 0;
      const startScanHeight = 0;

      for (let index = startScanHeight; index < treeHeight; index += 1) {
        fetcher[index] = utxoMerkletree.getCommitment(treeIndex, index);
      }

      // eslint-disable-next-line no-await-in-loop
      const leaves: Optional<Commitment>[] = await Promise.all(fetcher);
      leaves.forEach((leaf) => {
        if (!leaf) {
          return;
        }
        if (leaf.blockNumber < startingBlock) {
          return;
        }
        if (
          leaf.commitmentType === CommitmentType.LegacyGeneratedCommitment ||
          leaf.commitmentType === CommitmentType.ShieldCommitment
        ) {
          shieldCommitments.push(leaf);
        }
      });
    }

    return shieldCommitments;
  }

  // Top-level exports:

  static encodeAddress = encodeAddress;

  static decodeAddress = decodeAddress;

  railgunSmartWalletContracts = ContractStore.railgunSmartWalletContracts;

  relayAdaptContracts = ContractStore.relayAdaptContracts;
}

export { RailgunEngine };
