import {
  Contract,
  ContractEventPayload,
  ContractTransaction,
  FallbackProvider,
  Interface,
  Result,
} from 'ethers';
import EventEmitter from 'events';
import EngineDebug from '../../debugger/debugger';
import {
  EventsCommitmentListener,
  EventsNullifierListener,
  EventsUnshieldListener,
  EngineEvent,
} from '../../models/event-types';
import { ByteLength, formatToByteLength, hexlify } from '../../utils/bytes';
import { promiseTimeout } from '../../utils/promises';
import { ABIRailgunSmartWallet } from '../../abi/abi';
import {
  formatNullifiedEvents,
  formatShieldEvent,
  formatTransactEvent,
  formatUnshieldEvent,
  processNullifiedEvents,
  processShieldEvents,
  processShieldEvents_LegacyShield_PreMar23,
  processTransactEvents,
  processUnshieldEvents,
} from './events';
import {
  processLegacyCommitmentBatchEvents,
  processLegacyGeneratedCommitmentEvents,
  processLegacyNullifierEvents,
} from './legacy-events/legacy-events';
import { RailgunLogic_LegacyEvents } from '../../abi/typechain/RailgunLogic_LegacyEvents';
import {
  CommitmentCiphertextStructOutput,
  CommitmentPreimageStruct,
  CommitmentPreimageStructOutput,
  NullifiedEvent,
  ShieldCiphertextStructOutput,
  ShieldEvent,
  ShieldRequestStruct,
  TokenDataStructOutput,
  TransactEvent,
  TransactionStruct,
  UnshieldEvent,
  RailgunSmartWallet,
} from '../../abi/typechain/RailgunSmartWallet';
import {
  ENGINE_V2_START_BLOCK_NUMBERS_EVM,
  ENGINE_V2_SHIELD_EVENT_UPDATE_03_09_23_BLOCK_NUMBERS_EVM,
} from '../../utils/constants';
import { Chain, ChainType } from '../../models/engine-types';
import {
  TypedContractEvent,
  TypedDeferredTopicFilter,
  TypedEventLog,
} from '../../abi/typechain/common';
import { ABIRailgunSmartWallet_Legacy_PreMar23 } from '../../abi/legacy/abi-legacy';
import { PollingJsonRpcProvider } from '../../provider/polling-json-rpc-provider';
import { assertIsPollingProvider } from '../../provider/polling-util';
import { ShieldEvent as ShieldEvent_LegacyShield_PreMar23 } from '../../abi/typechain/RailgunSmartWallet_Legacy_PreMar23';
import { TXIDVersion } from '../../models/poi-types';

const SCAN_CHUNKS = 499;
const MAX_SCAN_RETRIES = 30;
const EVENTS_SCAN_TIMEOUT = 5000;
const SCAN_TIMEOUT_ERROR_MESSAGE = 'getLogs request timed out after 5 seconds.';

class RailgunSmartWalletContract extends EventEmitter {
  readonly contract: RailgunSmartWallet;

  readonly contractForListeners: RailgunSmartWallet;

  readonly address: string;

  readonly chain: Chain;

  /**
   * Connect to Railgun instance on network
   * @param railgunSmartWalletContractAddress - address of Railgun instance (Proxy contract)
   * @param provider - Network provider
   */
  constructor(
    railgunSmartWalletContractAddress: string,
    defaultProvider: PollingJsonRpcProvider | FallbackProvider,
    pollingProvider: PollingJsonRpcProvider,
    chain: Chain,
  ) {
    super();
    this.address = railgunSmartWalletContractAddress;
    this.contract = new Contract(
      railgunSmartWalletContractAddress,
      ABIRailgunSmartWallet,
      defaultProvider,
    ) as unknown as RailgunSmartWallet;

    // Because of a 'stallTimeout' bug in Ethers v6, all providers in a FallbackProvider will get called simultaneously.
    // So, we'll use a single json rpc (the first in the FallbackProvider) to poll for the event listeners.
    assertIsPollingProvider(pollingProvider);
    this.contractForListeners = new Contract(
      railgunSmartWalletContractAddress,
      ABIRailgunSmartWallet,
      pollingProvider,
    ) as unknown as RailgunSmartWallet;

    this.chain = chain;
  }

