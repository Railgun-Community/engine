import type { Provider } from '@ethersproject/abstract-provider';
import { BigNumber, Contract, Event, PopulatedTransaction } from 'ethers';
import EventEmitter from 'events';
import EngineDebug from '../../debugger/debugger';
import {
  EventsListener,
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
import { RailgunSmartWallet } from '../../typechain-types';
import { TypedEvent, TypedEventFilter } from '../../typechain-types/common';
import { LegacyRailgunLogic } from './legacy-events/RailgunLogic_LegacyEvents';
import {
  CommitmentCiphertextStructOutput,
  CommitmentPreimageStruct,
  CommitmentPreimageStructOutput,
  NullifiedEventObject,
  ShieldCiphertextStructOutput,
  ShieldEventObject,
  ShieldRequestStruct,
  TokenDataStructOutput,
  TransactEventObject,
  TransactionStruct,
  UnshieldEventObject,
} from '../../typechain-types/contracts/logic/RailgunSmartWallet';
import {
  ENGINE_V3_START_BLOCK_NUMBERS_EVM,
  ENGINE_V3_SHIELD_EVENT_UPDATE_03_09_23_BLOCK_NUMBERS_EVM,
} from '../../utils';
import { Chain, ChainType } from '../../models/engine-types';
import { RailgunSmartWallet_LegacyShield_PreMar23 } from './legacy-events/RailgunSmartWallet_LegacyShield_PreMar23';

const SCAN_CHUNKS = 499;
const MAX_SCAN_RETRIES = 90;
const EVENTS_SCAN_TIMEOUT = 5000;

class RailgunSmartWalletContract extends EventEmitter {
  readonly contract: RailgunSmartWallet;

  readonly address: string;

  readonly chain: Chain;

  /**
   * Connect to Railgun instance on network
   * @param railgunSmartWalletContractAddress - address of Railgun instance (Proxy contract)
   * @param provider - Network provider
   */
  constructor(railgunSmartWalletContractAddress: string, provider: Provider, chain: Chain) {
    super();
    this.address = railgunSmartWalletContractAddress;
    this.contract = new Contract(
      railgunSmartWalletContractAddress,
      ABIRailgunSmartWallet,
      provider,
    ) as RailgunSmartWallet;
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
    shield: string;
    unshield: string;
    nft: string;
  }> {
    const [shieldFee, unshieldFee, nftFee] = await Promise.all([
      this.contract.shieldFee(),
      this.contract.unshieldFee(),
      this.contract.nftFee(),
    ]);

    return {
      shield: shieldFee.toHexString(),
      unshield: unshieldFee.toHexString(),
      nft: nftFee.toHexString(),
    };
  }

  /**
   * Validate root
   * @param root - root to validate
   * @returns isValid
   */
  validateRoot(tree: number, root: string): Promise<boolean> {
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

  /**
   * Listens for tree update events
   * @param commitmentListener - listener callback
   * @param eventsNullifierListener - nullifier listener callback
   * @param eventsUnshieldListener - unshield listener callback
   */
  setTreeUpdateListeners(
    commitmentListener: EventsListener,
    eventsNullifierListener: EventsNullifierListener,
    eventsUnshieldListener: EventsUnshieldListener,
  ) {
    // listen for nullifiers first so balances aren't "double" before they process
    this.contract.on(
      this.contract.filters.Nullified(),
      async (treeNumber: number, nullifier: string[], event: Event) => {
        const args: NullifiedEventObject = {
          treeNumber,
          nullifier,
        };
        const formattedEventArgs = formatNullifiedEvents(
          args,
          event.transactionHash,
          event.blockNumber,
        );
        await eventsNullifierListener(formattedEventArgs);
        // @todo why is it emitted twice for a transaction of 1 input?
        this.emit(EngineEvent.ContractNullifierReceived, formattedEventArgs);
      },
    );

    this.contract.on(
      this.contract.filters.Shield(),
      async (
        treeNumber: BigNumber,
        startPosition: BigNumber,
        commitments: CommitmentPreimageStructOutput[],
        shieldCiphertext: ShieldCiphertextStructOutput[],
        fees: BigNumber[],
        event: Event,
      ) => {
        const args: ShieldEventObject = {
          treeNumber,
          startPosition,
          commitments,
          shieldCiphertext,
          fees,
        };
        await commitmentListener(
          formatShieldEvent(args, event.transactionHash, event.blockNumber, fees),
        );
      },
    );

    this.contract.on(
      this.contract.filters.Transact(),
      async (
        treeNumber: BigNumber,
        startPosition: BigNumber,
        hash: string[],
        ciphertext: CommitmentCiphertextStructOutput[],
        event: Event,
      ) => {
        const args: TransactEventObject = {
          treeNumber,
          startPosition,
          hash,
          ciphertext,
        };
        await commitmentListener(
          formatTransactEvent(args, event.transactionHash, event.blockNumber),
        );
      },
    );

    this.contract.on(
      this.contract.filters.Unshield(),
      async (
        to: string,
        token: TokenDataStructOutput,
        amount: BigNumber,
        fee: BigNumber,
        event: Event,
      ) => {
        const args: UnshieldEventObject = {
          to,
          token,
          amount,
          fee,
        };
        await eventsUnshieldListener([
          formatUnshieldEvent(args, event.transactionHash, event.blockNumber),
        ]);
      },
    );
  }

  private async scanEvents<EventType extends TypedEvent>(
    eventFilter: TypedEventFilter<EventType>,
    startBlock: number,
    endBlock: number,
    retryCount = 0,
  ): Promise<EventType[]> {
    try {
      const events = await promiseTimeout(
        this.contract.queryFilter(eventFilter, startBlock, endBlock),
        EVENTS_SCAN_TIMEOUT,
      ).catch(() => {
        throw new Error(`Timed out after ${EVENTS_SCAN_TIMEOUT}`);
      });
      return events;
    } catch (err) {
      if (!(err instanceof Error)) {
        throw err;
      }
      if (retryCount < MAX_SCAN_RETRIES) {
        const retry = retryCount + 1;
        EngineDebug.log(
          `[Chain ${this.chain.type}:${
            this.chain.id
          }]: Scan query error at block ${startBlock}. Retrying ${MAX_SCAN_RETRIES - retry} times.`,
        );
        EngineDebug.error(err);
        return this.scanEvents(eventFilter, startBlock, endBlock, retry);
      }
      EngineDebug.log(
        `[Chain ${this.chain.type}:${this.chain.id}]: Scan failed at block ${startBlock}. No longer retrying.`,
      );
      EngineDebug.error(err);
      throw err;
    }
  }

  private static getEngineV3StartBlockNumber(chain: Chain) {
    if (chain.type === ChainType.EVM) {
      return ENGINE_V3_START_BLOCK_NUMBERS_EVM[chain.id] || 0;
    }
    return 0;
  }

  private static getEngineV3ShieldEventUpdate030923BlockNumber(chain: Chain) {
    if (chain.type === ChainType.EVM) {
      return ENGINE_V3_SHIELD_EVENT_UPDATE_03_09_23_BLOCK_NUMBERS_EVM[chain.id] || 0;
    }
    return 0;
  }

  /**
   * Gets historical events from block
   * @param startBlock - block to scan from
   * @param latestBlock - block to scan to
   */
  async getHistoricalEvents(
    chain: Chain,
    startBlock: number,
    latestBlock: number,
    eventsListener: EventsListener,
    eventsNullifierListener: EventsNullifierListener,
    eventsUnshieldListener: EventsUnshieldListener,
    setLastSyncedBlock: (lastSyncedBlock: number) => Promise<void>,
  ) {
    const engineV3StartBlockNumber = RailgunSmartWalletContract.getEngineV3StartBlockNumber(chain);
    const engineV3ShieldEventUpdate030923BlockNumber =
      RailgunSmartWalletContract.getEngineV3ShieldEventUpdate030923BlockNumber(chain);

    let currentStartBlock = startBlock;

    // Current live events - post v3 update
    const eventFilterNullified = this.contract.filters.Nullified();
    const eventFilterTransact = this.contract.filters.Transact();
    const eventFilterUnshield = this.contract.filters.Unshield();

    // Current live Shield - Mar 2023
    const eventFilterShield = this.contract.filters.Shield();

    // This type includes legacy event types and filters, from before the v3 update.
    // We need to scan prior commitments from these past events, before engineV3StartBlockNumber.
    const legacyEventsContract = this.contract as unknown as LegacyRailgunLogic;
    const legacyEventFilterNullifiers = legacyEventsContract.filters.Nullifiers();
    const legacyEventFilterGeneratedCommitmentBatch =
      legacyEventsContract.filters.GeneratedCommitmentBatch();
    const legacyEventFilterEncryptedCommitmentBatch =
      legacyEventsContract.filters.CommitmentBatch();

    // This type includes legacy Shield event types and filters, from before the Mar 2023 update.
    const legacyShieldEventContract = this
      .contract as unknown as RailgunSmartWallet_LegacyShield_PreMar23;
    const eventFilter_LegacyShield_PreMar23 = legacyShieldEventContract.filters.Shield();

    EngineDebug.log(
      `[Chain ${this.chain.type}:${this.chain.id}]: Scanning historical events from block ${currentStartBlock} to ${latestBlock}`,
    );

    while (currentStartBlock < latestBlock) {
      // Process chunks of blocks at a time

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

      if ((currentStartBlock - startBlock) % 10000 === 0) {
        EngineDebug.log(
          `[Chain ${this.chain.type}:${this.chain.id}]: Scanning next 10,000 events (${
            withinLegacyEventRange ? 'legacy' : 'v3'
          }) [${currentStartBlock}]...`,
        );
      }

      if (withinV3EventRange) {
        // Shield events.
        if (withinLegacyV3ShieldEventRange) {
          // Legacy V3 Shield Event - Pre March 2023.
          // eslint-disable-next-line no-await-in-loop
          const eventsShield = await this.scanEvents(
            eventFilter_LegacyShield_PreMar23,
            currentStartBlock,
            endBlock,
          );
          // eslint-disable-next-line no-await-in-loop
          await processShieldEvents_LegacyShield_PreMar23(eventsListener, eventsShield);
        }
        if (withinNewV3ShieldEventRange) {
          // New V3 Shield Event - After March 2023.
          // eslint-disable-next-line no-await-in-loop
          const eventsShield = await this.scanEvents(
            eventFilterShield,
            currentStartBlock,
            endBlock,
          );
          // eslint-disable-next-line no-await-in-loop
          await processShieldEvents(eventsListener, eventsShield);
        }

        // Standard commitments and nullifiers.
        const [eventsNullifiers, eventsTransact, eventsUnshield] =
          // eslint-disable-next-line no-await-in-loop
          await Promise.all([
            this.scanEvents(eventFilterNullified, currentStartBlock, endBlock),
            this.scanEvents(eventFilterTransact, currentStartBlock, endBlock),
            this.scanEvents(eventFilterUnshield, currentStartBlock, endBlock),
          ]);

        // eslint-disable-next-line no-await-in-loop
        await Promise.all([
          processNullifiedEvents(eventsNullifierListener, eventsNullifiers),
          processTransactEvents(eventsListener, eventsTransact),
          processUnshieldEvents(eventsUnshieldListener, eventsUnshield),
        ]);
      }

      if (withinLegacyEventRange) {
        // Legacy Events.
        const [
          legacyEventsNullifiers,
          legacyEventsGeneratedCommitmentBatch,
          legacyEventsEncryptedCommitmentBatch,
          // eslint-disable-next-line no-await-in-loop
        ] = await Promise.all([
          this.scanEvents(legacyEventFilterNullifiers, currentStartBlock, endBlock),
          this.scanEvents(legacyEventFilterGeneratedCommitmentBatch, currentStartBlock, endBlock),
          this.scanEvents(legacyEventFilterEncryptedCommitmentBatch, currentStartBlock, endBlock),
        ]);

        // eslint-disable-next-line no-await-in-loop
        await Promise.all([
          processLegacyNullifierEvents(eventsNullifierListener, legacyEventsNullifiers),
          processLegacyGeneratedCommitmentEvents(
            eventsListener,
            legacyEventsGeneratedCommitmentBatch,
          ),
          processLegacyCommitmentBatchEvents(eventsListener, legacyEventsEncryptedCommitmentBatch),
        ]);
      }

      // eslint-disable-next-line no-await-in-loop
      await setLastSyncedBlock(endBlock);

      currentStartBlock += SCAN_CHUNKS + 1;
    }

    EngineDebug.log(`[Chain ${this.chain.type}:${this.chain.id}]: Finished historical event scan`);
  }

  /**
   * GenerateShield populated transaction
   * @param {ShieldInput[]} shieldInputs - array of preImage and encryptedRandom for each shield note
   * @returns Populated transaction
   */
  generateShield(shieldRequests: ShieldRequestStruct[]): Promise<PopulatedTransaction> {
    return this.contract.populateTransaction.shield(shieldRequests);
  }

  /**
   * Create transaction call for ETH
   * @param transactions - serialized railgun transaction
   * @returns - populated ETH transaction
   */
  transact(transactions: TransactionStruct[]): Promise<PopulatedTransaction> {
    return this.contract.populateTransaction.transact(transactions);
  }

  async hashCommitment(commitment: CommitmentPreimageStruct): Promise<string> {
    return this.contract.hashCommitment({
      ...commitment,
      npk: formatToByteLength(await commitment.npk, ByteLength.UINT_256, true),
    });
  }

  /**
   * Remove all listeners and shutdown contract instance
   */
  unload() {
    this.contract.removeAllListeners();
  }
}

export { RailgunSmartWalletContract };
