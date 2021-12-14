import {
  Contract,
  PopulatedTransaction,
  BigNumber,
  Event,
} from 'ethers';
import BN from 'bn.js';
import type { Provider } from '@ethersproject/abstract-provider';
import { bytes, babyjubjub } from '../../utils';
import { abi } from './abi';
import { ERC20Note } from '../../note';
import type { Commitment } from '../../merkletree';
import type { ERC20TransactionSerialized } from '../../transaction/erc20';

// eslint-disable-next-line no-unused-vars
export type Listener = (tree: number, startingIndex: number, leaves: Commitment[]) => void;

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
    deposit: BN;
    withdraw: BN;
    transfer: BN;
  }> {
    const [depositFee, withdrawFee, transferFee] = await Promise.all([
      this.contract.depositFee(),
      this.contract.withdrawFee(),
      this.contract.transferFee(),
    ]);

    return {
      deposit: new BN(depositFee.toHexString(), 'hex'),
      withdraw: new BN(withdrawFee.toHexString(), 'hex'),
      transfer: new BN(transferFee.toHexString(), 'hex'),
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
  treeUpdates(listener: Listener) {
    this.contract.on(
      'GeneratedCommitmentBatch',
      (
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
        listener(
          treeNumber.toNumber(),
          startPosition.toNumber(),
          commitments.map((commitment) => {
            const note = ERC20Note.deserialize({
              publicKey: babyjubjub.packPoint(commitment.pubkey.map((el) => el.toHexString())),
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
      (
        treeNumber: BigNumber,
        startPosition: BigNumber,
        commitments: {
          hash: BigNumber;
          ciphertext: BigNumber[];
          senderPubKey: BigNumber[];
        }[],
        event: Event,
      ) => {
        listener(
          treeNumber.toNumber(),
          startPosition.toNumber(),
          commitments.map((commitment) => {
            const ciphertexthexlified = commitment.ciphertext.map((el) => el.toHexString());

            return {
              hash: commitment.hash.toHexString(),
              txid: event.transactionHash,
              senderPublicKey: babyjubjub.packPoint(
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
      const pubkeyUnpacked = babyjubjub.unpackPoint(serialized.publicKey)
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
        senderPubKey: babyjubjub.unpackPoint(commitment.senderPublicKey).map(
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
