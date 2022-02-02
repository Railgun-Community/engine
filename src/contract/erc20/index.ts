import {
  Contract,
  PopulatedTransaction,
  BigNumber,
  Event,
} from 'ethers';
import type { Provider } from '@ethersproject/abstract-provider';
import { bytes, babyjubjub } from '../../utils';
import { abi } from './abi';
import { ERC20Note } from '../../note';
import type { Commitment, Nullifier } from '../../merkletree';
import type { ERC20TransactionSerialized } from '../../transaction/erc20';

// eslint-disable-next-line no-unused-vars
export type Listener = (tree: number, startingIndex: number, leaves: Commitment[]) => Promise<void>;
// eslint-disable-next-line no-unused-vars
export type NullifierListener = (nullifiers: Nullifier[]) => Promise<void>;

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
      'GeneratedCommitmentBatch',
      async (
        treeNumber: BigNumber,
        startPosition: BigNumber,
        commitments: {
          pubkey: [BigNumber, BigNumber];
          random: BigNumber;
          amount: BigNumber;
          token: string;
        }[],
        event: Event,
      ) => {
        await listener(
          treeNumber.toNumber(),
          startPosition.toNumber(),
          commitments.map((commitment) => {
            const note = ERC20Note.deserialize({
              pubkey: babyjubjub.packPoint(commitment.pubkey.map((el) => el.toHexString())),
              random: bytes.hexlify(commitment.random.toHexString()),
              amount: bytes.hexlify(commitment.amount.toHexString()),
              token: bytes.hexlify(commitment.token, true),
            });

            return {
              hash: note.hash,
              txid: event.transactionHash,
              data: note.serialize(),
            };
          }),
        );
      },
    );

    this.contract.on(
      'CommitmentBatch',
      async (
        treeNumber: BigNumber,
        startPosition: BigNumber,
        commitments: {
          hash: BigNumber;
          ciphertext: BigNumber[];
          senderPubKey: BigNumber[];
        }[],
        event: Event,
      ) => {
        await listener(
          treeNumber.toNumber(),
          startPosition.toNumber(),
          commitments.map((commitment) => {
            const ciphertexthexlified = commitment.ciphertext.map((el) => el.toHexString());

            return {
              hash: commitment.hash.toHexString(),
              txid: event.transactionHash,
              senderPubKey: babyjubjub.packPoint(
                commitment.senderPubKey.map((el) => el.toHexString()),
              ),
              ciphertext: {
                iv: ciphertexthexlified[0],
                data: ciphertexthexlified.slice(1),
              },
            };
          }),
        );
      },
    );

    this.contract.on(
      'Nullifier',
      (
        nullifier: BigNumber,
        event: Event,
      ) => {
        nullifierListener([{
          txid: event.transactionHash,
          nullifier: nullifier.toHexString(),
        }]);
      },
    );
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
  ) {
    const SCAN_CHUNKS = 500;
    const generatedCommitmentBatch = [];
    const commitmentBatch = [];
    const generatedCommitment = [];
    const commitment = [];
    const nullifiers = [];

    let currentStartBlock = startBlock;
    const latest = (await this.contract.provider.getBlock('latest')).number;

    // Process chunks of blocks at a time
    while (currentStartBlock < latest) {
      // Loop through each list of events and push to array
      generatedCommitmentBatch.push(
        // eslint-disable-next-line no-await-in-loop
        ...await this.contract.queryFilter(
          this.contract.filters.GeneratedCommitmentBatch(),
          currentStartBlock,
          currentStartBlock + SCAN_CHUNKS,
        ),
      );
      commitmentBatch.push(
        // eslint-disable-next-line no-await-in-loop
        ...await this.contract.queryFilter(
          this.contract.filters.CommitmentBatch(),
          currentStartBlock,
          currentStartBlock + SCAN_CHUNKS,
        ),
      );
      generatedCommitment.push(
        // eslint-disable-next-line no-await-in-loop
        ...await this.contract.queryFilter(
          this.contract.filters.NewGeneratedCommitment(),
          currentStartBlock,
          currentStartBlock + SCAN_CHUNKS,
        ),
      );
      commitment.push(
        // eslint-disable-next-line no-await-in-loop
        ...await this.contract.queryFilter(
          this.contract.filters.NewCommitment(),
          currentStartBlock,
          currentStartBlock + SCAN_CHUNKS,
        ),
      );
      nullifiers.push(
        // eslint-disable-next-line no-await-in-loop
        ...await this.contract.queryFilter(
          this.contract.filters.Nullifier(),
          currentStartBlock,
          currentStartBlock + SCAN_CHUNKS,
        ),
      );
      currentStartBlock += SCAN_CHUNKS;
    }

    // Process events
    generatedCommitmentBatch.forEach(async (event) => {
      if (event.args) {
        await listener(
          event.args.treeNumber.toNumber(),
          event.args.startPosition.toNumber(),
          event.args.commitments.map((commit: any) => {
            const note = ERC20Note.deserialize({
              pubkey: babyjubjub.packPoint(commit.pubkey.map((el: any) => el.toHexString())),
              random: bytes.hexlify(commit.random.toHexString()),
              amount: bytes.hexlify(commit.amount.toHexString()),
              token: bytes.hexlify(commit.token, true),
            });
            return {
              hash: note.hash,
              txid: event.transactionHash,
              data: note.serialize(),
            };
          }),
        );
      }
    });
    commitmentBatch.forEach(async (event) => {
      if (event.args) {
        await listener(
          event.args.treeNumber.toNumber(),
          event.args.startPosition.toNumber(),
          event.args.commitments.map((commit: any) => {
            const ciphertexthexlified = commit.ciphertext.map((el: any) => el.toHexString());
            return {
              hash: commit.hash.toHexString(),
              txid: event.transactionHash,
              senderPubKey: babyjubjub.packPoint(
                commit.senderPubKey.map((el: any) => el.toHexString()),
              ),
              ciphertext: {
                iv: ciphertexthexlified[0],
                data: ciphertexthexlified.slice(1),
              },
            };
          }),
        );
      }
    });
    const leaves: Commitment[] = [];

    generatedCommitment.forEach((event) => {
      if (event.args) {
        const note = ERC20Note.deserialize({
          pubkey: babyjubjub.packPoint(event.args.pubkey.map((el: any) => el.toHexString())),
          random: bytes.hexlify(event.args.random.toHexString()),
          amount: bytes.hexlify(event.args.amount.toHexString()),
          token: bytes.hexlify(event.args.token, true),
        });
        leaves.push({
          hash: note.hash,
          txid: event.transactionHash,
          data: note.serialize(),
        });
      }
    });
    commitment.forEach((event) => {
      if (event.args) {
        const ciphertexthexlified = event.args.ciphertext.map((el: any) => el.toHexString());
        leaves.push({
          hash: event.args.hash.toHexString(),
          txid: event.transactionHash,
          senderPubKey: babyjubjub.packPoint(
            event.args.senderPubKey.map((el: any) => el.toHexString()),
          ),
          ciphertext: {
            iv: ciphertexthexlified[0],
            data: ciphertexthexlified.slice(1),
          },
        });
      }
    });

    await nullifierListener(nullifiers.map((event) => ({
      txid: event.transactionHash,
      // @ts-ignore
      nullifier: event.args.nullifier.toHexString(),
    })));

    if (leaves.length > 0) {
      await listener(0, 0, leaves);
    }
  }

  /**
   * Get generateDeposit populated transaction
   * @param notes - notes to deposit to
   * @returns Populated transaction
   */
  generateDeposit(
    notes: ERC20Note[],
  ): Promise<PopulatedTransaction> {
    // Serialize for contract
    const inputs = notes.map((note) => {
      const serialized = note.serialize(true);
      const pubkeyUnpacked = babyjubjub.unpackPoint(serialized.pubkey)
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
  transact(
    transactions: ERC20TransactionSerialized[],
  ): Promise<PopulatedTransaction> {
    // Calculate inputs
    const inputs = transactions.map((transaction) => ({
      _proof: {
        a: transaction.proof.a.map((el) => bytes.padToLength(
          bytes.hexlify(el, true), 32,
        )),
        b: transaction.proof.b.map((el) => el.map((el2) => bytes.padToLength(
          bytes.hexlify(el2, true), 32,
        ))),
        c: transaction.proof.c.map((el) => bytes.padToLength(
          bytes.hexlify(el, true), 32,
        )),
      },
      _adaptIDcontract: bytes.trim(bytes.padToLength(
        bytes.hexlify(transaction.adaptID.contract, true), 20,
      ), 20),
      _adaptIDparameters: bytes.padToLength(
        bytes.hexlify(transaction.adaptID.parameters, true), 32,
      ),
      _depositAmount: bytes.padToLength(
        bytes.hexlify(transaction.deposit, true), 32,
      ),
      _withdrawAmount: bytes.padToLength(
        bytes.hexlify(transaction.withdraw, true), 32,
      ),
      _tokenField: bytes.trim(bytes.padToLength(
        bytes.hexlify(transaction.token, true), 20,
      ), 20),
      _outputEthAddress: bytes.trim(bytes.padToLength(
        bytes.hexlify(transaction.withdrawAddress, true), 20,
      ), 20),
      _treeNumber: bytes.padToLength(
        bytes.hexlify(transaction.tree, true), 32,
      ),
      _merkleRoot: bytes.padToLength(
        bytes.hexlify(transaction.merkleroot, true), 32,
      ),
      _nullifiers: transaction.nullifiers.map(
        (nullifier) => bytes.padToLength(
          bytes.hexlify(nullifier, true), 32,
        ),
      ),
      _commitmentsOut: transaction.commitments.map((commitment) => ({
        hash: bytes.padToLength(
          bytes.hexlify(commitment.hash, true), 32,
        ),
        ciphertext: commitment.ciphertext.map((word) => bytes.padToLength(
          bytes.hexlify(word, true), 32,
        )),
        senderPubKey: babyjubjub.unpackPoint(commitment.senderPubKey).map(
          (el) => bytes.padToLength(
            bytes.hexlify(el, true), 32,
          ),
        ),
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
