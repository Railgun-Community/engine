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
import { ERC20Note } from '../../note';
import type { Commitment, Nullifier } from '../../merkletree';
import {
  DEFAULT_ERC20_TOKEN_TYPE,
  DEFAULT_TOKEN_SUB_ID,
  ERC20TransactionSerialized,
} from '../../transaction/erc20';
import {
  formatNullifier,
  formatGeneratedCommitmentBatchCommitments,
  formatEncryptedCommitmentBatchCommitments,
  GeneratedCommitmentArgs,
  EncryptedCommitmentArgs,
} from './events';
import { LeptonDebugger } from '../../models/types';
import { ByteLength, BytesData, formatToByteLength, hexlify } from '../../utils/bytes';

export type CommitmentEvent = {
  txid: BytesData;
  treeNumber: number;
  startPosition: number;
  commitments: Commitment[];
};

export type EventsListener = (event: CommitmentEvent) => Promise<void>;
export type EventsNullifierListener = (nullifiers: Nullifier[]) => Promise<void>;

const SCAN_CHUNKS = 499;
const MAX_SCAN_RETRIES = 5;

export enum EventName {
  GeneratedCommitmentBatch = 'GeneratedCommitmentBatch',
  EncryptedCommitmentBatch = 'CommitmentBatch',
  Nullifier = 'Nullifier',
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
    return bytes.hexlify((await this.contract.functions.merkleRoot())[0].toHexString());
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
  validateRoot(tree: number, root: bytes.BytesData): Promise<boolean> {
    // Return result of root history lookup
    return this.contract.rootHistory(tree, bytes.hexlify(root, true));
  }

