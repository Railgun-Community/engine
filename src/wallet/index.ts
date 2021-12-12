import BN from 'bn.js';
import msgpack from 'msgpack-lite';
import type { AbstractBatch } from 'abstract-leveldown';
import { bytes, hash, babyjubjub } from '../utils';
import { Database } from '../database';
import { BIP32Node } from '../keyderivation';
import { mnemonicToSeed } from '../keyderivation/bip39';
import { BytesData } from '../utils/bytes';
import { ERC20Note } from '../note';
import type { MerkleTree, Commitment } from '../merkletree';

export type WalletDetails = {
  treeScannedHeights: number[],
  primaryHeight: number,
  changeHeight: number,
};

export type TXO = {
  tree: number,
  position: number,
  index: number,
  change: boolean,
  txid: string,
  spendtxid: string | false,
  note: ERC20Note,
};

export type Balances = {
  [ key: string ]: { // Key: Token
    balance: BN,
    utxos: TXO[],
  }
};

export type BalancesByTree = {
  [ key: string ]: { // Key: Token
    balance: BN,
    utxos: TXO[],
  }[] // Index = tree
};

class Wallet {
  private db: Database;

  readonly id: string;

  #encryptionKey: BytesData;

  #addressNode: BIP32Node;

  #changeNode: BIP32Node;

  readonly gapLimit: number;