  /**
   * Get current merkle root
   * @returns merkle root
   */
  async merkleRoot(): Promise<string> {
    return hexlify(await this.contract.merkleRoot());
  }

  /**
   * Gets transaction fees
   * Shield and unshield fees are in basis points, NFT is in wei.
   */
  async fees(): Promise<{
    shield: bigint;
    unshield: bigint;
    nft: bigint;
  }> {
    const [shieldFee, unshieldFee, nftFee] = await Promise.all([
      this.contract.shieldFee(),
      this.contract.unshieldFee(),
      this.contract.nftFee(),
    ]);
    return {
      shield: shieldFee,
      unshield: unshieldFee,
      nft: nftFee,
    };
  }

  /**
   * Validate root
   * @param root - root to validate
   * @returns isValid
   */
  validateMerkleroot(tree: number, root: string): Promise<boolean> {
    try {
      // Return result of root history lookup
      return this.contract.rootHistory(tree, hexlify(root, true));
    } catch (err) {
      EngineDebug.error(err as Error);
      throw err;
    }
  }

  /**
   * Get NFT token data from tokenHash.
   * @param tokenHash - tokenHash
   * @returns token data
   */
  getNFTTokenData(tokenHash: string): Promise<TokenDataStructOutput> {
    try {
      const formattedTokenHash = formatToByteLength(tokenHash, ByteLength.UINT_256, true);
      return this.contract.tokenIDMapping(formattedTokenHash);
    } catch (err) {
      EngineDebug.error(err as Error);
      throw err;
    }
  }

  private static recursivelyDecodeResult = (result: Result): any => {
    if (typeof result !== 'object') {
      // End (primitive) value
      return result;
    }
    try {
      const obj = result.toObject();
      if ('_' in obj) {
        throw new Error('Decode as array, not object');
      }
      Object.keys(obj).forEach((key) => {
        obj[key] = RailgunSmartWalletContract.recursivelyDecodeResult(obj[key]);
      });
      return obj;
    } catch (err) {
      // Result is array.
      return result
        .toArray()
        .map((item) => RailgunSmartWalletContract.recursivelyDecodeResult(item as Result));
    }
  };

  private async handleNullifiedEvent(
    event: ContractEventPayload,
    eventsNullifierListener: EventsNullifierListener,
  ): Promise<void> {
    const { treeNumber, nullifier } = event.args.toObject() as NullifiedEvent.OutputObject;

    const nullifierDecoded: string[] = RailgunSmartWalletContract.recursivelyDecodeResult(
      nullifier as Result,
    );

    const args: NullifiedEvent.OutputObject = {
      treeNumber,
      nullifier: nullifierDecoded,
    };
    const nullifiers = formatNullifiedEvents(
      args,
      event.log.transactionHash,
      event.log.blockNumber,
    );
    await eventsNullifierListener(TXIDVersion.V2_PoseidonMerkle, nullifiers);
    this.emit(EngineEvent.ContractNullifierReceived, nullifiers);
  }

  private static async handleShieldEvent(
    event: ContractEventPayload,
    eventsCommitmentListener: EventsCommitmentListener,
  ) {
    const { treeNumber, startPosition, commitments, shieldCiphertext, fees } =
      event.args.toObject() as ShieldEvent.OutputObject;

    const commitmentsDecoded: CommitmentPreimageStructOutput[] =
      RailgunSmartWalletContract.recursivelyDecodeResult(commitments as Result);
    const shieldCiphertextDecoded: ShieldCiphertextStructOutput[] =
      RailgunSmartWalletContract.recursivelyDecodeResult(shieldCiphertext as Result);
    const feesDecoded: bigint[] = RailgunSmartWalletContract.recursivelyDecodeResult(
      fees as Result,
    );

    const args: ShieldEvent.OutputObject = {
      treeNumber,
      startPosition,
      commitments: commitmentsDecoded,
      shieldCiphertext: shieldCiphertextDecoded,
      fees: feesDecoded,
    };
    const shieldEvent = formatShieldEvent(
      args,
      event.log.transactionHash,
      event.log.blockNumber,
      args.fees,
    );
    await eventsCommitmentListener(TXIDVersion.V2_PoseidonMerkle, shieldEvent);
  }

