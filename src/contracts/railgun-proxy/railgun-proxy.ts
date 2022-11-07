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
import { Chain } from '../../models';
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

const SCAN_CHUNKS = 499;
const MAX_SCAN_RETRIES = 90;
const EVENTS_SCAN_TIMEOUT = 2500;

class RailgunProxyContract extends EventEmitter {
  readonly contract: RailgunSmartWallet;

  readonly address: string;

  private readonly chain: Chain;

  /**
   * Connect to Railgun instance on network
   * @param proxyContractAddress - address of Railgun instance (Proxy contract)
   * @param provider - Network provider
   */
  constructor(proxyContractAddress: string, provider: Provider, chain: Chain) {
    super();
    this.address = proxyContractAddress;
    this.contract = new Contract(
      proxyContractAddress,
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
   * Listens for tree update events
   * @param commitmentListener - listener callback
   * @param eventsNullifierListener - nullifier listener callback
   * @param eventsUnshieldListener - unshield listener callback
   */
  treeUpdates(
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
        event: Event,
      ) => {
        const args: ShieldEventObject = {
          treeNumber,
          startPosition,
          commitments,
          shieldCiphertext,
        };
        await commitmentListener(formatShieldEvent(args, event.transactionHash, event.blockNumber));
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
      ).catch((err) => {
        throw err;
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

  /**
   * Gets historical events from block
   * @param startBlock - block to scan from
   * @param latestBlock - block to scan to
   */
  async getHistoricalEvents(
    startBlock: number,
    latestBlock: number,
    engineV3StartBlockNumber: number,
    eventsListener: EventsListener,
    eventsNullifierListener: EventsNullifierListener,
    eventsUnshieldListener: EventsUnshieldListener,
    setLastSyncedBlock: (lastSyncedBlock: number) => Promise<void>,
  ) {
    let currentStartBlock = startBlock;

    const eventFilterNullified = this.contract.filters.Nullified();
    const eventFilterShield = this.contract.filters.Shield();
    const eventFilterTransact = this.contract.filters.Transact();
    const eventFilterUnshield = this.contract.filters.Unshield();

    // This type includes legacy event types and filters, from before the v3 update.
    // We need to scan prior commitments from these past events, before engineV3StartBlockNumber.
    const legacyEventsContract = this.contract as unknown as LegacyRailgunLogic;
    const legacyEventFilterNullifiers = legacyEventsContract.filters.Nullifiers();
    const legacyEventFilterGeneratedCommitmentBatch =
      legacyEventsContract.filters.GeneratedCommitmentBatch();
    const legacyEventFilterEncryptedCommitmentBatch =
      legacyEventsContract.filters.CommitmentBatch();

    EngineDebug.log(
      `[Chain ${this.chain.type}:${this.chain.id}]: Scanning historical events from block ${currentStartBlock} to ${latestBlock}`,
    );

    while (currentStartBlock < latestBlock) {
      // Process chunks of blocks at a time

      const endBlock = Math.min(latestBlock, currentStartBlock + SCAN_CHUNKS);
      const withinLegacyEventRange = startBlock <= engineV3StartBlockNumber;
      const withinNewEventRange = endBlock >= engineV3StartBlockNumber;
      if (withinLegacyEventRange && withinNewEventRange) {
        EngineDebug.log(
          `[Chain ${this.chain.type}:${this.chain.id}]: Changing from legacy events to new events...`,
        );
      }

      if ((currentStartBlock - startBlock) % 10000 === 0) {
        EngineDebug.log(
          `[Chain ${this.chain.type}:${this.chain.id}]: Scanning next 10,000 events (${
            withinLegacyEventRange ? 'v3' : 'legacy'
          }) [${currentStartBlock}]...`,
        );
      }

      if (withinNewEventRange) {
        // Standard Events.
        const [eventsNullifiers, eventsShield, eventsTransact, eventsUnshield] =
          // eslint-disable-next-line no-await-in-loop
          await Promise.all([
            this.scanEvents(eventFilterNullified, currentStartBlock, endBlock),
            this.scanEvents(eventFilterShield, currentStartBlock, endBlock),
            this.scanEvents(eventFilterTransact, currentStartBlock, endBlock),
            this.scanEvents(eventFilterUnshield, currentStartBlock, endBlock),
          ]);

        // eslint-disable-next-line no-await-in-loop
        await Promise.all([
          processNullifiedEvents(eventsNullifierListener, eventsNullifiers),
          processShieldEvents(eventsListener, eventsShield),
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

export { RailgunProxyContract };
