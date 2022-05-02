import {
  Contract,
  PopulatedTransaction,
  BigNumber,
  Event,
  EventFilter,
  CallOverrides,
} from 'ethers';
import type { Provider } from '@ethersproject/abstract-provider';
import { abi } from './abi';
import {
  BytesData,
  Commitment,
  CommitmentPreimage,
  EncryptedData,
  SerializedTransaction,
} from '../../models/transaction-types';
import {
  CommitmentBatchEventArgs,
  CommitmentCiphertextArgs,
  CommitmentPreimageArgs,
  EncryptedDataArgs,
  EventsListener,
  EventsNullifierListener,
  formatCommitmentBatchEvent,
  formatGeneratedCommitmentBatchEvent,
  formatNullifierEvents,
  GeneratedCommitmentBatchEventArgs,
  NullifierEventArgs,
  processCommitmentBatchEvents,
  processGeneratedCommitmentEvents,
  processNullifierEvents,
} from './events';
import LeptonDebug from '../../debugger';
import { hexlify } from '../../utils/bytes';

export type CommitmentEvent = {
  txid: BytesData;
  treeNumber: number;
  startPosition: number;
  commitments: Commitment[];
};

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

  /**
   * Connect to Railgun instance on network
   * @param address - address of Railgun instance (Proxy contract)
   * @param provider - Network provider
   */
  constructor(address: string, provider: Provider) {
    this.address = address;
    this.contract = new Contract(address, abi, provider);
  }

  /**
   * Get current merkle root
   * @returns merkle root
   */
  async merkleRoot(): Promise<string> {
    return hexlify((await this.contract.merkleRoot()).toHexString());
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
    try {
      // Return result of root history lookup
      return this.contract.rootHistory(tree, hexlify(root, true));
    } catch (err: any) {
      LeptonDebug.error(err);
      throw err;
    }
  }

  /**
   * Listens for tree update events
   * @param eventsListener - listener callback
   * @param eventsNullifierListener - nullifier listener callback
   */
  treeUpdates(eventsListener: EventsListener, eventsNullifierListener: EventsNullifierListener) {
    // listen for nullifiers first so balances aren't "double" before they process
    this.contract.on(
      EventName.Nullifiers,
      async (treeNumber: BigNumber, nullifier: BigNumber[], event: Event) => {
        const args: NullifierEventArgs = {
          treeNumber,
          nullifier,
        };
        await eventsNullifierListener(formatNullifierEvents(args, event.transactionHash));
      },
    );

    this.contract.on(
      EventName.GeneratedCommitmentBatch,
      async (
        treeNumber: BigNumber,
        startPosition: BigNumber,
        commitments: CommitmentPreimageArgs[],
        encryptedRandom: EncryptedDataArgs[],
        event: Event,
      ) => {
        const args: GeneratedCommitmentBatchEventArgs = {
          treeNumber,
          startPosition,
          commitments,
          encryptedRandom,
        };
        await eventsListener(formatGeneratedCommitmentBatchEvent(args, event.transactionHash));
      },
    );

    this.contract.on(
      EventName.CommitmentBatch,
      async (
        treeNumber: BigNumber,
        startPosition: BigNumber,
        hash: BigNumber[],
        ciphertext: CommitmentCiphertextArgs[],
        event: Event,
      ) => {
        const args: CommitmentBatchEventArgs = {
          treeNumber,
          startPosition,
          hash,
          ciphertext,
        };
        await eventsListener(formatCommitmentBatchEvent(args, event.transactionHash));
      },
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
        LeptonDebug.log(
          `Scan query error at block ${startBlock}. Retrying ${MAX_SCAN_RETRIES - retry} times.`,
        );
        LeptonDebug.error(err);
        return this.scanEvents(eventFilter, startBlock, endBlock, retry);
      }
      LeptonDebug.log(`Scan failed at block ${startBlock}. No longer retrying.`);
      LeptonDebug.error(err);
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

    const eventFilterNullifier = this.contract.filters.Nullifiers();
    const eventFilterGeneratedCommitmentBatch = this.contract.filters.GeneratedCommitmentBatch();
    const eventFilterEncryptedCommitmentBatch = this.contract.filters.CommitmentBatch();

    LeptonDebug.log(`Scanning historical events from block ${currentStartBlock} to ${latest}`);

    while (currentStartBlock < latest) {
      // Process chunks of blocks at a time
      if ((currentStartBlock - startBlock) % 10000 === 0) {
        LeptonDebug.log(`Scanning next 10,000 events [${currentStartBlock}]...`);
      }
      const endBlock = Math.min(latest, currentStartBlock + SCAN_CHUNKS);
      const [eventsNullifier, eventsGeneratedCommitment, eventsEncryptedCommitment] =
        // eslint-disable-next-line no-await-in-loop
        await Promise.all([
          this.scanEvents(eventFilterNullifier, currentStartBlock, endBlock),
          this.scanEvents(eventFilterGeneratedCommitmentBatch, currentStartBlock, endBlock),
          this.scanEvents(eventFilterEncryptedCommitmentBatch, currentStartBlock, endBlock),
        ]);

      // eslint-disable-next-line no-await-in-loop
      await Promise.all([
        processNullifierEvents(eventsNullifierListener, eventsNullifier),
        processGeneratedCommitmentEvents(eventsListener, eventsGeneratedCommitment),
        processCommitmentBatchEvents(eventsListener, eventsEncryptedCommitment),
      ]);

      // eslint-disable-next-line no-await-in-loop
      await setLastSyncedBlock(currentStartBlock);

      currentStartBlock += SCAN_CHUNKS + 1;
    }

    LeptonDebug.log('Finished historical event scan');
  }

  /**
   * GenerateDeposit populated transaction
   * @param {CommitmentPreimage[]} inputs - notes to deposit to
   * @param {EncryptedData[]} encryptedRandom - notes to deposit to
   * @returns Populated transaction
   */
  generateDeposit(
    inputs: CommitmentPreimage[],
    encryptedRandom: EncryptedData[],
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

  // TODO: Needs new implementation with newer keys.
  // depositEth(
  //   amount: BigNumber,
  //   wethAddress: BytesData,
  //   pubKey: BytesData,
  // ): Promise<PopulatedTransaction> {

  //   const random = bytes.random();

  //   const calls = [
  //     this.contract.interface.encodeFunctionData('wrapAllEth'),
  //     this.contract.interface.encodeFunctionData('deposit', [
  //       [wethAddress],
  //       random,
  //       pubkeyUnpacked,
  //     ]),
  //   ];

  //   const requireSuccess = true;

  //   return this.relay(
  //     [],
  //     random,
  //     requireSuccess,
  //     calls.map((call) => ({
  //       to: this.contract.address,
  //       data: call,
  //     })),
  //     { value: amount },
  //   );
  // }

  // withdrawEth(amount: BigNumber, to: BytesData): Promise<PopulatedTransaction> {
  //   const random = bytes.random();

  //   const calls = [
  //     this.contract.interface.encodeFunctionData('unWrapEth'),
  //     this.contract.interface.encodeFunctionData('send', [
  //       ['0x0000000000000000000000000000000000000000'],
  //       to,
  //     ]),
  //   ];

  //   const requireSuccess = true;

  //   return this.relay(
  //     [],
  //     random,
  //     requireSuccess,
  //     calls.map((call) => ({
  //       to: this.contract.address,
  //       data: call,
  //     })),
  //     { value: amount },
  //   );
  // }

  /**
   * Remove all listeners and shutdown contract instance
   */
  unload() {
    this.contract.removeAllListeners();
  }
}

export { ERC20RailgunContract };