  private static async handleTransactEvent(
    event: ContractEventPayload,
    eventsCommitmentListener: EventsCommitmentListener,
  ) {
    const { treeNumber, startPosition, hash, ciphertext } =
      event.args.toObject() as TransactEvent.OutputObject;

    const hashDecoded: string[] = RailgunSmartWalletContract.recursivelyDecodeResult(
      hash as Result,
    );
    const ciphertextDecoded: CommitmentCiphertextStructOutput[] =
      RailgunSmartWalletContract.recursivelyDecodeResult(ciphertext as Result);

    const args: TransactEvent.OutputObject = {
      treeNumber,
      startPosition,
      hash: hashDecoded,
      ciphertext: ciphertextDecoded,
    };
    const transactEvent = formatTransactEvent(
      args,
      event.log.transactionHash,
      event.log.blockNumber,
    );
    await eventsCommitmentListener(TXIDVersion.V2_PoseidonMerkle, transactEvent);
  }

  private static async handleUnshieldEvent(
    event: ContractEventPayload,
    eventsUnshieldListener: EventsUnshieldListener,
  ) {
    const { to, token, amount, fee } = event.args.toObject() as UnshieldEvent.OutputObject;

    const tokenDecoded: TokenDataStructOutput = RailgunSmartWalletContract.recursivelyDecodeResult(
      token as unknown as Result,
    );

    const args: UnshieldEvent.OutputObject = {
      to,
      token: tokenDecoded,
      amount,
      fee,
    };
    const unshieldEvent = formatUnshieldEvent(
      args,
      event.log.transactionHash,
      event.log.blockNumber,
      event.log.index,
    );
    await eventsUnshieldListener(TXIDVersion.V2_PoseidonMerkle, [unshieldEvent]);
  }

  /**
   * Listens for tree update events
   * @param eventsCommitmentListener - commitment listener callback
   * @param eventsNullifierListener - nullifier listener callback
   * @param eventsUnshieldListener - unshield listener callback
   */
  async setTreeUpdateListeners(
    eventsCommitmentListener: EventsCommitmentListener,
    eventsNullifierListener: EventsNullifierListener,
    eventsUnshieldListener: EventsUnshieldListener,
  ): Promise<void> {
    const nullifiedTopic = this.contract.getEvent('Nullified').getFragment().topicHash;
    const shieldTopic = this.contract.getEvent('Shield').getFragment().topicHash;
    const transactTopic = this.contract.getEvent('Transact').getFragment().topicHash;
    const unshieldTopic = this.contract.getEvent('Unshield').getFragment().topicHash;

    await this.contractForListeners.on(
      // @ts-expect-error - Use * to request all events
      '*', // All Events
      (event: ContractEventPayload) => {
        try {
          if (event.log.topics.length !== 1) {
            throw new Error('Requires one topic for railgun events');
          }

          switch (event.log.topics[0]) {
            case nullifiedTopic:
              // eslint-disable-next-line @typescript-eslint/no-floating-promises
              this.handleNullifiedEvent(event, eventsNullifierListener);
              return;
            case shieldTopic:
              // eslint-disable-next-line @typescript-eslint/no-floating-promises
              RailgunSmartWalletContract.handleShieldEvent(event, eventsCommitmentListener);
              return;
            case transactTopic:
              // eslint-disable-next-line @typescript-eslint/no-floating-promises
              RailgunSmartWalletContract.handleTransactEvent(event, eventsCommitmentListener);
              return;
            case unshieldTopic:
              // eslint-disable-next-line @typescript-eslint/no-floating-promises
              RailgunSmartWalletContract.handleUnshieldEvent(event, eventsUnshieldListener);
              return;
          }

          throw new Error('Event topic not recognized');
        } catch (err) {
          if (err instanceof Error) {
            EngineDebug.error(err);
          }
          if (EngineDebug.isTestRun()) {
            throw err;
          }
        }
      },
    );
  }