  /**
   * Listens for tree update events
   * @param listener - listener callback
   */
  treeUpdates(eventsListener: EventsListener, eventsNullifierListener: EventsNullifierListener) {
    this.contract.on(
      EventName.GeneratedCommitmentBatch,
      async (
        treeNumber: BigNumber,
        startPosition: BigNumber,
        commitments: GeneratedCommitmentArgs[],
        event: Event,
      ) => {
        await eventsListener({
          txid: event.transactionHash,
          treeNumber: treeNumber.toNumber(),
          startPosition: startPosition.toNumber(),
          commitments: formatGeneratedCommitmentBatchCommitments(
            event.transactionHash,
            commitments,
          ),
        });
      },
    );

    this.contract.on(
      EventName.EncryptedCommitmentBatch,
      async (
        treeNumber: BigNumber,
        startPosition: BigNumber,
        commitments: EncryptedCommitmentArgs[],
        event: Event,
      ) => {
        await eventsListener({
          txid: event.transactionHash,
          treeNumber: treeNumber.toNumber(),
          startPosition: startPosition.toNumber(),
          commitments: formatEncryptedCommitmentBatchCommitments(
            event.transactionHash,
            commitments,
          ),
        });
      },
    );

    this.contract.on(EventName.Nullifier, async (nullifier: BigNumber, event: Event) => {
      await eventsNullifierListener([
        {
          txid: event.transactionHash,
          nullifier: nullifier.toHexString(),
        },
      ]);
    });
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
    const eventFilterNullifier = this.contract.filters.Nullifier();

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
        ERC20RailgunContract.processGeneratedCommitmentEvents(
          eventsListener,
          eventsGeneratedCommitment,
        ),
        ERC20RailgunContract.processEncryptedCommitmentEvents(
          eventsListener,
          eventsEncryptedCommitment,
        ),
        ERC20RailgunContract.processNullifierEvents(eventsNullifierListener, eventsNullifier),
      ]);

      // eslint-disable-next-line no-await-in-loop
      await setLastSyncedBlock(currentStartBlock);

      currentStartBlock += SCAN_CHUNKS + 1;
    }

    this.leptonDebugger?.log('Finished historical event scan');
  }

  private static async processGeneratedCommitmentEvents(
    eventsListener: EventsListener,
    generatedCommitmentEvents: Event[],
  ) {
    generatedCommitmentEvents.forEach(async (event) => {
      if (!event.args) {
        return;
      }
      await eventsListener({
        txid: hexlify(event.transactionHash),
        treeNumber: event.args.treeNumber.toNumber(),
        startPosition: event.args.startPosition.toNumber(),
        commitments: formatGeneratedCommitmentBatchCommitments(
          event.transactionHash,
          event.args.commitments,
        ),
      });
    });
  }

  private static async processEncryptedCommitmentEvents(
    eventsListener: EventsListener,
    encryptedCommitmentEvents: Event[],
  ) {
    encryptedCommitmentEvents.forEach(async (event) => {
      if (!event.args) {
        return;
      }
      await eventsListener({
        txid: hexlify(event.transactionHash),
        treeNumber: event.args.treeNumber.toNumber(),
        startPosition: event.args.startPosition.toNumber(),
        commitments: formatEncryptedCommitmentBatchCommitments(
          event.transactionHash,
          event.args.commitments,
        ),
      });
    });
  }

  private static async processNullifierEvents(
    eventsNullifierListener: EventsNullifierListener,
    nullifierEvents: Event[],
  ) {
    const nullifiers: Nullifier[] = [];

    nullifierEvents.forEach(async (event) => {
      if (!event.args) {
        return;
      }
      nullifiers.push(formatNullifier(event.transactionHash, event.args.nullifier));
    });

    await eventsNullifierListener(nullifiers);
  }

  /**
   * Get generateDeposit populated transaction
   * @param notes - notes to deposit to
   * @returns Populated transaction
   */
  generateDeposit(notes: ERC20Note[]): Promise<PopulatedTransaction> {
    // Serialize for contract
    const inputs = notes.map((note) => {
      const serialized = note.serialize(true);
      const pubkeyUnpacked = babyjubjub
        .unpackPoint(serialized.pubkey)
        .map((element) => bytes.hexlify(element, true));

      return {
        pubkey: pubkeyUnpacked,
        random: serialized.random,
        amount: serialized.amount,
        tokenType: formatToByteLength(DEFAULT_ERC20_TOKEN_TYPE, ByteLength.UINT_8),
        tokenSubID: formatToByteLength(DEFAULT_TOKEN_SUB_ID, ByteLength.UINT_256),
        token: formatToByteLength(serialized.token, ByteLength.UINT_256),
      };
    });

    // Return populated transaction
    return this.contract.populateTransaction.generateDeposit(inputs);
  }

  /**
   * Create transaction call for ETH
   * @param transactions - serialized railgun transaction
   * @returns - populated ETH transaction
   */
  transact(transactions: ERC20TransactionSerialized[]): Promise<PopulatedTransaction> {
    // Calculate inputs
    const inputs = transactions.map((transaction) => ({
      proof: {
        a: transaction.proof.a.map((el) => formatToByteLength(el, ByteLength.UINT_256)),
        b: transaction.proof.b.map((el) =>
          el.map((el2) => formatToByteLength(el2, ByteLength.UINT_256)),
        ),
        c: transaction.proof.c.map((el) => formatToByteLength(el, ByteLength.UINT_256)),
      },
      adaptIDcontract: formatToByteLength(transaction.adaptID.contract, ByteLength.Address),
      adaptIDparameters: formatToByteLength(transaction.adaptID.parameters, ByteLength.UINT_256),
      depositAmount: formatToByteLength(transaction.deposit, ByteLength.UINT_120),
      withdrawAmount: formatToByteLength(transaction.withdraw, ByteLength.UINT_120),
      tokenType: formatToByteLength(transaction.tokenType, ByteLength.UINT_8),
      tokenSubID: formatToByteLength(transaction.tokenSubID, ByteLength.UINT_256),
      tokenField: formatToByteLength(transaction.token, ByteLength.UINT_256),
      outputEthAddress: formatToByteLength(transaction.withdrawAddress, ByteLength.Address),
      treeNumber: formatToByteLength(transaction.treeNumber, ByteLength.UINT_256),
      merkleRoot: formatToByteLength(transaction.merkleRoot, ByteLength.UINT_256),
      nullifiers: transaction.nullifiers.map((nullifier) =>
        formatToByteLength(nullifier, ByteLength.UINT_256),
      ),
      commitmentsOut: transaction.commitments.map((commitment) => ({
        hash: formatToByteLength(commitment.hash, ByteLength.UINT_256),
        ciphertext: commitment.ciphertext.map((word) =>
          formatToByteLength(word, ByteLength.UINT_256),
        ),
        senderPubKey: babyjubjub
          .unpackPoint(commitment.senderPubKey)
          .map((el) => formatToByteLength(el, ByteLength.UINT_256)),
        revealKey: commitment.revealKey.map((el) => formatToByteLength(el, ByteLength.UINT_256)),
      })),
    }));

    // Return populated transaction
    return this.contract.populateTransaction.transact(inputs);
  }

  /**
   *
   * @param
   * @returns
   */
  relay(
    transactions: ERC20TransactionSerialized[],
    random: BytesData,
    requireSuccess: boolean,
    calls: PopulatedTransaction[],
    overrides?: CallOverrides,
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

  /**
   * ERC20TransactionSerialized proof fields should be set to '0'
   */
  estimateGas(
    transactions: ERC20TransactionSerialized[],
    random: BytesData,
    requireSuccess: boolean,
    calls: PopulatedTransaction[],
    overrides: CallOverrides = {},
  ): Promise<BigNumber> {
    const overridesFormatted = overrides;
    overridesFormatted.from = '0x0000000000000000000000000000000000000000';

    return this.contract.estimateGas.relay(
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
      overridesFormatted,
    );
  }

  depositEth(
    amount: BigNumber,
    random: BytesData,
    wethAddress: String,
    pubKey: String[],
  ): Promise<PopulatedTransaction> {
    const calls = [
      this.contract.interface.encodeFunctionData('wrapAllEth'),
      this.contract.interface.encodeFunctionData('deposit', [[wethAddress], random, pubKey]),
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

  withdrawEth(
    transactions: ERC20TransactionSerialized[],
    random: BigNumber,
    to: String,
  ): Promise<PopulatedTransaction> {
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
