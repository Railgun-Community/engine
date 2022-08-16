import { Database } from '../database';
import { ViewingKeyPair } from '../keyderivation/wallet-node';
import { BytesData } from '../models/formatted-types';
import { ViewOnlyWalletData } from '../models/wallet-types';
import { hash, keysUtils } from '../utils';
import { combine, hexStringToBytes } from '../utils/bytes';
import { AbstractWallet } from './abstract-wallet';

class ViewOnlyWallet extends AbstractWallet {
  /**
   * Calculate Wallet ID from mnemonic and derivation path index
   * @returns {string} hash of mnemonic and index
   */
  private static generateID(vpk: string, index: number): string {
    return hash.sha256(combine([vpk, index.toString(16)]));
  }

  private static async getViewingKeyPair(viewingPrivateKey: string): Promise<ViewingKeyPair> {
    const vpk = hexStringToBytes(viewingPrivateKey);
    return {
      privateKey: vpk,
      pubkey: await keysUtils.getPublicViewingKey(vpk),
    };
  }

  private static async createWallet(id: string, db: Database, shareableViewingKey: string) {
    const { viewingPrivateKey, spendingPublicKey } =
      AbstractWallet.getKeysFromShareableViewingKey(shareableViewingKey);
    const viewingKeyPair: ViewingKeyPair = await ViewOnlyWallet.getViewingKeyPair(
      viewingPrivateKey,
    );
    return new ViewOnlyWallet(id, db, viewingKeyPair, spendingPublicKey);
  }

  /**
   * Create a wallet from mnemonic
   * @param {Database} db - database
   * @param {BytesData} encryptionKey - encryption key to use with database
   * @param {string} viewingPrivateKey - vpk to load wallet from
   * @param {number} index - index of derivation path to derive if not 0
   * @returns {Wallet} Wallet
   */
  static async fromShareableViewingKey(
    db: Database,
    encryptionKey: BytesData,
    shareableViewingKey: string,
    index: number = 0,
  ): Promise<AbstractWallet> {
    const id = ViewOnlyWallet.generateID(shareableViewingKey, index);

    // Write encrypted shareableViewingKey to DB
    await AbstractWallet.write(db, id, encryptionKey, { shareableViewingKey });

    return this.createWallet(id, db, shareableViewingKey);
  }

  /**
   * Loads wallet data from database and creates wallet object
   * @param {Database} db - database
   * @param {BytesData} encryptionKey - encryption key to use with database
   * @param {string} id - wallet id
   * @returns {Wallet} Wallet
   */
  static async loadExisting(
    db: Database,
    encryptionKey: BytesData,
    id: string,
  ): Promise<AbstractWallet> {
    // Get encrypted shareableViewingKey from DB
    const { shareableViewingKey } = (await AbstractWallet.read(
      db,
      id,
      encryptionKey,
    )) as ViewOnlyWalletData;
    if (!shareableViewingKey) {
      throw new Error(
        'Incorrect wallet type: ViewOnly wallet requires stored shareableViewingKey.',
      );
    }

    return this.createWallet(id, db, shareableViewingKey);
  }
}

export { ViewOnlyWallet };
