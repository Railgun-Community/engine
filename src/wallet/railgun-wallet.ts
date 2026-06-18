import { Signature } from '@railgun-community/circomlibjs';
import { poseidon } from '../utils/poseidon';
import { Database } from '../database/database';
import { deriveNodes, SpendingKeyPair, WalletNode } from '../key-derivation/wallet-node';
import { WalletData } from '../models/wallet-types';
import { ByteUtils } from '../utils/bytes';
import { sha256 } from '../utils/hash';
import { AbstractWallet } from './abstract-wallet';
import { Mnemonic } from '../key-derivation/bip39';
import { PublicInputsRailgun } from '../models';
import { signEDDSA } from '../utils/keys-utils';
import { Prover } from '../prover/prover';

class RailgunWallet extends AbstractWallet {
  /**
   * Load encrypted spending key Node from database
   * Spending key should be kept private and only accessed on demand
   * @returns {Promise<SpendingKeyPair>}
   */
  async getSpendingKeyPair(
    encryptionKey: string,
    mnemonicPassword?: string,
  ): Promise<SpendingKeyPair> {
    const node = await this.loadSpendingKey(encryptionKey, mnemonicPassword);
    return node.getSpendingKeyPair();
  }

  async sign(
    publicInputs: PublicInputsRailgun,
    encryptionKey: string,
    mnemonicPassword?: string,
  ): Promise<Signature> {
    const spendingKeyPair = await this.getSpendingKeyPair(encryptionKey, mnemonicPassword);
    const msg = poseidon([publicInputs.merkleRoot, publicInputs.boundParamsHash, ...publicInputs.nullifiers, ...publicInputs.commitmentsOut]);
    return signEDDSA(spendingKeyPair.privateKey, msg);
  }

  /**
   * Load encrypted node from database with encryption key
   * @param {BytesData} encryptionKey
   * @returns {Node} BabyJubJub node
   */
  private async loadSpendingKey(
    encryptionKey: string,
    mnemonicPassword?: string,
  ): Promise<WalletNode> {
    const { mnemonic, index } = (await RailgunWallet.read(
      this.db,
      this.id,
      encryptionKey,
    )) as WalletData;
    RailgunWallet.assertMnemonicPasswordMatchesID(this.id, mnemonic, index, mnemonicPassword);
    return deriveNodes(mnemonic, index, mnemonicPassword).spending;
  }

  /**
   * Helper to get the ethereum/whatever address is associated with this wallet.
   * The BIP39 mnemonic password (if any) must be supplied; it is never stored.
   */
  async getChainAddress(encryptionKey: string, mnemonicPassword?: string): Promise<string> {
    const { mnemonic, index } = (await AbstractWallet.read(
      this.db,
      this.id,
      encryptionKey,
    )) as WalletData;
    RailgunWallet.assertMnemonicPasswordMatchesID(this.id, mnemonic, index, mnemonicPassword);
    return Mnemonic.to0xAddress(mnemonic, index, mnemonicPassword);
  }

  /**
   * Calculate Wallet ID from mnemonic and derivation path index
   * @returns {string} hash of mnemonic and index
   */
  private static generateID(
    mnemonic: string,
    index: number,
    mnemonicPassword: string = '',
  ): string {
    return sha256(
      ByteUtils.combine([Mnemonic.toSeed(mnemonic, mnemonicPassword), index.toString(16)]),
    );
  }

  /**
   * The BIP39 mnemonic password is never persisted; it must be supplied by the caller
   * on load and on every spend. Verify the supplied password reproduces this wallet's
   * ID — a mismatch means the wrong (or a missing) password was supplied, which would
   * otherwise silently derive a different, unrelated key. Fail loudly instead.
   */
  private static assertMnemonicPasswordMatchesID(
    id: string,
    mnemonic: string,
    index: number,
    mnemonicPassword: string = '',
  ): void {
    if (RailgunWallet.generateID(mnemonic, index, mnemonicPassword) !== id) {
      throw new Error('Incorrect mnemonic password for wallet.');
    }
  }

  private static async createWallet(
    id: string,
    db: Database,
    mnemonic: string,
    mnemonicPassword: string,
    index: number,
    creationBlockNumbers: Optional<number[][]>,
    prover: Prover,
  ) {
    const nodes = deriveNodes(mnemonic, index, mnemonicPassword);

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
    return this.fromMnemonicWithPassword(
      db,
      encryptionKey,
      mnemonic,
      '', // mnemonicPassword
      index,
      creationBlockNumbers,
      prover,
    );
  }

  /**
   * Create a wallet from mnemonic and BIP39 mnemonic password.
   */
  static async fromMnemonicWithPassword(
    db: Database,
    encryptionKey: string,
    mnemonic: string,
    mnemonicPassword: string,
    index: number,
    creationBlockNumbers: Optional<number[][]>,
    prover: Prover,
  ): Promise<RailgunWallet> {
    const id = RailgunWallet.generateID(mnemonic, index, mnemonicPassword);

    // Write encrypted mnemonic to DB. The BIP39 mnemonic password is intentionally NOT
    // persisted: storing it next to the mnemonic would defeat its purpose as a second
    // factor. The caller owns the password and must supply it on load and on spend.
    await AbstractWallet.write(db, id, encryptionKey, { mnemonic, index, creationBlockNumbers });

    return this.createWallet(
      id,
      db,
      mnemonic,
      mnemonicPassword,
      index,
      creationBlockNumbers,
      prover,
    );
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
    mnemonicPassword?: string,
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
    // The mnemonic password is not stored — the supplied one must reproduce this wallet's
    // ID. Verifying here turns a wrong/missing password into a clear error instead of
    // silently loading a different, unrelated wallet's keys.
    RailgunWallet.assertMnemonicPasswordMatchesID(id, mnemonic, index, mnemonicPassword);

    return this.createWallet(
      id,
      db,
      mnemonic,
      mnemonicPassword ?? '',
      index,
      creationBlockNumbers,
      prover,
    );
  }
}

export { RailgunWallet };