  private async scanAllEvents(
    startBlock: number,
    endBlock: number,
    retryCount = 0,
  ): Promise<TypedEventLog<TypedContractEvent<any, any, any>>[]> {
    try {
      const events = await promiseTimeout(
        // @ts-expect-error - Use * to request all events
        this.contract.queryFilter('*', startBlock, endBlock),
        EVENTS_SCAN_TIMEOUT,
        SCAN_TIMEOUT_ERROR_MESSAGE,
      );
      const eventsWithDecodedArgs = events.map((event) => ({
        ...event,
        args: RailgunSmartWalletContract.recursivelyDecodeResult(event.args),
      }));
      return eventsWithDecodedArgs;
    } catch (err) {
      if (!(err instanceof Error)) {
        throw err;
      }
      if (retryCount < MAX_SCAN_RETRIES && err.message === SCAN_TIMEOUT_ERROR_MESSAGE) {
        const retry = retryCount + 1;
        EngineDebug.log(
          `[Chain ${this.chain.type}:${
            this.chain.id
          }]: Scan query error at block ${startBlock}. Retrying ${MAX_SCAN_RETRIES - retry} times.`,
        );
        EngineDebug.error(err);
        return this.scanAllEvents(startBlock, endBlock, retry);
      }
      EngineDebug.log(
        `[Chain ${this.chain.type}:${this.chain.id}]: Scan failed at block ${startBlock}. No longer retrying.`,
      );
      EngineDebug.error(err);
      throw err;
    }
  }

  static getEngineV2StartBlockNumber(chain: Chain) {
    if (chain.type === ChainType.EVM) {
      return ENGINE_V2_START_BLOCK_NUMBERS_EVM[chain.id] || 0;
    }
    return 0;
  }

  private static getEngineV2ShieldEventUpdate030923BlockNumber(chain: Chain) {
    if (chain.type === ChainType.EVM) {
      return ENGINE_V2_SHIELD_EVENT_UPDATE_03_09_23_BLOCK_NUMBERS_EVM[chain.id] || 0;
    }
    return 0;
  }

  private static getShieldPreMar23EventFilter(): TypedDeferredTopicFilter<ShieldEvent_LegacyShield_PreMar23.Event> {
    // Cannot use `this.contract`, because the "Shield" named event has changed. (It has a different topic).
    const ifaceLegacyShieldPreMar23 = new Interface(
      ABIRailgunSmartWallet_Legacy_PreMar23.filter((fragment) => fragment.type === 'event'),
    );
    const shieldPreMar23EventFragment = ifaceLegacyShieldPreMar23.getEvent('Shield');
    if (!shieldPreMar23EventFragment) {
      throw new Error('Requires shield event fragment - Legacy, pre mar 23');
    }
    const legacyPreMar23EventFilterShield: TypedDeferredTopicFilter<TypedContractEvent> = {
      getTopicFilter: async () => ifaceLegacyShieldPreMar23.encodeFilterTopics('Shield', []),
      fragment: shieldPreMar23EventFragment,
    };
    return legacyPreMar23EventFilterShield;
  }

  private static filterEventsByTopic<Event extends TypedContractEvent>(
    events: TypedEventLog<TypedContractEvent>[],
    eventFilter: TypedDeferredTopicFilter<Event>,
  ): TypedEventLog<Event>[] {
    return events.filter(
      (event) => event.topics.length === 1 && eventFilter.fragment.topicHash === event.topics[0],
    );
  }

