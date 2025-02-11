import type { AbstractLevelDOWN } from 'abstract-leveldown';
import EventEmitter from 'events';
import { FallbackProvider } from 'ethers';
import { RailgunSmartWalletContract } from './contracts/railgun-smart-wallet/V2/railgun-smart-wallet';
import { RelayAdaptV2Contract } from './contracts/relay-adapt/V2/relay-adapt-v2';
import { Database, DatabaseNamespace } from './database/database';
import { Prover } from './prover/prover';
import { encodeAddress, decodeAddress } from './key-derivation/bech32';
import { ByteLength, ByteUtils } from './utils/bytes';
import { RailgunWallet } from './wallet/railgun-wallet';
import EngineDebug from './debugger/debugger';
import { Chain, EngineDebugger } from './models/engine-types';
import {
  CommitmentType,
  LegacyGeneratedCommitment,
  Nullifier,
  RailgunTransactionV2,
  RailgunTransactionV3,
  RailgunTransactionVersion,
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
  QuickSyncRailgunTransactionsV2,
  UTXOScanDecryptBalancesCompleteEventData,
  UnshieldStoredEvent,
} from './models/event-types';
import { ViewOnlyWallet } from './wallet/view-only-wallet';
import { AbstractWallet } from './wallet/abstract-wallet';
import WalletInfo from './wallet/wallet-info';
import {
  addChainSupportsV3,
  assertChainSupportsV3,
  getChainFullNetworkID,
  getChainSupportsV3,
} from './chain/chain';
import { ArtifactGetter } from './models/prover-types';
import { ContractStore } from './contracts/contract-store';
import {
  CURRENT_TXID_V2_MERKLETREE_HISTORY_VERSION,
  CURRENT_UTXO_MERKLETREE_HISTORY_VERSION,
} from './utils/constants';
import { PollingJsonRpcProvider } from './provider/polling-json-rpc-provider';
import { assertIsPollingProvider } from './provider/polling-util';
import { isDefined } from './utils/is-defined';
import { UTXOMerkletree } from './merkletree/utxo-merkletree';
import { TXIDMerkletree } from './merkletree/txid-merkletree';
import { MerklerootValidator } from './models/merkletree-types';
import { delay, promiseTimeout } from './utils/promises';
import { initPoseidonPromise } from './utils/poseidon';
import { initCurve25519Promise } from './utils/scalar-multiply';
import {
  calculateRailgunTransactionVerificationHash,
  createRailgunTransactionWithHash,
} from './transaction/railgun-txid';
import {
  ACTIVE_TXID_VERSIONS,
  ACTIVE_UTXO_MERKLETREE_TXID_VERSIONS,
  TXIDVersion,
} from './models/poi-types';
import { getTokenDataHash, getUnshieldTokenHash } from './note/note-util';
import { UnshieldNote } from './note';
import { POI } from './poi';
import { PoseidonMerkleAccumulatorContract } from './contracts/railgun-smart-wallet/V3/poseidon-merkle-accumulator';
import { PoseidonMerkleVerifierContract } from './contracts/railgun-smart-wallet/V3/poseidon-merkle-verifier';
import { TokenVaultContract } from './contracts/railgun-smart-wallet/V3/token-vault-contract';
import { Registry } from './utils/registry';
import { stringToBigInt } from './utils/bigint';
import { isTransactCommitment } from './utils/commitment';

class RailgunEngine extends EventEmitter {
  readonly db: Database;

  private readonly utxoMerkletrees: Registry<UTXOMerkletree> = new Registry();

  private readonly txidMerkletrees: Registry<TXIDMerkletree> = new Registry();

  readonly prover: Prover;

  readonly wallets: { [key: string]: AbstractWallet } = {};

  readonly deploymentBlocks: Registry<number> = new Registry();

  readonly quickSyncEvents: QuickSyncEvents;

  readonly quickSyncRailgunTransactionsV2: QuickSyncRailgunTransactionsV2;

  readonly validateRailgunTxidMerkleroot: MerklerootValidator;

  readonly getLatestValidatedRailgunTxid: GetLatestValidatedRailgunTxid;

  static walletSource: Optional<string>;

  private readonly skipMerkletreeScans: boolean;

  private readonly hasSyncedRailgunTransactionsV2: Registry<boolean> = new Registry();

  readonly isPOINode: boolean;

