import {
  Contract,
  PopulatedTransaction,
  BigNumber,
  Event,
  EventFilter,
  CallOverrides,
} from 'ethers';
import type { Provider } from '@ethersproject/abstract-provider';
import { bytes, babyjubjub } from '../../utils';
import { abi } from './abi';
import {
  BytesData,
  CommitmentPreimage,
  EncryptedRandom,
  SerializedTransaction,
} from '../../models/transaction-types';
import {
  EventsListener,
  EventsNullifierListener,
  processCommitmentBatchEvent,
  processCommitmentBatchEvents,
  processGeneratedCommitment,
  processGeneratedCommitmentEvents,
  processNullifierEvents,
} from './events';
import { LeptonDebugger } from '../../models/types';
import { hexlify } from '../../utils/bytes';

const SCAN_CHUNKS = 499;
const MAX_SCAN_RETRIES = 5;

export enum EventName {
  GeneratedCommitmentBatch = 'GeneratedCommitmentBatch',
  CommitmentBatch = 'CommitmentBatch',
  Nullifiers = 'Nullifiers',
}

class ERC20RailgunContract {
  contract: Contract;

  // Contract address
  address: string;

  readonly leptonDebugger: LeptonDebugger | undefined;

  /**
   * Connect to Railgun instance on network
   * @param address - address of Railgun instance (Proxy contract)
   * @param provider - Network provider
   */
  constructor(address: string, provider: Provider, leptonDebugger?: LeptonDebugger) {
    this.address = address;
    this.contract = new Contract(address, abi, provider);
    this.leptonDebugger = leptonDebugger;
  }

  /**
   * Get current merkle root
   * @returns merkle root
   */
  async merkleRoot(): Promise<string> {
    return bytes.hexlify((await this.contract.merkleRoot()).toHexString());
  }

  /**
   * Gets transaction fees
   * Deposit and withdraw fees are in basis points, nft is in wei
   */
  async fees(): Promise<{
    deposit: string;
    withdraw: string;
    nft: string;
  }> {
    const [depositFee, withdrawFee, nftFee] = await Promise.all([
      this.contract.depositFee(),
      this.contract.withdrawFee(),
      this.contract.nftFee(),
    ]);

    return {
      deposit: depositFee.toHexString(),
      withdraw: withdrawFee.toHexString(),
      nft: nftFee.toHexString(),
    };
  }

  /**
   * Validate root
   * @param root - root to validate
   * @returns isValid
   */
  validateRoot(tree: number, root: string): Promise<boolean> {
    // Return result of root history lookup
    return this.contract.rootHistory(tree, hexlify(root, true));
  }

  /**
   * Listens for tree update events
   * @param listener - listener callback
   */
  treeUpdates(eventsListener: EventsListener, eventsNullifierListener: EventsNullifierListener) {
    this.contract.on(EventName.GeneratedCommitmentBatch, async (...rest: any) => {
      const event = rest.pop();
      await eventsListener(processGeneratedCommitment(event));
    });

    this.contract.on(EventName.CommitmentBatch, async (...rest: any) => {
      const event = rest.pop();
      await eventsListener(processCommitmentBatchEvent(event));
    });

    this.contract.on(
      EventName.Nullifiers,
      async (e: Event) => await processNullifierEvents(eventsNullifierListener, [e]),
    );
  }

  private async scanEvents(
    eventFilter: EventFilter,
    startBlock: number,
    endBlock: number,
    retryCount = 0,
  ): Promise<Event[]> {
    try {
      const events = await this.contract
        .queryFilter(eventFilter, startBlock, endBlock)
        .catch((err: any) => {
          throw err;
        });
      return events;
    } catch (err: any) {
      if (retryCount < MAX_SCAN_RETRIES) {
        const retry = retryCount + 1;
        this.leptonDebugger?.log(
          `Scan query error at block ${startBlock}. Retrying ${MAX_SCAN_RETRIES - retry} times.`,
        );
        this.leptonDebugger?.error(err);
        return this.scanEvents(eventFilter, startBlock, endBlock, retry);
      }
      this.leptonDebugger?.log(`Scan failed at block ${startBlock}. No longer retrying.`);
      this.leptonDebugger?.error(err);
      throw err;
    }
  }

