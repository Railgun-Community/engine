import BN from 'bn.js';
import msgpack from 'msgpack-lite';
import utils from '../utils';
import Database from '../database';
import keyderivation from '../keyderivation';
import bip39 from '../keyderivation/bip39';
import { BytesData } from '../utils/bytes';
import Note from '../note';
import type BIP32Node from '../keyderivation';
import type MerkleTree from '../merkletree';
import type { Commitment } from '../merkletree';

export type WalletDetails = {
  treeScannedHeights: number[],
  primaryHeight: number,
  changeHeight: number,
};

class Wallet {
  db: Database;

  id: string;

  #encryptionKey: BytesData;

  #addressNode: BIP32Node;

  #changeNode: BIP32Node;

  gapLimit: number;

  // Lock scanning operations to prevent race conditions
  private scanLock = false;

  /**
   * Create Wallet controller
   * @param db - database
   * @param merkletree - merkle tree to use
   * @param id - wallet ID
   * @param encryptionKey - database encryption key
   */
  constructor(
    db: Database,
    encryptionKey: BytesData,
    mnemonic: string,
    derivationPath: string,
    gapLimit: number = 5,
  ) {
    this.db = db;
    this.#encryptionKey = encryptionKey;
    this.gapLimit = gapLimit;

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
      utils.bytes.fromUTF8String('wallet'),
      utils.bytes.hexlify(this.id),
      utils.bytes.hexlify(new BN(chainID)),
    ].map((element) => element.padStart(64, '0'));
  }

  /**
   * Construct DB path from chainID
   * @returns wallet DB path
   */
  getWalletDetailsPath(): string[] {
    return this.getWalletDBPrefix(0);
  }

  /**
   * Get keypair at index
   * @param index - index to get keypair at
   * @param change - get change keypair
   * @param chainID - chainID for keypair
   * @returns keypair
   */
  #getKeypair(
    index: number,
    change: boolean,
    chainID: number | undefined = undefined,
  ) {
    if (change) {
      return this.#changeNode.derive(`m/${index}'`).getBabyJubJubKey(chainID);
    }
    return this.#addressNode.derive(`m/${index}'`).getBabyJubJubKey(chainID);
  }

  /**
   * Get Address at index
   * @param index - index to get address at
   * @param change - get change address
   * @param chainID - chainID for address
   * @returns address
   */
  getAddress(
    index: number,
    change: boolean,
    chainID: number | undefined = undefined,
  ): string {
    return this.#getKeypair(index, change, chainID).address;
  }

  /**
   * Gets wallet details for this wallet
   */
  async getWalletDetails(): Promise<WalletDetails> {
    let walletDetails: WalletDetails;

    try {
      // Try fetching from database
      walletDetails = msgpack.decode(
        utils.bytes.arrayify(
          await this.db.getEncrypted(
            this.getWalletDetailsPath(),
            this.#encryptionKey,
          ),
        ),
      );
    } catch {
      // If details don't exist yet, return defaults
      walletDetails = {
        treeScannedHeights: [],
        primaryHeight: 0,
        changeHeight: 0,
      };
    }

    return walletDetails;
  }

  /**
   * Gets list of addresses for use in UI
   * @param chainID - chainID to get addresses for
   */
  async addresses(chainID: number): Promise<string[]> {
    // Fetch wallet details for this chain
    const walletDetails = await this.getWalletDetails();

    // Derive addresses up to gas limit
    return new Array(this.gapLimit).fill(0).map(
      (value, index) => this.getAddress(walletDetails.primaryHeight + index, false, chainID),
    );
  }

  /**
   * Scans wallet at index for new balances
   * @param index - index of address to scan
   * @param change - whether we're scanning the change address
   * @param commitments - sparse array of commitments to scan
   * Commitment index in array should be same as commitment index in tree
   */
  private async scanIndex(
    index: number,
    change: boolean,
    commitments: Commitment[],
    chainID: number,
  ): Promise<boolean> {
    // Derive keypair
    const key = this.#getKeypair(index, change);

    // Loop through passed commitments
    const scannedCommitments = commitments.map((commitment) => {
      // Derive shared secret
      const sharedKey = utils.babyjubjub.ecdh(
        key.privateKey,
        commitment.senderPublicKey,
      );

      // Decrypt
      const note = Note.ERC20.decrypt(commitment.ciphertext, sharedKey);

      // Return if this note is addressed to us
      return note.publicKey === key.publicKey;
    });

    console.log(chainID);

    return scannedCommitments.includes(true);
  }

  /**
   * Scan leaves for balances
   * @param leaves - sparse array of commitments to scan
   * Commitment index in array should be same as commitment index in tree
   * @param change - Whether to scan primary or change indexes
   * @param initialHeight - address height to start scanning at
   * @param chainID - chainID of leaves to scan
   * @returns New address height
   */
  private async scanLeaves(
    leaves: Commitment[],
    change: boolean,
    initialHeight: number,
    chainID: number,
  ): Promise<number> {
    // Start at initial height
    let height = initialHeight;

    // Create sparse array of length height
    let usedIndexes: (Promise<boolean> | boolean)[] = [];

    while (usedIndexes.length < height + this.gapLimit) {
      // Loop through each index that needs to be scanned
      for (let index = 0; index <= height + this.gapLimit; index += 1) {
        // If this index hasn't been scanned yet, scan
        if (!usedIndexes[index]) {
          // Start scan for this index
          usedIndexes[index] = this.scanIndex(index, change, leaves, chainID);
        }
      }

      // Wait till all wallets in this iteration have been scanned
      // eslint-disable-next-line no-await-in-loop
      usedIndexes = await Promise.all(usedIndexes);

      // Update the wallet height the the highest index with a detected note
      height = usedIndexes.lastIndexOf(true);
    }

    // Return new height
    return height;
  }

  /**
   * Scans for new balances
   * @param merkletree - merkletree to scan
   */
  async scan(merkletree: MerkleTree) {
    // Don't proceed if scan write is locked
    if (this.scanLock) return;

    // Lock
    this.scanLock = true;

    // Fetch wallet details
    const walletDetails = await this.getWalletDetails();

    // Refresh list of trees
    // eslint-disable-next-line no-await-in-loop
    while (await merkletree.getTreeLength(walletDetails.treeScannedHeights.length) !== 0) {
      // Instantiate new trees in wallet data until we encounter a tree with tree length 0
      walletDetails.treeScannedHeights[walletDetails.treeScannedHeights.length] = 0;
    }

    // Loop through each tree and scan
    for (let tree = 0; tree < walletDetails.treeScannedHeights.length; tree += 1) {
      // Get scanned height
      const scannedHeight = walletDetails.treeScannedHeights[tree];

      // Create sparse array of tree
      // eslint-disable-next-line no-await-in-loop
      const fetcher = new Array(await merkletree.getTreeLength(tree));

      // Fetch each leaf we need to scan
      for (let index = scannedHeight; index < fetcher.length; index += 1) {
        fetcher[index] = merkletree.getCommitment(tree, index);
      }

      // Wait till all leaves are fetched
      // eslint-disable-next-line no-await-in-loop
      const leaves = await Promise.all(fetcher);

      // Start scanning primary and change
      const primaryHeight = this.scanLeaves(
        leaves,
        false,
        walletDetails.primaryHeight,
        merkletree.chainID,
      );
      const changeHeight = this.scanLeaves(
        leaves,
        true,
        walletDetails.primaryHeight,
        merkletree.chainID,
      );

      // Set new height values
      // eslint-disable-next-line no-await-in-loop
      walletDetails.primaryHeight = await primaryHeight;
      // eslint-disable-next-line no-await-in-loop
      walletDetails.changeHeight = await changeHeight;

      // Commit new scanned height
      walletDetails.treeScannedHeights[tree] = leaves.length - 1;
    }

    // Write wallet details to db
    await this.db.putEncrypted(
      this.getWalletDetailsPath(),
      this.#encryptionKey,
      msgpack.encode(walletDetails),
    );

    // Release lock
    this.scanLock = false;
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
