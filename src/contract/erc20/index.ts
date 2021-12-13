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
import type { Commitment } from '../../merkletree';
import type { BytesData } from '../../utils/bytes';
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
   * Validate root
   * @param root - root to validate
   * @returns isValid
   */
  validateRoot(tree: number, root: BytesData): Promise<boolean> {
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
    const inputs = transactions.map((transaction) => {
      
    });

    // Return populated transaction
    return this.contract.populateTransaction.generateDeposit(inputs);
  }

  /**
   * Remove all listeners and shutdown contract instance
   */
  unload() {
    this.contract.removeAllListeners();
  }
}

export { ERC20RailgunContract };
