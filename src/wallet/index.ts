import BN from 'bn.js';
import msgpack from 'msgpack-lite';
import utils from '../utils';
import Database from '../database';
import keyderivation from '../keyderivation';
import bip39 from '../keyderivation/bip39';
import { BytesData } from '../utils/bytes';
import type BIP32Node from '../keyderivation';

class Wallet {
  db: Database;

  id: string;

  #encryptionKey: BytesData;

  #addressNode: BIP32Node;

  #changeNode: BIP32Node;

  /**
   * Create Wallet controller
   * @param db - database
   * @param id - wallet ID
   * @param encryptionKey - database encryption key
   */
  constructor(
    db: Database,
    encryptionKey: BytesData,
    mnemonic: string,
    derivationPath: string,
  ) {
    this.db = db;
    this.#encryptionKey = encryptionKey;

    // Calculate ID
    this.id = utils.hash.sha256(utils.bytes.combine([
      bip39.mnemonicToSeed(mnemonic),
      utils.bytes.fromUTF8String(derivationPath),
    ]));

    this.#addressNode = keyderivation.fromMnemonic(mnemonic).derive(`${derivationPath}/0'`);
    this.#changeNode = keyderivation.fromMnemonic(mnemonic).derive(`${derivationPath}/1'`);

    // Write encrypted mnemonic to DB
    this.db.putEncrypted([
      utils.bytes.fromUTF8String('wallet'),
      this.id,
    ], encryptionKey, msgpack.encode({
      mnemonic,
      derivationPath,
    }));
  }

  /**
   * Construct DB path from chainID
   * @param chainID - chainID
   * @returns wallet DB prefix
   */
  getWalletDBPrefix(chainID: number): string[] {
    return [
      utils.bytes.hexlify(new BN(chainID)),
      utils.bytes.fromUTF8String('wallet'),
      utils.bytes.hexlify(this.id),
    ].map((element) => element.padStart(64, '0'));
  }

  /**
   * Get Address at index
   * @param index - index to get address at
   * @returns addresses
   */
  getAddress(index: number, chainID: number | undefined = undefined): string {
    const keypair = this.#addressNode.derive(`m/${index}'`).getBabyJubJubKey(chainID);
    return keypair.publicKey;
  }

  /**
   * Create a wallet from mnemonic
   * @param db - database
   * @param encryptionKey - encryption key to use with database
   * @param mnemonic - mnemonic to load wallet from
   * @param derivationPath - wallet derivation path
   * @returns Wallet
   */
  static async fromMnemonic(
    db: Database,
    encryptionKey: BytesData,
    mnemonic: string,
    derivationPath: string = "m/1984'/0'/0'",
  ): Promise<Wallet> {
    // Calculate ID
    const id = utils.hash.sha256(utils.bytes.combine([
      bip39.mnemonicToSeed(mnemonic),
      utils.bytes.fromUTF8String(derivationPath),
    ]));

    // Write encrypted mnemonic to DB
    db.putEncrypted([
      utils.bytes.fromUTF8String('wallet'),
      msgpack.encode({
        id,
        derivationPath,
      }),
    ], encryptionKey, mnemonic);

    // Create wallet object and return
    return new Wallet(db, encryptionKey, mnemonic, derivationPath);
  }

  /**
   * Loads wallet data from database and creates wallet object
   * @param db - database
   * @param encryptionKey - encryption key to use with database
   * @param id - wallet id
   * @returns Wallet
   */
  static async loadExisting(
    db: Database,
    encryptionKey: BytesData,
    id: BytesData,
  ): Promise<Wallet> {
    // Get encrypted mnemonic and derivation path from DB
    const { mnemonic, derivationPath } = msgpack.decode(
      utils.bytes.arrayify(
        await db.getEncrypted([
          utils.bytes.fromUTF8String('wallet'),
          id,
        ], encryptionKey),
      ),
    );

    // Create wallet object and return
    return new Wallet(db, encryptionKey, mnemonic, derivationPath);
  }
}

export default Wallet;
