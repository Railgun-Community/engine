import { Signature } from '@railgun-community/circomlibjs';
import { poseidon } from '../utils/poseidon';
import { Database } from '../database/database';
import { deriveNodes, SpendingKeyPair, WalletNode, deriveEphemeralWallet } from '../key-derivation';
import { WalletData } from '../models/wallet-types';
import { ByteUtils } from '../utils/bytes';
import { sha256 } from '../utils/hash';
import { AbstractWallet } from './abstract-wallet';
import { Mnemonic } from '../key-derivation/bip39';
import { PublicInputsRailgun } from '../models';
import { signEDDSA } from '../utils/keys-utils';
import { Prover } from '../prover/prover';
import { HDNodeWallet, Authorization } from 'ethers';
import { RelayAdapt7702Helper } from '../contracts/relay-adapt/relay-adapt-7702-helper';
import { TransactionStructV2, TransactionStructV3 } from '../models/transaction-types';
import { RelayAdapt } from '../abi/typechain/RelayAdapt';

class RailgunWallet extends AbstractWallet {
  /**
   * Load encrypted spending key Node from database
   * Spending key should be kept private and only accessed on demand
   * @returns {Promise<SpendingKeyPair>}
   */
  async getSpendingKeyPair(encryptionKey: string): Promise<SpendingKeyPair> {
    const node = await this.loadSpendingKey(encryptionKey);
    return node.getSpendingKeyPair();
  }

  async sign(publicInputs: PublicInputsRailgun, encryptionKey: string): Promise<Signature> {
    const spendingKeyPair = await this.getSpendingKeyPair(encryptionKey);
    const msg = poseidon([publicInputs.merkleRoot, publicInputs.boundParamsHash, ...publicInputs.nullifiers, ...publicInputs.commitmentsOut]);
    return signEDDSA(spendingKeyPair.privateKey, msg);
  }

  /**
   * Get ephemeral wallet for RelayAdapt7702
   * @param {string} encryptionKey - encryption key to use with database
   * @param {number} index - index of derivation path
   * @returns {Promise<HDNodeWallet>}
   */
  async getEphemeralWallet(encryptionKey: string, index: number): Promise<HDNodeWallet> {
    const { mnemonic } = (await AbstractWallet.read(
      this.db,
      this.id,
      encryptionKey,
    )) as WalletData;
    return deriveEphemeralWallet(mnemonic, index);
  }

  /**
   * Get current ephemeral key index
   * @returns {Promise<number>}
   */
  async getEphemeralKeyIndex(): Promise<number> {
    try {
      const index = await this.db.get([this.id, 'ephemeral_index'], 'utf8');
      return parseInt(index as string, 10);
    } catch (err) {
      return 0;
    }
  }

  /**
   * Set ephemeral key index
   * @param {number} index - new index
   * @returns {Promise<void>}
   */
  async setEphemeralKeyIndex(index: number): Promise<void> {
    await this.db.put([this.id, 'ephemeral_index'], index.toString(), 'utf8');
  }

  /**
   * Get current ephemeral address
   * @param {string} encryptionKey - encryption key to use with database
   * @returns {Promise<string>}
   */
  async getCurrentEphemeralAddress(encryptionKey: string): Promise<string> {
    const index = await this.getEphemeralKeyIndex();
    const wallet = await this.getEphemeralWallet(encryptionKey, index);
    return wallet.address;
  }

  /**
   * Sign EIP-7702 Authorization and Execution Payload
   * @param {string} encryptionKey - encryption key to use with database
   * @param {string} contractAddress - RelayAdapt7702 contract address
   * @param {bigint} chainId - Chain ID
   * @param {(TransactionStructV2 | TransactionStructV3)[]} transactions - Railgun transactions
   * @param {RelayAdapt.ActionDataStruct} actionData - Action Data
   * @returns {Promise<{ authorization: Authorization; signature: string }>}
   */
  async sign7702Request(
    encryptionKey: string,
    contractAddress: string,
    chainId: bigint,
    transactions: (TransactionStructV2 | TransactionStructV3)[],
    actionData: RelayAdapt.ActionDataStruct,
    nonce: number = 0,
  ): Promise<{ authorization: Authorization; signature: string }> {
    const index = await this.getEphemeralKeyIndex();
    const ephemeralWallet = await this.getEphemeralWallet(encryptionKey, index);

    const authorization = await RelayAdapt7702Helper.signEIP7702Authorization(
      ephemeralWallet,
      contractAddress,
      chainId,
      nonce, // Nonce is always 0 for ephemeral keys, but can be reused if needed/desired.
    );

    const signature = await RelayAdapt7702Helper.signExecutionAuthorization(
      ephemeralWallet,
      transactions,
      actionData,
      chainId,
    );

    return { authorization, signature };
  }