  readonly merkletree: MerkleTree[] = [];

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
    gapLimit: number,
  ) {
    this.db = db;
    this.#encryptionKey = encryptionKey;
    this.gapLimit = gapLimit;

    // Calculate ID
    this.id = hash.sha256(bytes.combine([
      mnemonicToSeed(mnemonic),
      bytes.fromUTF8String(derivationPath),
    ]));

    this.#addressNode = BIP32Node.fromMnemonic(mnemonic).derive(`${derivationPath}/0'`);
    this.#changeNode = BIP32Node.fromMnemonic(mnemonic).derive(`${derivationPath}/1'`);

    // Write encrypted mnemonic to DB
    this.db.putEncrypted([
      bytes.fromUTF8String('wallet'),
      this.id,
    ], encryptionKey, msgpack.encode({
      mnemonic,
      derivationPath,
    }));
  }

  /**
   * Loads merkle tree into wallet
   * @param merkletree - merkletree to load
   */
  loadTree(merkletree: MerkleTree) {
    this.merkletree[merkletree.chainID] = merkletree;
  }

  /**
   * Unload merkle tree by chainID
   * @param chainID - chainID of tree to unload
   */
  unloadTree(chainID: number) {
    delete this.merkletree[chainID];
  }

  /**
   * Construct DB path from chainID
   * @param chainID - chainID
   * @returns wallet DB prefix
   */
  getWalletDBPrefix(chainID: number): string[] {
    return [
      bytes.fromUTF8String('wallet'),
      bytes.hexlify(this.id),
      bytes.hexlify(new BN(chainID)),
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
  getKeypair(
    encryptionKey: BytesData,
    index: number,
    change: boolean,
    chainID: number | undefined = undefined,
  ) {
    if (bytes.hexlify(encryptionKey) !== bytes.hexlify(this.#encryptionKey)) {
      throw new Error('Wrong encryption key');
    }

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
    return this.getKeypair(this.#encryptionKey, index, change, chainID).address;
  }

  /**
   * Gets wallet details for this wallet
   */
  async getWalletDetails(): Promise<WalletDetails> {
    let walletDetails: WalletDetails;

    try {
      // Try fetching from database
      walletDetails = msgpack.decode(
        bytes.arrayify(
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
   * @param leaves - sparse array of commitments to scan
   * Commitment index in array should be same as commitment index in tree
   * @param tree - tree number we're scanning
   * @param chainID - chainID we're scanning
   */
  private async scanIndex(
    index: number,
    change: boolean,
    leaves: Commitment[],
    tree: number,
    chainID: number,
  ): Promise<boolean> {
    // Derive keypair
    const key = this.getKeypair(this.#encryptionKey, index, change);

    const writeBatch: AbstractBatch[] = [];

    // Loop through passed commitments
    leaves.forEach((leaf, position) => {
      let note: ERC20Note;

      if ('ciphertext' in leaf) {
        // Derive shared secret
        const sharedKey = babyjubjub.ecdh(
          key.privateKey,
          leaf.senderPublicKey,
        );

        // Decrypt
        note = ERC20Note.decrypt(leaf.ciphertext, sharedKey);
      } else {
        // Deserialize
        note = ERC20Note.deserialize(leaf.data);
      }

      // If this note is addressed to us add to write queue
      if (note.publicKey === key.publicKey) {
        writeBatch.push({
          type: 'put',
          key: [
            ...this.getWalletDBPrefix(chainID),
            bytes.hexlify(bytes.padToLength(new BN(tree), 32)),
            bytes.hexlify(bytes.padToLength(new BN(position), 32)),
          ].join(':'),
          value: msgpack.encode({
            index,
            change,
            spendtxid: false,
            txid: bytes.hexlify(leaf.txid),
            nullifier: ERC20Note.getNullifier(
              key.privateKey,
              tree,
              position,
            ),
            decrypted: note.serialize(),
          }),
        });
      }
    });

    // Write to DB
    await this.db.batch(writeBatch);

    // Return if we found any leaves we could decrypt
    return writeBatch.length > 0;
  }

  /**
   * Get TXOs list of a chain
   * @param chainID - chainID to get UTXOs for
   * @returns UTXOs list
   */
  async TXOs(chainID: number): Promise<TXO[]> {
    // Get chain namespace
    const namespace = this.getWalletDBPrefix(chainID);

    // Stream list of keys out
    const keys: string[] = await new Promise((resolve) => {
      const keyList: string[] = [];

      // Stream list of keys and resolve on end
      this.db.streamNamespace(namespace).on('data', (key) => {
        keyList.push(key);
      }).on('end', () => {
        resolve(keyList);
      });
    });

    // Calculate UTXOs
    return Promise.all(keys.map(async (key) => {
      // Split key into path components
      const keySplit = key.split(':');

      // Decode UTXO
      const UTXO = msgpack.decode(bytes.arrayify(await this.db.get((keySplit))));

      // If this UTXO hasn't already been marked as spent, check if it has
      if (!UTXO.spendtxid) {
        // Get nullifier
        const nullifierTX = await this.merkletree[chainID].getNullified(UTXO.nullifier);

        // If it's nullified write spend txid to wallet storage
        if (nullifierTX) {
          UTXO.spendtxid = nullifierTX;

          // Write nullifier spend txid to db
          await this.db.put(keySplit, msgpack.encode(UTXO));
        }
      }

      const tree = bytes.numberify(keySplit[3]).toNumber();
      const position = bytes.numberify(keySplit[4]).toNumber();

      return {
        tree,
        position,
        index: UTXO.index,
        change: UTXO.change,
        txid: UTXO.txid,
        spendtxid: UTXO.spendtxid,
        note: ERC20Note.deserialize(UTXO.decrypted),
      };
    }));
  }

  /**
   * Gets wallet balances
   * @param chainID - chainID to get balances for
   * @returns balances
   */
  async balances(chainID: number): Promise<Balances> {
    const TXOs = await this.TXOs(chainID);
    const balances: Balances = {};

    // Loop through each TXO and add to balances if unspent
    TXOs.forEach((txOutput) => {
      // If we don't have an entry for this token yet, create one
      if (!balances[txOutput.note.token]) {
        balances[txOutput.note.token] = {
          balance: new BN(0),
          utxos: [],
        };
      }

      // If txOutput is unspent process it
      if (!txOutput.spendtxid) {
        // Store txo
        balances[txOutput.note.token].utxos.push(txOutput);

        // Increment balance
        balances[txOutput.note.token].balance.iadd(
          bytes.numberify(txOutput.note.amount),
        );
      }
    });

    return balances;
  }

  /**
   * Sort token balances by tree
   * @param chainID - chainID of token
   * @returns balances by tree
   */
  async balancesByTree(chainID: number): Promise<BalancesByTree> {
    // Fetch balances
    const balances = await this.balances(chainID);

    // Sort token balances by tree
    const balancesByTree: BalancesByTree = {};

    // Loop through each token
    Object.keys(balances).forEach((token) => {
      // Create balances tree array
      balancesByTree[token] = [];

      // Loop through each UTXO and sort by ree
      balances[token].utxos.forEach((utxo) => {
        if (!balancesByTree[token][utxo.tree]) {
          balancesByTree[token][utxo.tree] = {
            balance: bytes.numberify(utxo.note.amount),
            utxos: [utxo],
          };
        } else {
          balancesByTree[token][utxo.tree].balance.iadd(bytes.numberify(utxo.note.amount));
          balancesByTree[token][utxo.tree].utxos.push(utxo);
        }
      });
    });

    return balancesByTree;
  }

  /**
   * Scan leaves for balances
   * @param leaves - sparse array of commitments to scan
   * Commitment index in array should be same as commitment index in tree
   * @param change - Whether to scan primary or change indexes
   * @param initialHeight - address height to start scanning at
   * @param tree- tree number we're scanning
   * @param chainID - chainID of leaves to scan
   * @returns New address height
   */
  private async scanLeaves(
    leaves: Commitment[],
    change: boolean,
    initialHeight: number,
    tree: number,
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
          usedIndexes[index] = this.scanIndex(index, change, leaves, tree, chainID);
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
   * @param chainID - chainID to scan
   */
  async scan(chainID: number) {
    // Don't proceed if scan write is locked
    if (this.scanLock) return;

    // Lock
    this.scanLock = true;

    // Fetch wallet details
    const walletDetails = await this.getWalletDetails();

    // Refresh list of trees
    while (
      // eslint-disable-next-line no-await-in-loop
      await this.merkletree[chainID].getTreeLength(walletDetails.treeScannedHeights.length) !== 0
    ) {
      // Instantiate new trees in wallet data until we encounter a tree with tree length 0
      walletDetails.treeScannedHeights[walletDetails.treeScannedHeights.length] = 0;
    }

    // Loop through each tree and scan
    for (let tree = 0; tree < walletDetails.treeScannedHeights.length; tree += 1) {
      // Get scanned height
      const scannedHeight = walletDetails.treeScannedHeights[tree];

      // Create sparse array of tree
      // eslint-disable-next-line no-await-in-loop
      const fetcher = new Array(await this.merkletree[chainID].getTreeLength(tree));

      // Fetch each leaf we need to scan
      for (let index = scannedHeight; index < fetcher.length; index += 1) {
        fetcher[index] = this.merkletree[chainID].getCommitment(tree, index);
      }

      // Wait till all leaves are fetched
      // eslint-disable-next-line no-await-in-loop
      const leaves = await Promise.all(fetcher);

      // Delete undefined values and return sparse array
      leaves.forEach((value, index) => {
        if (value === undefined) delete leaves[index];
      });

      // Start scanning primary and change
      const primaryHeight = this.scanLeaves(
        leaves,
        false,
        walletDetails.primaryHeight,
        tree,
        this.merkletree[chainID].chainID,
      );
      const changeHeight = this.scanLeaves(
        leaves,
        true,
        walletDetails.primaryHeight,
        tree,
        this.merkletree[chainID].chainID,
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
    gapLimit: number = 5,
  ): Promise<Wallet> {
    // Calculate ID
    const id = hash.sha256(bytes.combine([
      mnemonicToSeed(mnemonic),
      bytes.fromUTF8String(derivationPath),
    ]));

    // Write encrypted mnemonic to DB
    db.putEncrypted([
      bytes.fromUTF8String('wallet'),
      msgpack.encode({
        id,
        derivationPath,
      }),
    ], encryptionKey, mnemonic);

    // Create wallet object and return
    return new Wallet(db, encryptionKey, mnemonic, derivationPath, gapLimit);
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
    gapLimit: number = 5,
  ): Promise<Wallet> {
    // Get encrypted mnemonic and derivation path from DB
    const { mnemonic, derivationPath } = msgpack.decode(
      bytes.arrayify(
        await db.getEncrypted([
          bytes.fromUTF8String('wallet'),
          id,
        ], encryptionKey),
      ),
    );

    // Create wallet object and return
    return new Wallet(db, encryptionKey, mnemonic, derivationPath, gapLimit);
  }
}

export { Wallet };