  /**
   * Gets historical events from block
   * @param startBlock - block to scan from
   * @param latestBlock - block to scan to
   */
  async getHistoricalEvents(
    chain: Chain,
    initialStartBlock: number,
    latestBlock: number,
    getNextStartBlockFromValidMerkletree: () => Promise<number>,
    eventsListener: EventsCommitmentListener,
    eventsNullifierListener: EventsNullifierListener,
    eventsUnshieldListener: EventsUnshieldListener,
    setLastSyncedBlock: (lastSyncedBlock: number) => Promise<void>,
  ) {
    const engineV3StartBlockNumber = RailgunSmartWalletContract.getEngineV2StartBlockNumber(chain);
    const engineV3ShieldEventUpdate030923BlockNumber =
      RailgunSmartWalletContract.getEngineV2ShieldEventUpdate030923BlockNumber(chain);

    // TODO: Possible data integrity issue in using commitment block numbers.
    // Unshields and Nullifiers are scanned from the latest commitment block.
    // Unshields/Nullifiers are not validated using the same merkleroot validation.
    // If we miss an unshield/nullifier for some reason, we won't pick it up .
    // For missed unshields, this will affect the way transaction history is displayed (no balance impact).
    // For missed nullifiers, this will incorrectly show a balance for a spent note.
    let currentStartBlock = initialStartBlock;

    const txidVersion = TXIDVersion.V2_PoseidonMerkle;

    // Current live events - post v3 update
    const eventFilterNullified = this.contract.filters.Nullified();
    const eventFilterTransact = this.contract.filters.Transact();
    const eventFilterUnshield = this.contract.filters.Unshield();

    // Current live Shield - Mar 2023
    const eventFilterShield = this.contract.filters.Shield();

    // This type includes legacy event types and filters, from before the v3 update.
    // We need to scan prior commitments from these past events, before engineV3StartBlockNumber.
    const legacyEventsContract = this.contract as unknown as RailgunLogic_LegacyEvents;
    const legacyEventFilterNullifiers = legacyEventsContract.filters.Nullifiers();
    const legacyEventFilterGeneratedCommitmentBatch =
      legacyEventsContract.filters.GeneratedCommitmentBatch();
    const legacyEventFilterEncryptedCommitmentBatch =
      legacyEventsContract.filters.CommitmentBatch();

    // This type includes legacy Shield event types and filters, from before the Mar 2023 update.
    const legacyPreMar23EventFilterShield =
      RailgunSmartWalletContract.getShieldPreMar23EventFilter();

    EngineDebug.log(
      `[Chain ${this.chain.type}:${this.chain.id}]: Scanning historical events from block ${currentStartBlock} to ${latestBlock}`,
    );

    let startBlockForNext10000 = initialStartBlock;

    while (currentStartBlock < latestBlock) {
      // Process chunks of blocks for all events, serially.

      const endBlock = Math.min(latestBlock, currentStartBlock + SCAN_CHUNKS);
      const withinLegacyEventRange = currentStartBlock <= engineV3StartBlockNumber;
      const withinV3EventRange = endBlock >= engineV3StartBlockNumber;
      const withinLegacyV3ShieldEventRange =
        currentStartBlock <= engineV3ShieldEventUpdate030923BlockNumber;
      const withinNewV3ShieldEventRange = endBlock >= engineV3ShieldEventUpdate030923BlockNumber;
      if (withinLegacyEventRange && withinV3EventRange) {
        EngineDebug.log(
          `[Chain ${this.chain.type}:${this.chain.id}]: Changing from legacy events to new events...`,
        );
      }

      if ((currentStartBlock - startBlockForNext10000) % 10000 === 0) {
        EngineDebug.log(
          `[Chain ${this.chain.type}:${this.chain.id}]: Scanning next 10,000 events (${
            withinLegacyEventRange ? 'legacy' : 'v3'
          }) [${currentStartBlock}]...`,
        );
      }

      // eslint-disable-next-line no-await-in-loop
      const allEvents = await this.scanAllEvents(currentStartBlock, endBlock);

      if (withinV3EventRange) {
        if (withinLegacyV3ShieldEventRange) {
          // Legacy V3 Shield Event - Pre March 2023.
          const eventsShieldLegacyV3 = RailgunSmartWalletContract.filterEventsByTopic(
            allEvents,
            legacyPreMar23EventFilterShield,
          );
          // eslint-disable-next-line no-await-in-loop
          await processShieldEvents_LegacyShield_PreMar23(
            txidVersion,
            eventsListener,
            eventsShieldLegacyV3,
          );
        }
        if (withinNewV3ShieldEventRange) {
          // New V3 Shield Event - After March 2023.
          const eventsShield = RailgunSmartWalletContract.filterEventsByTopic(
            allEvents,
            eventFilterShield,
          );
          // eslint-disable-next-line no-await-in-loop
          await processShieldEvents(txidVersion, eventsListener, eventsShield);
        }

        const eventsNullifiers = RailgunSmartWalletContract.filterEventsByTopic(
          allEvents,
          eventFilterNullified,
        );
        const eventsTransact = RailgunSmartWalletContract.filterEventsByTopic(
          allEvents,
          eventFilterTransact,
        );
        const eventsUnshield = RailgunSmartWalletContract.filterEventsByTopic(
          allEvents,
          eventFilterUnshield,
        );

        // eslint-disable-next-line no-await-in-loop
        await Promise.all([
          processNullifiedEvents(txidVersion, eventsNullifierListener, eventsNullifiers),
          processUnshieldEvents(txidVersion, eventsUnshieldListener, eventsUnshield),
          processTransactEvents(txidVersion, eventsListener, eventsTransact),
        ]);
      }

      if (withinLegacyEventRange) {
        const legacyEventsNullifiers = RailgunSmartWalletContract.filterEventsByTopic(
          allEvents,
          legacyEventFilterNullifiers,
        );
        const legacyEventsGeneratedCommitmentBatch = RailgunSmartWalletContract.filterEventsByTopic(
          allEvents,
          legacyEventFilterGeneratedCommitmentBatch,
        );
        const legacyEventsEncryptedCommitmentBatch = RailgunSmartWalletContract.filterEventsByTopic(
          allEvents,
          legacyEventFilterEncryptedCommitmentBatch,
        );

        // eslint-disable-next-line no-await-in-loop
        await Promise.all([
          processLegacyNullifierEvents(
            txidVersion,
            eventsNullifierListener,
            legacyEventsNullifiers,
          ),
          processLegacyGeneratedCommitmentEvents(
            txidVersion,
            eventsListener,
            legacyEventsGeneratedCommitmentBatch,
          ),
          processLegacyCommitmentBatchEvents(
            txidVersion,
            eventsListener,
            legacyEventsEncryptedCommitmentBatch,
          ),
        ]);
      }

      // eslint-disable-next-line no-await-in-loop
      await setLastSyncedBlock(endBlock);

      const nextStartBlockFromCurrentBlock = currentStartBlock + SCAN_CHUNKS + 1;
      const nextStartBlockFromLatestValidMerkletreeEntry =
        // eslint-disable-next-line no-await-in-loop
        await getNextStartBlockFromValidMerkletree();

      // Choose greater of:
      // 1. currentStartBlock + scan chunk size
      // 2. Latest verified merkletree block
      // This optimizes the slow scan in case quicksync returns a single invalid merkleroot for a given block.
      // The other data is queued for merkletree, and will validate and enter the merkletree, providing a new starting block.
      // This skips slow scan for those intermediary blocks.
      if (nextStartBlockFromLatestValidMerkletreeEntry > nextStartBlockFromCurrentBlock) {
        currentStartBlock = nextStartBlockFromLatestValidMerkletreeEntry;
        startBlockForNext10000 = nextStartBlockFromLatestValidMerkletreeEntry;
        EngineDebug.log(
          `[Chain ${this.chain.type}:${this.chain.id}]: Skipping ${
            nextStartBlockFromCurrentBlock - nextStartBlockFromLatestValidMerkletreeEntry
          } already processed/validated blocks from QuickSync...`,
        );
      } else {
        currentStartBlock = nextStartBlockFromCurrentBlock;
      }
    }

    EngineDebug.log(`[Chain ${this.chain.type}:${this.chain.id}]: Finished historical event scan`);
  }

  /**
   * GenerateShield populated transaction
   * @returns Populated transaction
   */
  generateShield(shieldRequests: ShieldRequestStruct[]): Promise<ContractTransaction> {
    return this.contract.shield.populateTransaction(shieldRequests);
  }

  /**
   * Create transaction call for ETH
   * @param transactions - serialized railgun transaction
   * @returns - populated ETH transaction
   */
  transact(transactions: TransactionStruct[]): Promise<ContractTransaction> {
    return this.contract.transact.populateTransaction(transactions);
  }

  async hashCommitment(commitment: CommitmentPreimageStruct): Promise<string> {
    return this.contract.hashCommitment({
      ...commitment,
      npk: formatToByteLength(commitment.npk, ByteLength.UINT_256, true),
    });
  }

  /**
   * Remove all listeners and shutdown contract instance
   */
  async unload() {
    await this.contract.removeAllListeners();
    await this.contractForListeners?.removeAllListeners();
  }
}

export { RailgunSmartWalletContract };