  /**
   * Ratchet ephemeral key index
   * @returns {Promise<void>}
   */
  async ratchetEphemeralAddress(): Promise<void> {
    const index = await this.getEphemeralKeyIndex();
    await this.setEphemeralKeyIndex(index + 1);
  }

  /**
   * Load encrypted node from database with encryption key
   * @param {BytesData} encryptionKey
   * @returns {Node} BabyJubJub node
   */
  private async loadSpendingKey(encryptionKey: string): Promise<WalletNode> {
    const { mnemonic, index } = (await RailgunWallet.read(
      this.db,
      this.id,
      encryptionKey,
    )) as WalletData;
    return deriveNodes(mnemonic, index).spending;
  }

  /**
   * Helper to get the ethereum/whatever address is associated with this wallet
   */
  async getChainAddress(encryptionKey: string): Promise<string> {
    const { mnemonic, index } = (await AbstractWallet.read(
      this.db,
      this.id,
      encryptionKey,
    )) as WalletData;
    return Mnemonic.to0xAddress(mnemonic, index);
  }

  /**
   * Calculate Wallet ID from mnemonic and derivation path index
   * @returns {string} hash of mnemonic and index
   */
  private static generateID(mnemonic: string, index: number): string {
    return sha256(ByteUtils.combine([Mnemonic.toSeed(mnemonic), index.toString(16)]));
  }

  private static async createWallet(
    id: string,
    db: Database,
    mnemonic: string,
    index: number,
    creationBlockNumbers: Optional<number[][]>,
    prover: Prover,
  ) {
    const nodes = deriveNodes(mnemonic, index);

    const viewingKeyPair = await nodes.viewing.getViewingKeyPair();
    const spendingPublicKey = nodes.spending.getSpendingKeyPair().pubkey;
    return new RailgunWallet(
      id,
      db,
      viewingKeyPair,
      spendingPublicKey,
      creationBlockNumbers,
      prover,
    );
  }

  /**
   * Create a wallet from mnemonic
   * @param {Database} db - database
   * @param {BytesData} encryptionKey - encryption key to use with database
   * @param {string} mnemonic - mnemonic to load wallet from
   * @param {number} index - index of derivation path to derive if not 0
   * @returns {RailgunWallet} Wallet
   */
  static async fromMnemonic(
    db: Database,
    encryptionKey: string,
    mnemonic: string,
    index: number,
    creationBlockNumbers: Optional<number[][]>,
    prover: Prover,
  ): Promise<RailgunWallet> {
    const id = RailgunWallet.generateID(mnemonic, index);

    // Write encrypted mnemonic to DB
    await AbstractWallet.write(db, id, encryptionKey, { mnemonic, index, creationBlockNumbers });

    return this.createWallet(id, db, mnemonic, index, creationBlockNumbers, prover);
  }

  /**
   * Loads wallet data from database and creates wallet object
   * @param {Database} db - database
   * @param {BytesData} encryptionKey - encryption key to use with database
   * @param {string} id - wallet id
   * @returns {RailgunWallet} Wallet
   */
  static async loadExisting(
    db: Database,
    encryptionKey: string,
    id: string,
    prover: Prover,
  ): Promise<RailgunWallet> {
    // Get encrypted mnemonic and index from DB
    const { mnemonic, index, creationBlockNumbers } = (await AbstractWallet.read(
      db,
      id,
      encryptionKey,
    )) as WalletData;
    if (!mnemonic) {
      throw new Error('Incorrect wallet type.');
    }

    return this.createWallet(id, db, mnemonic, index, creationBlockNumbers, prover);
  }
}

export { RailgunWallet };
