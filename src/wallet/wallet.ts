import { HDNode, mnemonicToSeed } from '@ethersproject/hdnode';
import { Database } from '../database';
import { WalletNode } from '../keyderivation';
import { deriveNodes, SpendingKeyPair } from '../keyderivation/wallet-node';
import { BytesData } from '../models/formatted-types';
import { hash } from '../utils';
import { combine } from '../utils/bytes';
import { AbstractWallet, WalletData } from './abstract-wallet';

class Wallet extends AbstractWallet {
  /**
   * Load encrypted spending key Node from database
   * Spending key should be kept private and only accessed on demand
   * @returns {Promise<SpendingKeyPair>}
   */
  async getSpendingKeyPair(encryptionKey: BytesData): Promise<SpendingKeyPair> {
    const node = await this.loadSpendingKey(encryptionKey);
    return node.getSpendingKeyPair();
  }

  /**
   * Load encrypted node from database with encryption key
   * @param {BytesData} encryptionKey
   * @returns {Node} BabyJubJub node
   */
  private async loadSpendingKey(encryptionKey: BytesData): Promise<WalletNode> {
    const { mnemonic, index } = (await Wallet.read(this.db, this.id, encryptionKey)) as WalletData;
    return deriveNodes(mnemonic, index).spending;
  }

  /**
   * Helper to get the ethereum/whatever address is associated with this wallet
   */
  async getChainAddress(encryptionKey: BytesData): Promise<string> {
    const { mnemonic, index } = (await AbstractWallet.read(
      this.db,
      this.id,
      encryptionKey,
    )) as WalletData;
    const path = `m/44'/60'/0'/0/${index}`;
    const hdnode = HDNode.fromMnemonic(mnemonic).derivePath(path);
    return hdnode.address;
  }

  /**
   * Calculate Wallet ID from mnemonic and derivation path index
   * @returns {string} hash of mnemonic and index
   */
  private static generateID(mnemonic: string, index: number): string {
    return hash.sha256(combine([mnemonicToSeed(mnemonic), index.toString(16)]));
  }

  private static async createWallet(id: string, db: Database, mnemonic: string, index: number) {
    const nodes = deriveNodes(mnemonic, index);

    const viewingKeyPair = await nodes.viewing.getViewingKeyPair();
    const spendingPublicKey = nodes.spending.getSpendingKeyPair().pubkey;
    return new Wallet(id, db, viewingKeyPair, spendingPublicKey);
  }

  /**
   * Create a wallet from mnemonic
   * @param {Database} db - database
   * @param {BytesData} encryptionKey - encryption key to use with database
   * @param {string} mnemonic - mnemonic to load wallet from
   * @param {number} index - index of derivation path to derive if not 0
   * @returns {Wallet} Wallet
   */
  static async fromMnemonic(
    db: Database,
    encryptionKey: BytesData,
    mnemonic: string,
    index: number = 0,
  ): Promise<Wallet> {
    const id = Wallet.generateID(mnemonic, index);

    // Write encrypted mnemonic to DB
    await AbstractWallet.write(db, id, encryptionKey, { mnemonic, index });

    return this.createWallet(id, db, mnemonic, index);
  }

  /**
   * Loads wallet data from database and creates wallet object
   * @param {Database} db - database
   * @param {BytesData} encryptionKey - encryption key to use with database
   * @param {string} id - wallet id
   * @returns {Wallet} Wallet
   */
  static async loadExisting(db: Database, encryptionKey: BytesData, id: string): Promise<Wallet> {
    // Get encrypted mnemonic and index from DB
    const { mnemonic, index } = (await AbstractWallet.read(db, id, encryptionKey)) as WalletData;
    if (!mnemonic) {
      throw new Error('Incorrect wallet type.');
    }

    return this.createWallet(id, db, mnemonic, index);
  }
}

export { Wallet };
