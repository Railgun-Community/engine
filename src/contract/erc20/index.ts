import { Contract, PopulatedTransaction, BigNumber, Event, EventFilter } from 'ethers';
import type { Provider } from '@ethersproject/abstract-provider';
import { bytes, babyjubjub } from '../../utils';
import { abi } from './abi';
import { ERC20Note } from '../../note';
import type { Commitment, Nullifier } from '../../merkletree';
import type { ERC20TransactionSerialized } from '../../transaction/erc20';
import {
  formatGeneratedCommitment,
  formatEncryptedCommitment,
  formatNullifier,
  formatGeneratedCommitmentBatchCommitments,
  formatEncryptedCommitmentBatchCommitments,
  GeneratedCommitmentArgs,
  EncryptedCommitmentArgs,
} from './events';
import { LeptonDebugger } from '../../models/types';

// eslint-disable-next-line no-unused-vars
export type Listener = (tree: number, startingIndex: number, leaves: Commitment[]) => Promise<void>;
// eslint-disable-next-line no-unused-vars
export type NullifierListener = (nullifiers: Nullifier[]) => Promise<void>;

// eslint-disable-next-line no-unused-vars
export enum EventName {
  GeneratedCommitmentBatch = 'GeneratedCommitmentBatch',
  EncryptedCommitmentBatch = 'CommitmentBatch',
  GeneratedCommitment = 'NewGeneratedCommitment',
  EncryptedCommitment = 'NewCommitment',
  Nullifier = 'Nullifier',
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
    return bytes.hexlify((await this.contract.functions.merkleRoot())[0].toHexString());
  }

  /**
   * Gets transaction fees
   * Deposit and withdraw fees are in basis points, transfer is in wei
   */
  async fees(): Promise<{
    deposit: string;
    withdraw: string;
    transfer: string;
  }> {
    const [depositFee, withdrawFee, transferFee] = await Promise.all([
      this.contract.depositFee(),
      this.contract.withdrawFee(),
      this.contract.transferFee(),
    ]);

    return {
      deposit: depositFee.toHexString(),
      withdraw: withdrawFee.toHexString(),
      transfer: transferFee.toHexString(),
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
  treeUpdates(listener: Listener, nullifierListener: NullifierListener) {
    this.contract.on(
      EventName.GeneratedCommitmentBatch,
      async (
        treeNumber: BigNumber,
        startPosition: BigNumber,
        commitments: GeneratedCommitmentArgs[],
        event: Event,
      ) => {
        await listener(
          treeNumber.toNumber(),
          startPosition.toNumber(),
          formatGeneratedCommitmentBatchCommitments(event.transactionHash, commitments),
        );
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
        await listener(
          treeNumber.toNumber(),
          startPosition.toNumber(),
          formatEncryptedCommitmentBatchCommitments(event.transactionHash, commitments),
        );
      },
    );

    this.contract.on(EventName.Nullifier, (nullifier: BigNumber, event: Event) => {
      nullifierListener([
        {
          txid: event.transactionHash,
          nullifier: nullifier.toHexString(),
        },
      ]);
    });
  }

  private getFilterTopics(): (string | string[])[] {
    const filters: EventFilter[] = [
      this.contract.filters.GeneratedCommitmentBatch(),
      this.contract.filters.CommitmentBatch(),
      this.contract.filters.NewGeneratedCommitment(),
      this.contract.filters.NewCommitment(),
      this.contract.filters.Nullifier(),
    ];

    const filterTopics: (string | string[])[] = [];
    filters.forEach((filter) => {
      const { topics } = filter;
      if (topics) {
        filterTopics.push(...topics);
      }
    });
    return filterTopics;
  }

  /**
   * Gets historical events from block
   * @param startBlock - block to scan from
   * @param listener - listener to call with events
   */
  async getHistoricalEvents(
    startBlock: number,
    listener: Listener,
    nullifierListener: NullifierListener,
    leptonDebugger?: LeptonDebugger,
  ) {
    const SCAN_CHUNKS = 500;

    let currentStartBlock = startBlock;
    const latest = (await this.contract.provider.getBlock('latest')).number;

    // NOTE: ONLY 4 FILTERS ALLOWED PER QUERY.
    const filterTopics: string[][] = [
      this.contract.filters.GeneratedCommitmentBatch().topics as string[],
      this.contract.filters.CommitmentBatch().topics as string[],
      this.contract.filters.NewGeneratedCommitment().topics as string[],
      this.contract.filters.NewCommitment().topics as string[],
    ];

    leptonDebugger?.log(`Scanning events from block ${currentStartBlock} to ${latest}`);

    const events: Event[] = [];

    leptonDebugger?.log(`Scanning commitment events...`);

    // Process chunks of blocks at a time
    while (currentStartBlock < latest) {
      if ((currentStartBlock - startBlock) % 10000 === 0) {
        leptonDebugger?.log(`Scanning next 10,000 events [${currentStartBlock}]...`);
      }
      events.push(
        // eslint-disable-next-line no-await-in-loop
        ...(await this.contract.queryFilter(
          {
            address: this.contract.address,
            topics: filterTopics,
          },
          currentStartBlock,
          currentStartBlock + SCAN_CHUNKS,
        )),
      );
      currentStartBlock += SCAN_CHUNKS;
    }

    const nulliferEvents: Event[] = [];

    leptonDebugger?.log(`Scanning nullifier events...`);

    // We need a second query because only 4 filters are supported.
    // When contracts are updated, we can merge into a single query.
    let nullifierCurrentStartBlock = startBlock;
    while (nullifierCurrentStartBlock < latest) {
      if ((currentStartBlock - startBlock) % 10000 === 0) {
        leptonDebugger?.log(`Scanning next 10,000 nullifiers [${currentStartBlock}]...`);
      }
      nulliferEvents.push(
        // eslint-disable-next-line no-await-in-loop
        ...(await this.contract.queryFilter(
          this.contract.filters.Nullifier(),
          nullifierCurrentStartBlock,
          nullifierCurrentStartBlock + SCAN_CHUNKS,
        )),
      );
      nullifierCurrentStartBlock += SCAN_CHUNKS;
    }

    const leaves: Commitment[] = [];
    const nullifiers: Nullifier[] = [];

    // Process events
    events.forEach(async (event) => {
      if (!event.args) {
        return;
      }
      const eventName = event.event;
      if (eventName === EventName.GeneratedCommitmentBatch) {
        await listener(
          event.args.treeNumber.toNumber(),
          event.args.startPosition.toNumber(),
          formatGeneratedCommitmentBatchCommitments(event.transactionHash, event.args.commitments),
        );
      } else if (eventName === EventName.EncryptedCommitmentBatch) {
        await listener(
          event.args.treeNumber.toNumber(),
          event.args.startPosition.toNumber(),
          formatEncryptedCommitmentBatchCommitments(event.transactionHash, event.args.commitments),
        );
      } else if (eventName === EventName.GeneratedCommitment) {
        leaves.push(
          formatGeneratedCommitment(
            event.transactionHash,
            event.args as unknown as GeneratedCommitmentArgs,
          ),
        );
      } else if (eventName === EventName.EncryptedCommitment) {
        leaves.push(
          formatEncryptedCommitment(
            event.transactionHash,
            event as unknown as EncryptedCommitmentArgs,
          ),
        );
      }
      // TODO: When we combine Nullifier events into the same event query, handle them like this:
      // else if (eventName === EventName.Nullifier) {
      //   nullifiers.push(formatNullifier(event.transactionHash, event.args.nullifier));
      // }
    });

    nulliferEvents.forEach((event) => {
      if (!event.args) {
        return;
      }
      nullifiers.push(formatNullifier(event.transactionHash, event.args.nullifier));
    });

    await nullifierListener(nullifiers);

    if (leaves.length > 0) {
      await listener(0, 0, leaves);
    }
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
        token: bytes.hexlify(bytes.trim(serialized.token, 20), true),
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
      _proof: {
        a: transaction.proof.a.map((el) => bytes.padToLength(bytes.hexlify(el, true), 32)),
        b: transaction.proof.b.map((el) =>
          el.map((el2) => bytes.padToLength(bytes.hexlify(el2, true), 32)),
        ),
        c: transaction.proof.c.map((el) => bytes.padToLength(bytes.hexlify(el, true), 32)),
      },
      _adaptIDcontract: bytes.trim(
        bytes.padToLength(bytes.hexlify(transaction.adaptID.contract, true), 20),
        20,
      ),
      _adaptIDparameters: bytes.padToLength(
        bytes.hexlify(transaction.adaptID.parameters, true),
        32,
      ),
      _depositAmount: bytes.padToLength(bytes.hexlify(transaction.deposit, true), 32),
      _withdrawAmount: bytes.padToLength(bytes.hexlify(transaction.withdraw, true), 32),
      _tokenField: bytes.trim(bytes.padToLength(bytes.hexlify(transaction.token, true), 20), 20),
      _outputEthAddress: bytes.trim(
        bytes.padToLength(bytes.hexlify(transaction.withdrawAddress, true), 20),
        20,
      ),
      _treeNumber: bytes.padToLength(bytes.hexlify(transaction.tree, true), 32),
      _merkleRoot: bytes.padToLength(bytes.hexlify(transaction.merkleroot, true), 32),
      _nullifiers: transaction.nullifiers.map((nullifier) =>
        bytes.padToLength(bytes.hexlify(nullifier, true), 32),
      ),
      _commitmentsOut: transaction.commitments.map((commitment) => ({
        hash: bytes.padToLength(bytes.hexlify(commitment.hash, true), 32),
        ciphertext: commitment.ciphertext.map((word) =>
          bytes.padToLength(bytes.hexlify(word, true), 32),
        ),
        senderPubKey: babyjubjub
          .unpackPoint(commitment.senderPubKey)
          .map((el) => bytes.padToLength(bytes.hexlify(el, true), 32)),
      })),
    }));

    // Return populated transaction
    return this.contract.populateTransaction.transact(inputs);
  }

  /**
   * Remove all listeners and shutdown contract instance
   */
  unload() {
    this.contract.removeAllListeners();
  }
}

export { ERC20RailgunContract };