  private constructor(
    walletSource: string,
    leveldown: AbstractLevelDOWN,
    artifactGetter: ArtifactGetter,
    quickSyncEvents: QuickSyncEvents,
    quickSyncRailgunTransactionsV2: QuickSyncRailgunTransactionsV2,
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
    this.quickSyncRailgunTransactionsV2 = quickSyncRailgunTransactionsV2;
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
  static async initForWallet(
    walletSource: string,
    leveldown: AbstractLevelDOWN,
    artifactGetter: ArtifactGetter,
    quickSyncEvents: QuickSyncEvents,
    quickSyncRailgunTransactionsV2: QuickSyncRailgunTransactionsV2,
    validateRailgunTxidMerkleroot: MerklerootValidator,
    getLatestValidatedRailgunTxid: GetLatestValidatedRailgunTxid,
    engineDebugger: Optional<EngineDebugger>,
    skipMerkletreeScans: boolean = false,
  ) {
    await initPoseidonPromise;
    await initCurve25519Promise;
    return new RailgunEngine(
      walletSource,
      leveldown,
      artifactGetter,
      quickSyncEvents,
      quickSyncRailgunTransactionsV2,
      validateRailgunTxidMerkleroot,
      getLatestValidatedRailgunTxid,
      engineDebugger,
      skipMerkletreeScans,
      false, // isPOINode
    );
  }

  static async initForPOINode(
    leveldown: AbstractLevelDOWN,
    artifactGetter: ArtifactGetter,
    quickSyncEvents: QuickSyncEvents,
    quickSyncRailgunTransactionsV2: QuickSyncRailgunTransactionsV2,
    engineDebugger: Optional<EngineDebugger>,
  ) {
    await initPoseidonPromise;
    await initCurve25519Promise;
    return new RailgunEngine(
      'poinode',
      leveldown,
      artifactGetter,
      quickSyncEvents,
      quickSyncRailgunTransactionsV2,
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
  private async commitmentListener(
    txidVersion: TXIDVersion,
    chain: Chain,
    events: CommitmentEvent[],
    shouldUpdateTrees: boolean,
    shouldTriggerV2TxidSync: boolean,
  ): Promise<void> {
    if (this.db.isClosed()) {
      return;
    }
    if (!events.length) {
      return;
    }

    const utxoMerkletree = this.getUTXOMerkletree(txidVersion, chain);

    for (const event of events) {
      const { treeNumber, startPosition, commitments } = event;
      if (EngineDebug.verboseScanLogging()) {
        EngineDebug.log(
          `[commitmentListener: ${chain.type}:${chain.id}]: ${commitments.length} leaves at ${startPosition}`,
        );
      }
      for (const commitment of commitments) {
        commitment.txid = ByteUtils.formatToByteLength(commitment.txid, ByteLength.UINT_256, false);
      }

      // Queue leaves to merkle tree
      for (const commitment of commitments) {
        const normalizedIndex = commitment.utxoIndex % 2 ** 16;
        const normalizedTreeNumber = commitment.utxoTree + (commitment.utxoIndex >> 16);
        // eslint-disable-next-line no-await-in-loop
        await utxoMerkletree.queueLeaves(normalizedTreeNumber, normalizedIndex, [commitment]);
      }
    }

    if (shouldUpdateTrees) {
      await utxoMerkletree.updateTreesFromWriteQueue();
    }

    if (shouldTriggerV2TxidSync) {
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      this.triggerDelayedTXIDMerkletreeSyncV2(chain);
    }
  }

  private async triggerDelayedTXIDMerkletreeSyncV2(
    chain: Chain,
    scanCount: number = 0,
  ): Promise<void> {
    // Delay and then trigger a Railgun Txid Merkletree sync.
    if (this.isPOINode) {
      // POI node should scan faster because POI node is the data source for wallets
      await delay(3000);
    } else if (scanCount === 0) {
      // Delay for 10 seconds on first scan for wallet
      await delay(10000);
    } else {
      // Delay for 5 seconds on for subsequent scans for wallet
      await delay(5000);
    }

    await this.syncRailgunTransactionsV2(chain, 'delayed sync after new utxo');

    // Scan for 2 times total
    if (scanCount < 1) {
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      this.triggerDelayedTXIDMerkletreeSyncV2(chain, scanCount + 1);
    }
  }

  /**
   * Handle new nullifiers
   * @param chain - chain type/id for nullifiers
   * @param nullifiers - transaction info to nullify commitment
   */
  private async nullifierListener(
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

    for (const nullifier of nullifiers) {
      nullifier.txid = ByteUtils.formatToByteLength(nullifier.txid, ByteLength.UINT_256, false);
      nullifier.nullifier = ByteUtils.formatToByteLength(
        nullifier.nullifier,
        ByteLength.UINT_256,
        false,
      );
    }
    const utxoMerkletree = this.getUTXOMerkletree(txidVersion, chain);
    await utxoMerkletree.nullify(nullifiers);

    this.invalidateTXOsCacheAllWallets(chain);
  }

  /**
   * Handle new unshield events
   * @param chain - chain type/id
   * @param unshields - unshield events
   */
  private async unshieldListener(
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
    for (const unshield of unshields) {
      unshield.txid = ByteUtils.formatToByteLength(unshield.txid, ByteLength.UINT_256, false);
    }
    const utxoMerkletree = this.getUTXOMerkletree(txidVersion, chain);
    await utxoMerkletree.addUnshieldEvents(unshields);

    this.invalidateTXOsCacheAllWallets(chain);
  }

  /**
   * Handle new railgun transaction events for V3
   * @param chain - chain type/id
   * @param railgunTransactions - railgun transaction events
   */
  private async railgunTransactionsV3Listener(
    txidVersion: TXIDVersion,
    chain: Chain,
    railgunTransactions: RailgunTransactionV3[],
  ): Promise<void> {
    if (this.db.isClosed()) {
      return;
    }
    if (!railgunTransactions.length) {
      return;
    }
    if (txidVersion !== TXIDVersion.V3_PoseidonMerkle) {
      throw new Error('Railgun transactions listener only supported for V3 Poseidon Merkle');
    }
    EngineDebug.log(
      `engine.railgunTransactions[${chain.type}:${chain.id}] ${railgunTransactions.length}`,
    );

    await this.handleNewRailgunTransactionsV3(txidVersion, chain, railgunTransactions);
  }

  private async getMostRecentValidCommitmentBlock(
    txidVersion: TXIDVersion,
    chain: Chain,
  ): Promise<Optional<number>> {
    const utxoMerkletree = this.getUTXOMerkletree(txidVersion, chain);
    const railgunSmartWalletContract = ContractStore.railgunSmartWalletContracts.get(null, chain);
    if (!isDefined(railgunSmartWalletContract)) {
      throw new Error('No RailgunSmartWalletContract loaded.');
    }
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
          const txReceipt = await provider.getTransactionReceipt(
            ByteUtils.hexlify(latestEvent.txid, true),
          );
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

  private async getStartScanningBlock(txidVersion: TXIDVersion, chain: Chain): Promise<number> {
    let startScanningBlock = await this.getMostRecentValidCommitmentBlock(txidVersion, chain);
    EngineDebug.log(
      `[${txidVersion}] most recent valid commitment block: ${startScanningBlock ?? 'unknown'}`,
    );
    if (startScanningBlock == null) {
      // If we haven't scanned anything yet, start scanning at deployment block
      startScanningBlock = this.deploymentBlocks.get(txidVersion, chain);
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
      EngineDebug.log(`[${txidVersion}] quickSync: chain ${chain.type}:${chain.id}`);
      const utxoMerkletree = this.getUTXOMerkletree(txidVersion, chain);

      const startScanningBlockQuickSync = await this.getStartScanningBlock(txidVersion, chain);
      EngineDebug.log(
        `[${txidVersion}] Start scanning block for QuickSync: ${startScanningBlockQuickSync}`,
      );

      this.emitUTXOMerkletreeScanUpdateEvent(txidVersion, chain, endProgress * 0.2); // 10% / 50%

      // Fetch events
      const { commitmentEvents, unshieldEvents, nullifierEvents, railgunTransactionEvents } =
        await this.quickSyncEvents(txidVersion, chain, startScanningBlockQuickSync);

      if (railgunTransactionEvents) {
        EngineDebug.log(
          `[${txidVersion}] QuickSync railgunTransactionEvents: ${railgunTransactionEvents.length}`,
        );
        await this.handleNewRailgunTransactionsV3(txidVersion, chain, railgunTransactionEvents);
      }

      this.emitUTXOMerkletreeScanUpdateEvent(txidVersion, chain, endProgress * 0.3); // 15% / 50%

      await this.unshieldListener(txidVersion, chain, unshieldEvents);
      this.emitUTXOMerkletreeScanUpdateEvent(txidVersion, chain, endProgress * 0.5); // 25% / 50%
      await this.nullifierListener(txidVersion, chain, nullifierEvents);

      EngineDebug.log(`[${txidVersion}] QuickSync commitments: ${commitmentEvents.length}`);

      // Make sure commitments are scanned after Unshields and Nullifiers.
      await this.commitmentListener(
        txidVersion,
        chain,
        commitmentEvents,
        false, // shouldUpdateTrees - wait until after all commitments added
        false, // shouldTriggerV2TxidSync - not during quick sync
      );

      // Scan after all leaves added.
      if (commitmentEvents.length) {
        this.emitUTXOMerkletreeScanUpdateEvent(txidVersion, chain, endProgress * 0.6); // 30% / 50%
        await utxoMerkletree.updateTreesFromWriteQueue();
        this.emitUTXOMerkletreeScanUpdateEvent(txidVersion, chain, endProgress * 0.8); // 40% / 50%
      }
    } catch (cause) {
      if (retryCount < 1) {
        await this.performQuickSync(txidVersion, chain, endProgress, retryCount + 1);
        return;
      }
      EngineDebug.error(new Error('Failed to quick sync', { cause }));
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

  private async getNextStartingBlockSlowScan(
    txidVersion: TXIDVersion,
    chain: Chain,
  ): Promise<number> {
    // Get updated start-scanning block from new valid utxoMerkletree.
    let startScanningBlockSlowScan = await this.getStartScanningBlock(txidVersion, chain);
    const lastSyncedBlock = await this.getLastSyncedBlock(txidVersion, chain);
    EngineDebug.log(`[${txidVersion}] lastSyncedBlock: ${lastSyncedBlock ?? 'unknown'}`);
    if (isDefined(lastSyncedBlock) && lastSyncedBlock > startScanningBlockSlowScan) {
      startScanningBlockSlowScan = lastSyncedBlock;
    }
    return startScanningBlockSlowScan;
  }

  /**
   * Scan contract history and sync
   * @param chain - chain type/id to scan
   * @param walletIdFilter - optional list of wallet ids to decrypt balances
   */
  async scanContractHistory(chain: Chain, walletIdFilter: Optional<string[]>) {
    for (const txidVersion of ACTIVE_TXID_VERSIONS) {
      if (!getChainSupportsV3(chain) && txidVersion === TXIDVersion.V3_PoseidonMerkle) {
        continue;
      }

      // eslint-disable-next-line no-await-in-loop
      await this.scanUTXOHistory(txidVersion, chain, walletIdFilter);
    }

    await this.scanTXIDHistoryV2(chain);
  }

  /**
   * Scan (via quick sync or slow sync) on-chain data for the UTXO merkletree.
   */
  private async scanUTXOHistory(
    txidVersion: TXIDVersion,
    chain: Chain,
    walletIdFilter: Optional<string[]>,
  ) {
    if (this.skipMerkletreeScans) {
      EngineDebug.log(`Skipping merkletree scan: skipMerkletreeScans set on RAILGUN Engine.`);
      return;
    }
    if (!this.hasUTXOMerkletree(txidVersion, chain)) {
      EngineDebug.log(
        `Cannot scan history. UTXO merkletree not yet loaded for ${txidVersion}, chain ${chain.type}:${chain.id}.`,
      );
      return;
    }
    if (!isDefined(ContractStore.railgunSmartWalletContracts.get(null, chain))) {
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
      await this.clearUTXOMerkletreeAndLoadedWalletsAllTXIDVersions(chain);
      await this.setUTXOMerkletreeHistoryVersion(chain, CURRENT_UTXO_MERKLETREE_HISTORY_VERSION);
    }

    const utxoMerkletree = this.getUTXOMerkletree(txidVersion, chain);

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
      `[${txidVersion}] startScanningBlockSlowScan: ${startScanningBlockSlowScan} (note: continously updated during scan)`,
    );

    const railgunSmartWalletContract = ContractStore.railgunSmartWalletContracts.get(null, chain);
    if (!railgunSmartWalletContract?.contract.runner?.provider) {
      throw new Error('Requires RailgunSmartWalletContract with provider');
    }
    const latestBlock = await railgunSmartWalletContract.contract.runner.provider.getBlockNumber();

    try {
      switch (txidVersion) {
        case TXIDVersion.V2_PoseidonMerkle:
          await this.slowSyncV2(
            chain,
            utxoMerkletree,
            startScanningBlockSlowScan,
            latestBlock,
            postQuickSyncProgress,
          );
          break;
        case TXIDVersion.V3_PoseidonMerkle:
          await this.slowSyncV3(
            chain,
            utxoMerkletree,
            startScanningBlockSlowScan,
            latestBlock,
            postQuickSyncProgress,
          );
          break;
      }

      // Final balance decryption after all leaves added.
      const decryptStartingProgress = 0.7;
      await this.decryptBalancesAllWallets(
        txidVersion,
        chain,
        walletIdFilter,
        (progress: number) => {
          const overallProgress =
            progress * (0.97 - decryptStartingProgress) + decryptStartingProgress;
          this.emitUTXOMerkletreeScanUpdateEvent(txidVersion, chain, overallProgress); // 90-97%
        },
        true, // deferCompletionEvent
      );

      utxoMerkletree.isScanning = false;
      this.emitUTXOMerkletreeScanUpdateEvent(txidVersion, chain, 0.97); // 97%

      // The handler of EngineEvent.UTXOScanDecryptBalancesComplete will
      // call emitScanEventHistoryComplete when it is done processing balances since that can take some time.
      // This is better UX than calling MerkletreeScanStatus.Complete 5-10 sec before balances are actually passed to front end.
      const decryptBalancesCompleteEventData: UTXOScanDecryptBalancesCompleteEventData = {
        txidVersion,
        chain,
        walletIdFilter,
      };
      this.emit(EngineEvent.UTXOScanDecryptBalancesComplete, decryptBalancesCompleteEventData);
    } catch (err) {
      if (!(err instanceof Error)) {
        throw err;
      }
      EngineDebug.log(`Scan incomplete for chain ${chain.type}:${chain.id}`);
      EngineDebug.error(err);
      await this.decryptBalancesAllWallets(
        txidVersion,
        chain,
        walletIdFilter,
        undefined, // progressCallback
        false, // deferCompletionEvent
      );
      const scanIncompleteData: MerkletreeHistoryScanEventData = {
        scanStatus: MerkletreeScanStatus.Incomplete,
        txidVersion,
        chain,
      };
      this.emit(EngineEvent.UTXOMerkletreeHistoryScanUpdate, scanIncompleteData);
      utxoMerkletree.isScanning = false;
    }
  }

  emitScanEventHistoryComplete(txidVersion: TXIDVersion, chain: Chain) {
    this.emitUTXOMerkletreeScanUpdateEvent(txidVersion, chain, 1.0); // 100%
    const scanCompleteData: MerkletreeHistoryScanEventData = {
      scanStatus: MerkletreeScanStatus.Complete,
      txidVersion,
      chain,
    };
    this.emit(EngineEvent.UTXOMerkletreeHistoryScanUpdate, scanCompleteData);
  }

  private async slowSyncV2(
    chain: Chain,
    utxoMerkletree: UTXOMerkletree,
    startScanningBlockSlowScan: number,
    latestBlock: number,
    postQuickSyncProgress: number,
  ) {
    const txidVersion = TXIDVersion.V2_PoseidonMerkle;

    const railgunSmartWalletContract = ContractStore.railgunSmartWalletContracts.get(null, chain);
    if (!isDefined(railgunSmartWalletContract)) {
      throw new Error('Requires RailgunSmartWallet contract');
    }

    const totalBlocksToScan = latestBlock - startScanningBlockSlowScan;
    EngineDebug.log(`[${txidVersion}] Total blocks to SlowScan: ${totalBlocksToScan}`);

    await railgunSmartWalletContract.getHistoricalEvents(
      startScanningBlockSlowScan,
      latestBlock,
      () => this.getNextStartingBlockSlowScan(txidVersion, chain),
      async (_txidVersion: TXIDVersion, commitmentEvents: CommitmentEvent[]) => {
        await this.commitmentListener(
          txidVersion,
          chain,
          commitmentEvents,
          true, // shouldUpdateTrees
          false, // shouldTriggerV2TxidSync - not during slow sync
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
          ((1 - postQuickSyncProgress - 0.3) * scannedBlocks) / totalBlocksToScan;
        this.emitUTXOMerkletreeScanUpdateEvent(txidVersion, chain, progress);

        if (utxoMerkletree.getFirstInvalidMerklerootTree() != null) {
          // Do not save lastSyncedBlock in case of merkleroot error.
          // This will force a scan from the last valid commitment on next run.
          return;
        }
        await this.setLastSyncedBlock(txidVersion, chain, syncedBlock);
      },
    );
  }

  private async slowSyncV3(
    chain: Chain,
    utxoMerkletree: UTXOMerkletree,
    startScanningBlockSlowScan: number,
    latestBlock: number,
    postQuickSyncProgress: number,
  ) {
    const txidVersion = TXIDVersion.V3_PoseidonMerkle;

    const poseidonMerkleAccumulatorV3Contract =
      ContractStore.poseidonMerkleAccumulatorV3Contracts.get(null, chain);
    if (!isDefined(poseidonMerkleAccumulatorV3Contract)) {
      throw new Error('Requires V3PoseidonMerkleAccumulator contract');
    }

    const totalBlocksToScan = latestBlock - startScanningBlockSlowScan;
    EngineDebug.log(`[${txidVersion}] Total blocks to SlowScan: ${totalBlocksToScan}`);

    await poseidonMerkleAccumulatorV3Contract.getHistoricalEvents(
      startScanningBlockSlowScan,
      latestBlock,
      () => this.getNextStartingBlockSlowScan(txidVersion, chain),
      async (_txidVersion: TXIDVersion, commitmentEvents: CommitmentEvent[]) => {
        await this.commitmentListener(
          txidVersion,
          chain,
          commitmentEvents,
          true, // shouldUpdateTrees
          false, // shouldTriggerV2TxidSync - not during slow sync (or V3)
        );
      },
      async (_txidVersion: TXIDVersion, nullifiers: Nullifier[]) => {
        await this.nullifierListener(txidVersion, chain, nullifiers);
      },
      async (_txidVersion: TXIDVersion, unshields: UnshieldStoredEvent[]) => {
        await this.unshieldListener(txidVersion, chain, unshields);
      },
      async (_txidVersion: TXIDVersion, railgunTransactions: RailgunTransactionV3[]) => {
        await this.railgunTransactionsV3Listener(txidVersion, chain, railgunTransactions);
      },
      async (syncedBlock: number) => {
        const scannedBlocks = syncedBlock - startScanningBlockSlowScan;
        const progress =
          postQuickSyncProgress +
          ((1 - postQuickSyncProgress - 0.3) * scannedBlocks) / totalBlocksToScan;
        this.emitUTXOMerkletreeScanUpdateEvent(txidVersion, chain, progress);

        if (utxoMerkletree.getFirstInvalidMerklerootTree() != null) {
          // Do not save lastSyncedBlock in case of merkleroot error.
          // This will force a scan from the last valid commitment on next run.
          return;
        }
        await this.setLastSyncedBlock(txidVersion, chain, syncedBlock);
      },
    );
  }

  /**
   * Scan subgraph data for railgun transactions to build the TXID merkletree.
   */
  private async scanTXIDHistoryV2(chain: Chain) {
    const txidVersion = TXIDVersion.V2_PoseidonMerkle;

    if (!this.hasTXIDMerkletree(txidVersion, chain)) {
      EngineDebug.log(
        `Cannot sync txids. Txid merkletree not yet loaded for chain ${chain.type}:${chain.id}.`,
      );
      return;
    }
    this.hasSyncedRailgunTransactionsV2.set(null, chain, true);
    await this.syncRailgunTransactionsV2(chain, 'poller');
  }

  /**
   * Sync Railgun txid merkletree.
   * @param chain - chain type/id to scan
   */
  async syncRailgunTransactionsV2(chain: Chain, trigger: string) {
    const txidVersion = TXIDVersion.V2_PoseidonMerkle;

    if (!this.hasTXIDMerkletree(txidVersion, chain)) {
      EngineDebug.log(
        `Cannot sync txids. Txid merkletree not yet loaded for chain ${chain.type}:${chain.id}.`,
      );
      return;
    }

    const txidMerkletree = this.getTXIDMerkletree(txidVersion, chain);
    if (txidMerkletree.isScanning) {
      // Do not allow multiple simultaneous scans.
      EngineDebug.log('[Txid] Already syncing. Stopping additional re-sync.');
      return;
    }

    try {
      txidMerkletree.isScanning = true;

      const txidV2MerkletreeHistoryVersion = await this.getTxidV2MerkletreeHistoryVersion(chain);
      if (
        !isDefined(txidV2MerkletreeHistoryVersion) ||
        txidV2MerkletreeHistoryVersion < CURRENT_TXID_V2_MERKLETREE_HISTORY_VERSION
      ) {
        await this.clearTXIDMerkletree(txidVersion, chain);
        await this.setTxidV2MerkletreeHistoryVersion(
          chain,
          CURRENT_TXID_V2_MERKLETREE_HISTORY_VERSION,
        );
      }

      await this.performSyncRailgunTransactionsV2(chain, trigger);
    } finally {
      txidMerkletree.isScanning = false;
    }
  }

  private async shouldAddNewRailgunTransactions(
    txidVersion: TXIDVersion,
    chain: Chain,
    latestValidatedTxidIndex: Optional<number>,
  ): Promise<boolean> {
    if (!isDefined(latestValidatedTxidIndex)) {
      return true;
    }

    const { txidIndex: latestTxidIndex } = await this.getLatestRailgunTxidData(txidVersion, chain);
    const isAheadOfValidatedTxids =
      !isDefined(latestValidatedTxidIndex) || latestTxidIndex >= latestValidatedTxidIndex;

    return !isAheadOfValidatedTxids;
  }

  private async getLatestValidatedTxidIndex(
    txidVersion: TXIDVersion,
    chain: Chain,
  ): Promise<Optional<number>> {
    if (this.isPOINode) {
      return undefined;
    }

    // TODO: Optimization - use this merkleroot from validated railgun txid to auto-validate merkletree.
    const { txidIndex: latestValidatedTxidIndex /* merkleroot */ } =
      await this.getLatestValidatedRailgunTxid(txidVersion, chain);

    return latestValidatedTxidIndex;
  }

  private async performSyncRailgunTransactionsV2(chain: Chain, trigger: string): Promise<void> {
    const txidVersion = TXIDVersion.V2_PoseidonMerkle;

    try {
      EngineDebug.log(
        `sync railgun txids: chain ${chain.type}:${chain.id}: triggered by ${trigger}`,
      );

      this.emitTXIDMerkletreeScanUpdateEvent(txidVersion, chain, 0.03); // 3%

      this.emitTXIDMerkletreeScanUpdateEvent(txidVersion, chain, 0.15); // 15%

      const txidMerkletree = this.getTXIDMerkletree(txidVersion, chain);

      // while loop to handle multiple queries
      let isLooping = true;
      const txidMerkletreeHistoryStartScanPercentage = 0.4; // 40%
      const txidMerkletreeEndScanPercentage = 0.99; // 99%
      const railgunTransactions: RailgunTransactionV2[] = [];
      const latestRailgunTransaction: Optional<RailgunTransactionWithHash> =
        await txidMerkletree.getLatestRailgunTransaction();
      if (
        latestRailgunTransaction &&
        latestRailgunTransaction.version !== RailgunTransactionVersion.V2
      ) {
        // Should never happen
        return;
      }
      let latestTranasction: RailgunTransactionV2 =
        latestRailgunTransaction as RailgunTransactionV2;
      let txidMerkletreeStartScanPercentage = 0.2; // 20%
      while (isLooping) {
        const railgunTransactionsRAW: RailgunTransactionV2[] =
          // eslint-disable-next-line no-await-in-loop
          await this.quickSyncRailgunTransactionsV2(chain, latestTranasction?.graphID);
        railgunTransactions.push(...railgunTransactionsRAW);
        latestTranasction = railgunTransactionsRAW[railgunTransactionsRAW.length - 1];
        this.emitTXIDMerkletreeScanUpdateEvent(
          txidVersion,
          chain,
          txidMerkletreeStartScanPercentage,
        );
        txidMerkletreeStartScanPercentage += 0.05;
        if (txidMerkletreeStartScanPercentage > 1) {
          txidMerkletreeStartScanPercentage = 0.95;
        }
        isLooping = railgunTransactionsRAW.length === 5000;
      }
      await this.handleNewRailgunTransactionsV2(
        txidVersion,
        chain,
        railgunTransactions,
        latestRailgunTransaction?.verificationHash,
        txidMerkletreeHistoryStartScanPercentage,
        txidMerkletreeEndScanPercentage,
      );

      const scanCompleteData: MerkletreeHistoryScanEventData = {
        scanStatus: MerkletreeScanStatus.Complete,
        txidVersion,
        chain,
      };

      if (railgunTransactions.length) {
        // Only scan wallets if utxoMerkletree is not currently scanning
        const utxoMerkletree = this.getUTXOMerkletree(txidVersion, chain);
        if (!utxoMerkletree.isScanning) {
          // Decrypt balances for all wallets - kicks off a POI refresh.
          await this.decryptBalancesAllWallets(
            txidVersion,
            chain,
            undefined, // walletIdFilter
            undefined, // progressCallback
            false, // deferCompletionEvent
          );
        }
      }

      // Finish
      this.emit(EngineEvent.TXIDMerkletreeHistoryScanUpdate, scanCompleteData);
    } catch (cause) {
      if (!(cause instanceof Error)) {
        throw cause;
      }
      EngineDebug.error(new Error('Failed to sync Railgun transactions V2', { cause }));

      const scanIncompleteData: MerkletreeHistoryScanEventData = {
        scanStatus: MerkletreeScanStatus.Incomplete,
        txidVersion,
        chain,
      };
      this.emit(EngineEvent.TXIDMerkletreeHistoryScanUpdate, scanIncompleteData);
    }
  }

  private async handleNewRailgunTransactionsV2(
    txidVersion: TXIDVersion,
    chain: Chain,
    railgunTransactions: RailgunTransactionV2[],
    latestVerificationHash: Optional<string>,
    startScanPercentage: number,
    endScanPercentage: number,
  ) {
    const latestValidatedTxidIndex = await this.getLatestValidatedTxidIndex(txidVersion, chain);
    // Log chain.id, txidVersion, and if not a POI node, the latest validated txid index.
    EngineDebug.log(
      `syncing railgun transactions to validated index (Chain: ${
        chain.id
      }. txidVersion: ${txidVersion}): ${
        this.isPOINode
          ? 'POI Node: getLatestValidatedTxidIndex() skipped'
          : latestValidatedTxidIndex ?? 'NOT FOUND'
      }`,
    );

    const shouldAddNewRailgunTransactions = await this.shouldAddNewRailgunTransactions(
      txidVersion,
      chain,
      latestValidatedTxidIndex,
    );
    if (!shouldAddNewRailgunTransactions) {
      EngineDebug.log(
        `Skipping queue of Railgun TXIDs - already synced to validated index: ${
          latestValidatedTxidIndex ?? 0
        }`,
      );
      this.emitTXIDMerkletreeScanUpdateEvent(txidVersion, chain, 1);
      return;
    }

    const utxoMerkletree = this.getUTXOMerkletree(txidVersion, chain);
    const txidMerkletree = this.getTXIDMerkletree(txidVersion, chain);

    const v2BlockNumber = RailgunSmartWalletContract.getEngineV2StartBlockNumber(chain);

    const toQueue: RailgunTransactionWithHash[] = [];

    let previousVerificationHash = latestVerificationHash;

    const emitNewRailgunTransactionsProgress = (progress: number) => {
      const overallProgress =
        progress * (endScanPercentage - startScanPercentage) + startScanPercentage;
      this.emitTXIDMerkletreeScanUpdateEvent(txidVersion, chain, overallProgress);
    };

    const railgunTransactionsLength = railgunTransactions.length;

    for (const [index, railgunTransaction] of railgunTransactions.entries()) {
      const railgunTransactionWithTxid = createRailgunTransactionWithHash(railgunTransaction);
      if (railgunTransactionWithTxid.version !== RailgunTransactionVersion.V2) {
        continue;
      }

      const {
        commitments,
        nullifiers,
        txid,
        unshield,
        railgunTxid,
        utxoTreeOut: tree,
        utxoBatchStartPositionOut,
        blockNumber,
        timestamp,
        verificationHash,
      } = railgunTransactionWithTxid;

      // Update existing commitments/unshield events.
      // If any commitments are missing, wait for UTXO tree to sync first.

      const unshieldCommitment: Optional<string> = unshield
        ? commitments[commitments.length - 1]
        : undefined;
      const standardCommitments: string[] = unshield ? commitments.slice(0, -1) : commitments;

      let missingAnyCommitments = false;

      // No Unshield events exist pre-V2.
      const isPreV2 = blockNumber < v2BlockNumber;

      if (isDefined(unshieldCommitment) && unshield) {
        const unshieldTokenHash = getTokenDataHash(unshield.tokenData);

        if (isPreV2) {
          // V2 does not have unshield events. Add a new stored Unshield event.

          // Pre-V2 always had a 25n basis points fee for unshields.
          const preV2FeeBasisPoints = 25n;
          const { fee, amount } = UnshieldNote.getAmountFeeFromValue(
            ByteUtils.hexToBigInt(unshield.value),
            preV2FeeBasisPoints,
          );

          const unshieldEvent: UnshieldStoredEvent = {
            txid,
            tokenAddress: unshield.tokenData.tokenAddress,
            tokenType: unshield.tokenData.tokenType,
            tokenSubID: unshield.tokenData.tokenSubID,
            toAddress: unshield.toAddress,
            amount: amount.toString(),
            fee: fee.toString(),
            blockNumber,
            railgunTxid,
            timestamp,
            eventLogIndex: undefined, // Does not exist for txid subgraph, which is generated through calldata
            poisPerList: undefined,
          };

          // eslint-disable-next-line no-await-in-loop
          await utxoMerkletree.addUnshieldEvents([unshieldEvent]);

          this.invalidateTXOsCacheAllWallets(chain);
        } else {
          // V2 has unshield events. Map to existing event.

          // eslint-disable-next-line no-await-in-loop
          const unshieldEventsForTxid = await utxoMerkletree.getAllUnshieldEventsForTxid(txid);
          const matchingUnshieldEvent = unshieldEventsForTxid.find((unshieldEvent) => {
            // Check if tokenHash matches, if toAddress matches, and if amount matches
            const tokenHash = getUnshieldTokenHash(unshieldEvent);
            const tokenHasMatch = tokenHash === unshieldTokenHash;
            const toAddressHasMatch =
              unshieldEvent.toAddress.toLowerCase() === unshield.toAddress.toLowerCase();
            const amountHasMatch =
              (
                stringToBigInt(unshieldEvent.amount) + stringToBigInt(unshieldEvent.fee)
              ).toString() === unshield.value;

            return tokenHasMatch && toAddressHasMatch && amountHasMatch;
          });
          if (matchingUnshieldEvent) {
            if (matchingUnshieldEvent.railgunTxid !== railgunTxid) {
              matchingUnshieldEvent.railgunTxid = railgunTxid;
              // eslint-disable-next-line no-await-in-loop
              await utxoMerkletree.updateUnshieldEvent(matchingUnshieldEvent);

              this.invalidateTXOsCacheAllWallets(chain);
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
      }

      for (let i = 0; i < standardCommitments.length; i += 1) {
        const position = utxoBatchStartPositionOut + i;
        // eslint-disable-next-line no-await-in-loop
        const commitment = await utxoMerkletree.getCommitmentSafe(tree, position);
        if (isDefined(commitment)) {
          if (isTransactCommitment(commitment) && commitment.railgunTxid !== railgunTxid) {
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
          new Error(
            `Stopping queue of Railgun TXIDs - missing a commitment or unshield. This will occur whenever the TXIDs are further than the UTXOs data source.`,
          ),
        );
        break;
      }

      const expectedVerificationHash = calculateRailgunTransactionVerificationHash(
        previousVerificationHash,
        nullifiers[0],
      );

      if (expectedVerificationHash !== verificationHash) {
        EngineDebug.error(
          new Error(
            `Stopping queue of Railgun TXIDs - Invalid verification hash. This occurs very rarely during a chain re-org and will resolve itself in minutes.`,
          ),
        );
        // Clear 10 leaves to allow for re-org to resolve.
        const numLeavesToClear = 10;
        // eslint-disable-next-line no-await-in-loop
        await txidMerkletree.clearLeavesForInvalidVerificationHash(numLeavesToClear);
        break;
      }

      previousVerificationHash = expectedVerificationHash;

      toQueue.push(railgunTransactionWithTxid);

      // Only emit progress every 30 TXIDs.
      if (index % 30 === 0) {
        const progress = index / railgunTransactionsLength;
        emitNewRailgunTransactionsProgress(progress);
      }
    }

    await txidMerkletree.queueRailgunTransactions(toQueue, latestValidatedTxidIndex);
    await txidMerkletree.updateTreesFromWriteQueue();
  }

  private async handleNewRailgunTransactionsV3(
    txidVersion: TXIDVersion,
    chain: Chain,
    railgunTransactions: RailgunTransactionV3[],
  ) {
    const latestValidatedTxidIndex = await this.getLatestValidatedTxidIndex(txidVersion, chain);
    EngineDebug.log(
      `syncing railgun transactions to validated index: ${latestValidatedTxidIndex ?? 'NOT FOUND'}`,
    );

    const shouldAddNewRailgunTransactions = await this.shouldAddNewRailgunTransactions(
      txidVersion,
      chain,
      latestValidatedTxidIndex,
    );
    if (!shouldAddNewRailgunTransactions) {
      EngineDebug.log(
        `Skipping queue of Railgun TXIDs - already synced to validated index: ${
          latestValidatedTxidIndex ?? 0
        }`,
      );
      const scanCompleteData: MerkletreeHistoryScanEventData = {
        scanStatus: MerkletreeScanStatus.Complete,
        progress: 1,
        txidVersion,
        chain,
      };
      this.emit(EngineEvent.TXIDMerkletreeHistoryScanUpdate, scanCompleteData);
      return;
    }

    const txidMerkletree = this.getTXIDMerkletree(txidVersion, chain);

    const toQueue: RailgunTransactionWithHash[] = [];

    for (const railgunTransaction of railgunTransactions) {
      const railgunTransactionWithTxid = createRailgunTransactionWithHash(railgunTransaction);

      // TODO-V3: Calculate and verify verificationHash on RailgunTransactionV3.

      toQueue.push(railgunTransactionWithTxid);
    }

    await txidMerkletree.queueRailgunTransactions(toQueue, latestValidatedTxidIndex);
    await txidMerkletree.updateTreesFromWriteQueue();
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
  private async clearSyncedUTXOMerkletreeLeavesAllTXIDVersions(chain: Chain) {
    for (const txidVersion of Object.values(TXIDVersion)) {
      if (!getChainSupportsV3(chain) && txidVersion === TXIDVersion.V3_PoseidonMerkle) {
        continue;
      }

      const utxoMerkletree = this.getUTXOMerkletree(txidVersion, chain);
      // eslint-disable-next-line no-await-in-loop
      await utxoMerkletree.clearDataForMerkletree();
      // eslint-disable-next-line no-await-in-loop
      await this.db.clearNamespace(RailgunEngine.getLastSyncedBlockDBPrefix(txidVersion, chain));
    }
  }

  private async clearUTXOMerkletreeAndLoadedWalletsAllTXIDVersions(chain: Chain) {
    await this.clearSyncedUTXOMerkletreeLeavesAllTXIDVersions(chain);
    await Promise.all(
      this.allWallets().map((wallet) => wallet.clearDecryptedBalancesAllTXIDVersions(chain)),
    );
  }

  private async clearSyncedUnshieldEvents(txidVersion: TXIDVersion, chain: Chain) {
    const utxoMerkletree = this.getUTXOMerkletree(txidVersion, chain);
    await this.db.clearNamespace(
      // All Unshields
      utxoMerkletree.getUnshieldEventsDBPath(undefined, undefined, undefined),
    );
  }

  private async clearTXIDMerkletree(txidVersion: TXIDVersion, chain: Chain) {
    const txidMerkletree = this.getTXIDMerkletree(txidVersion, chain);
    await txidMerkletree.clearDataForMerkletree();
    txidMerkletree.savedPOILaunchSnapshot = false;
  }

  /**
   * Clears stored merkletree leaves and wallet balances, and re-scans fully.
   * @param chain - chain type/id to rescan
   * @param forceRescanDevOnly - can corrupt an existing scan, so only recommended in extreme cases (DEV only)
   */
  async fullRescanUTXOMerkletreesAndWallets(
    chain: Chain,
    walletIdFilter: Optional<string[]>,
    forceRescanDevOnly = false,
  ) {
    for (const txidVersion of ACTIVE_TXID_VERSIONS) {
      if (!getChainSupportsV3(chain) && txidVersion === TXIDVersion.V3_PoseidonMerkle) {
        continue;
      }

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

    for (const txidVersion of ACTIVE_TXID_VERSIONS) {
      if (!getChainSupportsV3(chain) && txidVersion === TXIDVersion.V3_PoseidonMerkle) {
        continue;
      }

      const utxoMerkletree = this.getUTXOMerkletree(txidVersion, chain);

      this.emitUTXOMerkletreeScanUpdateEvent(txidVersion, chain, 0.01); // 1%
      utxoMerkletree.isScanning = true; // Don't allow scans while removing leaves.
      // eslint-disable-next-line no-await-in-loop
      await this.clearUTXOMerkletreeAndLoadedWalletsAllTXIDVersions(chain);
      // eslint-disable-next-line no-await-in-loop
      await this.clearSyncedUnshieldEvents(txidVersion, chain);
      utxoMerkletree.isScanning = false; // Clear before calling scanHistory.

      if (txidVersion !== TXIDVersion.V2_PoseidonMerkle) {
        // Clear TXID data before syncing fresh from Event History (V3).
        // eslint-disable-next-line no-await-in-loop
        await this.clearTXIDMerkletreeData(txidVersion, chain);
      }

      // eslint-disable-next-line no-await-in-loop
      await this.scanUTXOHistory(txidVersion, chain, walletIdFilter);

      if (txidVersion === TXIDVersion.V2_PoseidonMerkle) {
        // Must reset txid merkletree which is mapped to UTXO commitments in V2.
        // eslint-disable-next-line no-await-in-loop
        await this.fullResetTXIDMerkletreesV2(chain);
      }
    }
  }

  async fullResetTXIDMerkletreesV2(chain: Chain): Promise<void> {
    const txidVersion = TXIDVersion.V2_PoseidonMerkle;

    if (!this.hasTXIDMerkletree(txidVersion, chain)) {
      return;
    }
    if (this.hasSyncedRailgunTransactionsV2.get(null, chain) !== true) {
      const err = new Error(
        `Cannot re-scan railgun txids. Must get UTXO history first. Please wait and try again.`,
      );
      EngineDebug.error(err);
      throw err;
    }

    await this.clearTXIDMerkletreeData(txidVersion, chain);
    await this.syncRailgunTransactionsV2(chain, 'full txid reset');
  }

  private async clearTXIDMerkletreeData(txidVersion: TXIDVersion, chain: Chain) {
    if (!getChainSupportsV3(chain) && txidVersion === TXIDVersion.V3_PoseidonMerkle) {
      return;
    }

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

    txidMerkletree.isScanning = true; // Don't allow scans while removing leaves.
    // eslint-disable-next-line no-await-in-loop
    await txidMerkletree.clearDataForMerkletree();
    txidMerkletree.savedPOILaunchSnapshot = false;
    txidMerkletree.isScanning = false; // Clear before calling syncRailgunTransactions.
    // eslint-disable-next-line no-await-in-loop

    if (txidVersion !== TXIDVersion.V2_PoseidonMerkle) {
      // For V3, clear the last-synced block to force a full quicksync scan.
      await this.db.clearNamespace(RailgunEngine.getLastSyncedBlockDBPrefix(txidVersion, chain));
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
    await this.syncRailgunTransactionsV2(chain, 'reset after txid index');
  }

  private static async validateMerkleroot(
    txidVersion: TXIDVersion,
    chain: Chain,
    tree: number,
    _index: number,
    merkleroot: string,
  ) {
    switch (txidVersion) {
      case TXIDVersion.V2_PoseidonMerkle:
        return ContractStore.railgunSmartWalletContracts
          .getOrThrow(null, chain)
          .validateMerkleroot(tree, merkleroot);

      case TXIDVersion.V3_PoseidonMerkle:
        return ContractStore.poseidonMerkleAccumulatorV3Contracts
          .getOrThrow(null, chain)
          .validateMerkleroot(tree, merkleroot);
    }
    return false;
  }

  /**
   * Load network
   * @param railgunSmartWalletContractAddress - address of railgun instance (proxy contract)
   * @param relayAdaptV2ContractAddress - address of railgun instance (proxy contract)
   * @param provider - ethers provider for network
   * @param deploymentBlock - block number to start scanning from
   */
  async loadNetwork(
    chain: Chain,
    railgunSmartWalletContractAddress: string,
    relayAdaptV2ContractAddress: string,
    poseidonMerkleAccumulatorV3Address: string,
    poseidonMerkleVerifierV3Address: string,
    tokenVaultV3Address: string,
    defaultProvider: PollingJsonRpcProvider | FallbackProvider,
    pollingProvider: PollingJsonRpcProvider,
    deploymentBlocks: Record<TXIDVersion, number>,
    poiLaunchBlock: Optional<number>,
    supportsV3: boolean,
  ) {
    EngineDebug.log(`loadNetwork: ${chain.type}:${chain.id}`);

    try {
      await promiseTimeout(
        defaultProvider.getBlockNumber(),
        60_000,
        'Timed out waiting for default RPC provider to connect.',
      );
    } catch (cause) {
      const err = new Error(
        'Failed to get block number from default provider when loading network',
        { cause },
      );
      EngineDebug.error(err);
      throw err;
    }

    assertIsPollingProvider(pollingProvider);
    try {
      await promiseTimeout(
        pollingProvider.getBlockNumber(),
        60_000,
        'Timed out waiting for polling RPC provider to connect.',
      );
    } catch (cause) {
      const err = new Error(
        'Failed to get block number from polling provider when loading network',
        {
          cause,
        },
      );
      EngineDebug.error(cause as Error);
      throw err;
    }

    if (supportsV3) {
      addChainSupportsV3(chain);
    }

    const hasAnyMerkletree = ACTIVE_TXID_VERSIONS.every(
      (txidVersion) =>
        !this.hasUTXOMerkletree(txidVersion, chain) && !this.hasTXIDMerkletree(txidVersion, chain),
    );
    const hasSmartWalletContract = ContractStore.railgunSmartWalletContracts.has(null, chain);
    const hasRelayAdaptV2Contract = ContractStore.relayAdaptV2Contracts.has(null, chain);
    const hasPoseidonMerkleAccumulatorV3Contract =
      ContractStore.poseidonMerkleAccumulatorV3Contracts.has(null, chain);
    const hasPoseidonMerkleVerifierV3Contract = ContractStore.poseidonMerkleVerifierV3Contracts.has(
      null,
      chain,
    );
    const hasTokenVaultV3Contract = ContractStore.tokenVaultV3Contracts.has(null, chain);
    if (
      hasAnyMerkletree ||
      hasSmartWalletContract ||
      hasRelayAdaptV2Contract ||
      hasPoseidonMerkleAccumulatorV3Contract ||
      hasPoseidonMerkleVerifierV3Contract ||
      hasTokenVaultV3Contract
    ) {
      // If a network with this chainID exists, unload it and load the provider as a new network
      await this.unloadNetwork(chain);
    }

    // Create contract instances
    ContractStore.railgunSmartWalletContracts.set(
      null,
      chain,
      new RailgunSmartWalletContract(
        railgunSmartWalletContractAddress,
        defaultProvider,
        pollingProvider,
        chain,
      ),
    );

    ContractStore.relayAdaptV2Contracts.set(
      null,
      chain,
      new RelayAdaptV2Contract(relayAdaptV2ContractAddress, defaultProvider),
    );

    if (supportsV3) {
      ContractStore.poseidonMerkleAccumulatorV3Contracts.set(
        null,
        chain,
        new PoseidonMerkleAccumulatorContract(
          poseidonMerkleAccumulatorV3Address,
          defaultProvider,
          pollingProvider,
          chain,
        ),
      );

      ContractStore.poseidonMerkleVerifierV3Contracts.set(
        null,
        chain,
        new PoseidonMerkleVerifierContract(poseidonMerkleVerifierV3Address, defaultProvider),
      );

      ContractStore.tokenVaultV3Contracts.set(
        null,
        chain,
        new TokenVaultContract(tokenVaultV3Address, defaultProvider),
      );
    }

    for (const txidVersion of ACTIVE_UTXO_MERKLETREE_TXID_VERSIONS) {
      // eslint-disable-next-line no-await-in-loop
      const utxoMerkletree = await UTXOMerkletree.create(
        this.db,
        chain,
        txidVersion,
        // eslint-disable-next-line @typescript-eslint/no-shadow
        (txidVersion, chain, tree, index, merkleroot) =>
          RailgunEngine.validateMerkleroot(txidVersion, chain, tree, index, merkleroot),
      );
      this.utxoMerkletrees.set(txidVersion, chain, utxoMerkletree);

      // Load utxo merkletree to all wallets
      // eslint-disable-next-line no-await-in-loop
      await Promise.all(
        Object.values(this.wallets).map(async (wallet) => {
          await wallet.loadUTXOMerkletree(txidVersion, utxoMerkletree);
        }),
      );

      let txidMerkletree: Optional<TXIDMerkletree>;

      if (isDefined(poiLaunchBlock) || supportsV3) {
        if (isDefined(poiLaunchBlock)) {
          POI.launchBlocks.set(null, chain, poiLaunchBlock);
        }

        if (this.isPOINode) {
          // POI Node Txid merkletree
          // eslint-disable-next-line no-await-in-loop
          txidMerkletree = await TXIDMerkletree.createForPOINode(this.db, chain, txidVersion);
          this.txidMerkletrees.set(txidVersion, chain, txidMerkletree);
        } else {
          // Wallet Txid merkletree

          // TODO-V3: If the poiLaunchBlock is newly set, old TXID merkletrees may not set the correct snapshot.
          // Make sure to clear the TXID merkletree when poiLaunchBlock is first set for this chain.
          // (Store the poiLaunchBlock in the TXID Merkletree db).

          const autoValidate = async () => true;

          // eslint-disable-next-line no-await-in-loop
          txidMerkletree = await TXIDMerkletree.createForWallet(
            this.db,
            chain,
            txidVersion,
            // For V3, we receive events in realtime, and validation is done via on-chain verificationHash field.
            supportsV3 ? autoValidate : this.validateRailgunTxidMerkleroot,
          );
          this.txidMerkletrees.set(txidVersion, chain, txidMerkletree);
        }

        if (isDefined(txidMerkletree)) {
          // Load txid merkletree to all wallets
          for (const wallet of Object.values(this.wallets)) {
            wallet.loadRailgunTXIDMerkletree(txidVersion, txidMerkletree);
          }
        }
      }

      this.deploymentBlocks.set(txidVersion, chain, deploymentBlocks[txidVersion]);
    }

    if (this.skipMerkletreeScans) {
      return;
    }

    // Set up listeners
    const commitmentListener = async (
      txidVersion: TXIDVersion,
      commitmentEvents: CommitmentEvent[],
    ) => {
      await this.commitmentListener(
        txidVersion,
        chain,
        commitmentEvents,
        true, // shouldUpdateTrees
        txidVersion === TXIDVersion.V2_PoseidonMerkle, // shouldTriggerV2TxidSync - only for live listener events on V2
      );
      // Only start wallet balance decryption if utxoMerkletree is not already scanning
      const utxoMerkletree = this.getUTXOMerkletree(txidVersion, chain);
      if (!utxoMerkletree.isScanning) {
        await this.decryptBalancesAllWallets(
          txidVersion,
          chain,
          undefined, // walletIdFilter
          undefined, // progressCallback
          false, // deferCompletionEvent
        );
      }
    };
    const nullifierListener = async (txidVersion: TXIDVersion, nullifiers: Nullifier[]) => {
      await this.nullifierListener(txidVersion, chain, nullifiers);
      // Only start wallet balance decryption if utxoMerkletree is not already scanning
      const utxoMerkletree = this.getUTXOMerkletree(txidVersion, chain);
      if (!utxoMerkletree.isScanning) {
        await this.decryptBalancesAllWallets(
          txidVersion,
          chain,
          undefined, // walletIdFilter
          undefined, // progressCallback
          false, // deferCompletionEvent
        );
      }
    };
    const unshieldListener = async (txidVersion: TXIDVersion, unshields: UnshieldStoredEvent[]) => {
      await this.unshieldListener(txidVersion, chain, unshields);
    };
    await ContractStore.railgunSmartWalletContracts
      .get(null, chain)
      ?.setTreeUpdateListeners(commitmentListener, nullifierListener, unshieldListener);

    if (supportsV3) {
      const railgunTransactionsV3Listener = async (
        txidVersion: TXIDVersion,
        railgunTransactions: RailgunTransactionV3[],
      ) => {
        await this.railgunTransactionsV3Listener(txidVersion, chain, railgunTransactions);
      };
      const commitmentListenerV3 = async (
        txidVersion: TXIDVersion,
        commitmentEvents: CommitmentEvent[],
      ) => {
        await this.commitmentListener(
          txidVersion,
          chain,
          commitmentEvents,
          true, // shouldUpdateTrees
          txidVersion === TXIDVersion.V2_PoseidonMerkle, // shouldTriggerV2TxidSync - only for live listener events on V2
        );
      };
      const nullifierListenerV3 = async (txidVersion: TXIDVersion, nullifiers: Nullifier[]) => {
        await this.nullifierListener(txidVersion, chain, nullifiers);
      };
      const triggerWalletBalanceDecryptions = async (txidVersion: TXIDVersion) => {
        const utxoMerkletree = this.getUTXOMerkletree(txidVersion, chain);
        if (!utxoMerkletree.isScanning) {
          await this.decryptBalancesAllWallets(
            txidVersion,
            chain,
            undefined, // walletIdFilter
            undefined, // progressCallback
            false, // deferCompletionEvent
          );
        }
      };
      await ContractStore.poseidonMerkleAccumulatorV3Contracts
        .get(null, chain)
        ?.setTreeUpdateListeners(
          commitmentListenerV3, // No wallet scans
          nullifierListenerV3, // No wallet scans
          unshieldListener,
          railgunTransactionsV3Listener,
          triggerWalletBalanceDecryptions,
        );
    }
  }

  /**
   * Unload network
   * @param chain - chainID of network to unload
   */
  private async unloadNetwork(chain: Chain): Promise<void> {
    if (ContractStore.railgunSmartWalletContracts.has(null, chain)) {
      return;
    }

    // Unload merkletrees from wallets
    for (const wallet of Object.values(this.wallets)) {
      for (const txidVersion of ACTIVE_TXID_VERSIONS) {
        if (!getChainSupportsV3(chain) && txidVersion === TXIDVersion.V3_PoseidonMerkle) {
          continue;
        }

        wallet.unloadUTXOMerkletree(txidVersion, chain);
        wallet.unloadRailgunTXIDMerkletree(txidVersion, chain);
      }
    }

    // Unload listeners
    await ContractStore.railgunSmartWalletContracts.get(null, chain)?.unload();
    await ContractStore.poseidonMerkleAccumulatorV3Contracts.get(null, chain)?.unload();

    // Delete contracts
    ContractStore.railgunSmartWalletContracts.del(null, chain);
    ContractStore.relayAdaptV2Contracts.del(null, chain);
    ContractStore.poseidonMerkleAccumulatorV3Contracts.del(null, chain);
    ContractStore.poseidonMerkleVerifierV3Contracts.del(null, chain);
    ContractStore.tokenVaultV3Contracts.del(null, chain);

    for (const txidVersion of ACTIVE_TXID_VERSIONS) {
      if (!getChainSupportsV3(chain) && txidVersion === TXIDVersion.V3_PoseidonMerkle) {
        continue;
      }

      this.utxoMerkletrees.del(txidVersion, chain);
      this.txidMerkletrees.del(txidVersion, chain);
    }
  }

  private static getLastSyncedBlockDBPrefix(txidVersion: TXIDVersion, chain: Chain): string[] {
    const path = [
      DatabaseNamespace.ChainSyncInfo,
      'last_synced_block',
      txidVersion,
      getChainFullNetworkID(chain),
    ];
    return path;
  }

  /**
   * Sets last synced block to resume syncing on next load.
   * @param chain - chain type/id to store value for
   * @param lastSyncedBlock - last synced block
   */
  private setLastSyncedBlock(
    txidVersion: TXIDVersion,
    chain: Chain,
    lastSyncedBlock: number,
  ): Promise<void> {
    return this.db.put(
      RailgunEngine.getLastSyncedBlockDBPrefix(txidVersion, chain),
      lastSyncedBlock,
      'utf8',
    );
  }

  /**
   * Gets last synced block to resume syncing from.
   * @param chain - chain type/id to get value for
   * @returns lastSyncedBlock - last synced block
   */
  private getLastSyncedBlock(txidVersion: TXIDVersion, chain: Chain): Promise<Optional<number>> {
    return this.db
      .get(RailgunEngine.getLastSyncedBlockDBPrefix(txidVersion, chain), 'utf8')
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

  private static getTxidV2MerkletreeHistoryVersionDBPrefix(chain?: Chain): string[] {
    const path = [DatabaseNamespace.ChainSyncInfo, 'txid_merkletree_history_version'];
    if (chain != null) {
      path.push(getChainFullNetworkID(chain));
    }
    return path;
  }

  private setUTXOMerkletreeHistoryVersion(
    chain: Chain,
    merkletreeHistoryVersion: number,
  ): Promise<void> {
    return this.db.put(
      RailgunEngine.getUTXOMerkletreeHistoryVersionDBPrefix(chain),
      merkletreeHistoryVersion,
      'utf8',
    );
  }

  private getUTXOMerkletreeHistoryVersion(chain: Chain): Promise<Optional<number>> {
    return this.db
      .get(RailgunEngine.getUTXOMerkletreeHistoryVersionDBPrefix(chain), 'utf8')
      .then((val: string) => parseInt(val, 10))
      .catch(() => Promise.resolve(undefined));
  }

  private setTxidV2MerkletreeHistoryVersion(
    chain: Chain,
    merkletreeHistoryVersion: number,
  ): Promise<void> {
    return this.db.put(
      RailgunEngine.getTxidV2MerkletreeHistoryVersionDBPrefix(chain),
      merkletreeHistoryVersion,
      'utf8',
    );
  }

  private getTxidV2MerkletreeHistoryVersion(chain: Chain): Promise<Optional<number>> {
    return this.db
      .get(RailgunEngine.getTxidV2MerkletreeHistoryVersionDBPrefix(chain), 'utf8')
      .then((val: string) => parseInt(val, 10))
      .catch(() => Promise.resolve(undefined));
  }

  getUTXOMerkletree(txidVersion: TXIDVersion, chain: Chain): UTXOMerkletree {
    if (txidVersion === TXIDVersion.V3_PoseidonMerkle) {
      assertChainSupportsV3(chain);
    }
    const merkletree = this.utxoMerkletrees.get(txidVersion, chain);
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
    if (txidVersion === TXIDVersion.V3_PoseidonMerkle) {
      assertChainSupportsV3(chain);
    }
    const merkletree = this.txidMerkletrees.get(txidVersion, chain);
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
    return allMatch
      ? ByteUtils.formatToByteLength(firstTxid, ByteLength.UINT_256, true)
      : undefined;
  }

  private async decryptBalancesAllWallets(
    txidVersion: TXIDVersion,
    chain: Chain,
    walletIdFilter: Optional<string[]>,
    progressCallback: Optional<(progress: number) => void>,
    deferCompletionEvent: boolean,
  ) {
    const wallets = this.allWallets();
    for (let i = 0; i < wallets.length; i += 1) {
      if (isDefined(walletIdFilter) && !walletIdFilter.includes(wallets[i].id)) {
        // Skip wallets not in filter
        continue;
      }

      // eslint-disable-next-line no-await-in-loop
      await wallets[i].decryptBalances(
        txidVersion,
        chain,
        (walletProgress: number) => {
          if (progressCallback) {
            const finishedWalletsProgress = i / wallets.length;
            const newWalletProgress = walletProgress / wallets.length;
            progressCallback(finishedWalletsProgress + newWalletProgress);
          }
        },
        deferCompletionEvent,
      );
    }
  }

  private invalidateTXOsCacheAllWallets(chain: Chain) {
    const wallets = this.allWallets();
    for (const wallet of wallets) {
      wallet.invalidateCommitmentsCache(chain);
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
      ContractStore.railgunSmartWalletContracts.map(async (contract, txidVersion, chain) => {
        EngineDebug.log(`unload network ${chain.type}:${chain.id}`);
        await this.unloadNetwork(chain);
      }),
    );

    // Unload wallets
    for (const walletID of Object.keys(this.wallets)) {
      this.unloadWallet(walletID);
    }

    await this.db.close();
  }

  private async loadWallet(wallet: AbstractWallet): Promise<void> {
    // Store wallet against ID
    this.wallets[wallet.id] = wallet;

    if (this.skipMerkletreeScans) {
      throw new Error(
        'Cannot load wallet: skipMerkletreeScans set to true. Wallets require merkle scans to load balances and history.',
      );
    }

    for (const txidVersion of ACTIVE_TXID_VERSIONS) {
      // Load UTXO and TXID merkletrees for wallet
      // eslint-disable-next-line no-await-in-loop
      await Promise.all(
        this.utxoMerkletrees.map(async (utxoMerkletree, thisTxidVersion) => {
          if (thisTxidVersion === txidVersion) {
            await wallet.loadUTXOMerkletree(txidVersion, utxoMerkletree);
          }
        }),
      );
      this.txidMerkletrees.forEach((txidMerkletree, thisTxidVersion) => {
        if (thisTxidVersion === txidVersion) {
          wallet.loadRailgunTXIDMerkletree(txidVersion, txidMerkletree);
        }
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
    await this.loadWallet(wallet);
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
    await this.loadWallet(wallet);
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
    await this.loadWallet(wallet);
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
    await this.loadWallet(wallet);
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

    // const treeInfo = await AbstractWallet.getCreationTreeAndPosition(
    //   merkletree,
    //   latestTree,
    //   startingBlock,
    // );

    const shieldCommitments: (ShieldCommitment | LegacyGeneratedCommitment)[] = [];

    const startScanTree = 0;

    for (let treeIndex = startScanTree; treeIndex <= latestTree; treeIndex += 1) {
      // eslint-disable-next-line no-await-in-loop
      const treeHeight = await utxoMerkletree.getTreeLength(treeIndex);

      // const isInitialTree = treeIndex === startScanTree;
      // const startScanHeight = isInitialTree && treeInfo ? treeInfo.position : 0;
      const startScanHeight = 0;

      // eslint-disable-next-line no-await-in-loop
      const leaves = await utxoMerkletree.getCommitmentRange(
        treeIndex,
        startScanHeight,
        treeHeight - 1,
      );

      for (const leaf of leaves) {
        if (!isDefined(leaf)) {
          continue;
        }
        if (leaf.blockNumber < startingBlock) {
          continue;
        }
        if (
          leaf.commitmentType === CommitmentType.LegacyGeneratedCommitment ||
          leaf.commitmentType === CommitmentType.ShieldCommitment
        ) {
          shieldCommitments.push(leaf);
        }
      }
    }

    return shieldCommitments;
  }

  // Top-level exports:

  static encodeAddress = encodeAddress;

  static decodeAddress = decodeAddress;

  railgunSmartWalletContracts = ContractStore.railgunSmartWalletContracts;

  relayAdaptV2Contracts = ContractStore.relayAdaptV2Contracts;
}

export { RailgunEngine };
