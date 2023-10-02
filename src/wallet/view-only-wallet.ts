import { Signature } from 'circomlibjs';
import { Database } from '../database/database';
import { ViewingKeyPair } from '../key-derivation/wallet-node';
import { PublicInputsRailgun } from '../models';
import { ViewOnlyWalletData } from '../models/wallet-types';
import { hexStringToBytes } from '../utils/bytes';
import { sha256 } from '../utils/hash';
import { getPublicViewingKey } from '../utils/keys-utils';
import { AbstractWallet } from './abstract-wallet';
import { Prover } from '../prover/prover';

class ViewOnlyWallet extends AbstractWallet {
  // eslint-disable-next-line class-methods-use-this, @typescript-eslint/no-unused-vars
  sign(_publicInputs: PublicInputsRailgun, _encryptionKey: string): Promise<Signature> {
    throw new Error('View-Only wallet cannot generate signatures.');
  }

  /**
   * Calculate Wallet ID from mnemonic and derivation path index
   * @returns {string} hash of mnemonic and index
   */
  private static generateID(shareableViewingKey: string): string {
    return sha256(shareableViewingKey);
  }

  private static async getViewingKeyPair(viewingPrivateKey: string): Promise<ViewingKeyPair> {
    const vpk = hexStringToBytes(viewingPrivateKey);
    return {
      privateKey: vpk,
      pubkey: await getPublicViewingKey(vpk),
    };
  }

  private static async createWallet(
    id: string,
    db: Database,
    shareableViewingKey: string,
    creationBlockNumbers: Optional<number[][]>,
    prover: Prover,
  ) {
    const { viewingPrivateKey, spendingPublicKey } =
      AbstractWallet.getKeysFromShareableViewingKey(shareableViewingKey);
    const viewingKeyPair: ViewingKeyPair = await ViewOnlyWallet.getViewingKeyPair(
      viewingPrivateKey,
    );
    return new ViewOnlyWallet(
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
   * @param {string} shareableViewingKey - encoded keys to load wallet from
   * @returns {Wallet} Wallet
   */
  static async fromShareableViewingKey(
    db: Database,
    encryptionKey: string,
    shareableViewingKey: string,
    creationBlockNumbers: Optional<number[][]>,
    prover: Prover,
  ): Promise<AbstractWallet> {
    const id = ViewOnlyWallet.generateID(shareableViewingKey);

    // Write encrypted shareableViewingKey to DB
    await AbstractWallet.write(db, id, encryptionKey, {
      shareableViewingKey,
      creationBlockNumbers,
    });

    return this.createWallet(id, db, shareableViewingKey, creationBlockNumbers, prover);
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
    encryptionKey: string,
    id: string,
    prover: Prover,
  ): Promise<AbstractWallet> {
    // Get encrypted shareableViewingKey from DB
    const { shareableViewingKey, creationBlockNumbers } = (await AbstractWallet.read(
      db,
      id,
      encryptionKey,
    )) as ViewOnlyWalletData;
    if (!shareableViewingKey) {
      throw new Error(
        'Incorrect wallet type: ViewOnly wallet requires stored shareableViewingKey.',
      );
    }

    return this.createWallet(id, db, shareableViewingKey, creationBlockNumbers, prover);
  }
}

export { ViewOnlyWallet };