  /**
   * Gets historical events from block
   * @param startBlock - block to scan from
   * @param listener - listener to call with events
   */
  async getHistoricalEvents(
    startBlock: number,
    eventsListener: EventsListener,
    eventsNullifierListener: EventsNullifierListener,
    setLastSyncedBlock: (lastSyncedBlock: number) => Promise<void>,
  ) {
    let currentStartBlock = startBlock;
    const latest = (await this.contract.provider.getBlock('latest')).number;

    const eventFilterGeneratedCommitmentBatch = this.contract.filters.GeneratedCommitmentBatch();
    const eventFilterEncryptedCommitmentBatch = this.contract.filters.CommitmentBatch();
    const eventFilterNullifier = this.contract.filters.Nullifiers();

    this.leptonDebugger?.log(
      `Scanning historical events from block ${currentStartBlock} to ${latest}`,
    );

    while (currentStartBlock < latest) {
      // Process chunks of blocks at a time
      if ((currentStartBlock - startBlock) % 10000 === 0) {
        this.leptonDebugger?.log(`Scanning next 10,000 events [${currentStartBlock}]...`);
      }
      const endBlock = Math.min(latest, currentStartBlock + SCAN_CHUNKS);
      const [eventsGeneratedCommitment, eventsEncryptedCommitment, eventsNullifier] =
        // eslint-disable-next-line no-await-in-loop
        await Promise.all([
          this.scanEvents(eventFilterGeneratedCommitmentBatch, currentStartBlock, endBlock),
          this.scanEvents(eventFilterEncryptedCommitmentBatch, currentStartBlock, endBlock),
          this.scanEvents(eventFilterNullifier, currentStartBlock, endBlock),
        ]);

      // eslint-disable-next-line no-await-in-loop
      await Promise.all([
        processGeneratedCommitmentEvents(eventsListener, eventsGeneratedCommitment),
        processCommitmentBatchEvents(eventsListener, eventsEncryptedCommitment),
        processNullifierEvents(eventsNullifierListener, eventsNullifier),
      ]);

      // eslint-disable-next-line no-await-in-loop
      await setLastSyncedBlock(currentStartBlock);

      currentStartBlock += SCAN_CHUNKS + 1;
    }

    this.leptonDebugger?.log('Finished historical event scan');
  }

  /**
   * Get generateDeposit populated transaction
   * @param notes - notes to deposit to
   * @returns Populated transaction
   */
  generateDeposit(
    inputs: Partial<CommitmentPreimage>[],
    encryptedRandom: EncryptedRandom[],
  ): Promise<PopulatedTransaction> {
    // Return populated transaction
    return this.contract.populateTransaction.generateDeposit(inputs, encryptedRandom);
  }

  /**
   * Create transaction call for ETH
   * @param transactions - serialized railgun transaction
   * @returns - populated ETH transaction
   */
  transact(transactions: SerializedTransaction[]): Promise<PopulatedTransaction> {
    // Calculate inputs

    // Return populated transaction
    return this.contract.populateTransaction.transact(transactions);
  }

  async hashCommitment(commitment: any): Promise<string> {
    const hash: BigNumber = await this.contract.hashCommitment(commitment);
    return hash.toHexString();
  }

  /**
   *
   * @param
   * @returns
   */
  relay(
    transactions: SerializedTransaction[],
    random: BytesData,
    requireSuccess: boolean,
    calls: PopulatedTransaction[],
    overrides: CallOverrides = {},
  ): Promise<PopulatedTransaction> {
    return this.contract.populateTransaction.relay(
      transactions,
      random,
      requireSuccess,
      calls.map((call) => {
        if (!call.to) {
          throw new Error('Must specify to address');
        }

        return {
          to: call.to,
          data: call.data || '',
          value: call.value || '0',
        };
      }),
      overrides,
    );
  }

  depositEth(
    amount: BigNumber,
    wethAddress: BytesData,
    pubKey: BytesData,
  ): Promise<PopulatedTransaction> {
    const random = babyjubjub.random();
    const pubkeyUnpacked = babyjubjub.unpackPubKey(pubKey);

    const calls = [
      this.contract.interface.encodeFunctionData('wrapAllEth'),
      this.contract.interface.encodeFunctionData('deposit', [
        [wethAddress],
        random,
        pubkeyUnpacked,
      ]),
    ];

    const requireSuccess = true;

    return this.relay(
      [],
      random,
      requireSuccess,
      calls.map((call) => ({
        to: this.contract.address,
        data: call,
      })),
      { value: amount },
    );
  }

  withdrawEth(amount: BigNumber, to: BytesData): Promise<PopulatedTransaction> {
    const random = babyjubjub.random();

    const calls = [
      this.contract.interface.encodeFunctionData('unWrapEth'),
      this.contract.interface.encodeFunctionData('send', [
        ['0x0000000000000000000000000000000000000000'],
        to,
      ]),
    ];

    const requireSuccess = true;

    return this.relay(
      [],
      random,
      requireSuccess,
      calls.map((call) => ({
        to: this.contract.address,
        data: call,
      })),
      { value: amount },
    );
  }

  /**
   * Remove all listeners and shutdown contract instance
   */
  unload() {
    this.contract.removeAllListeners();
  }
}

export { ERC20RailgunContract };
