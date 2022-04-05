import BN from 'bn.js';
import msgpack from 'msgpack-lite';
import EventEmitter from 'events';
import type { AbstractBatch } from 'abstract-leveldown';
import { bytes, hash } from '../utils';
import { Database } from '../database';
import { mnemonicToSeed } from '../keyderivation/bip39';
import { Note } from '../note';
import type { MerkleTree, } from '../merkletree';
import { LeptonDebugger } from '../models/types';
import { Node } from '../keyderivation/bip32';

export type WalletDetails = {
  treeScannedHeights: number[];
};

export type TXO = {
  tree: number;
  position: number;
  index: number;
  change: boolean;
  txid: string;
  spendtxid: string | false;
  dummyKey?: string; // For dummy notes
  note: Note;
};

export type Balances = {
  [key: string]: {
    // Key: Token
    balance: BN;
    utxos: TXO[];
  };
};

export type BalancesByTree = {
  [key: string]: {
    // Key: Token
    balance: BN;
    utxos: TXO[];
  }[]; // Index = tree
};

export type ScannedEventData = {
  chainID: number;
};

export type WalletData = { mnemonic: string, index: number };
/**
 * constant defining the derivation path prefixes for spending and viewing keys
 * must be appended with index' to form a complete path
 */
const DERIVATION_PATH_PREFIXES = {
  SPENDING: "m/44'/1984'/0'/0'/",
  VIEWING: "m/420'/1984'/0'/0'/",
}

/**
 * Helper to append DERIVATION_PATH_PREFIXES with index'
 */
function derivePathsForIndex(index: number = 0) {
  return {
    spending: `${DERIVATION_PATH_PREFIXES.SPENDING}${index}'`,
    viewing: `${DERIVATION_PATH_PREFIXES.VIEWING}${index}'`,
  }
}

function deriveNodes(mnemonic: string, index: number = 0) {
  const paths = derivePathsForIndex(index);
  return {
    spendingKey: Node.fromMnemonic(mnemonic).derive(paths.spending),
    viewingKey: Node.fromMnemonic(mnemonic).derive(paths.viewing)
  }
}

class Wallet extends EventEmitter {
  private db: Database;

  readonly id: string;

  #viewingKey: Node;

  readonly spendingPublicKey: string;

  readonly merkletree: MerkleTree[] = [];

  readonly leptonDebugger: LeptonDebugger | undefined;


  // Lock scanning operations to prevent race conditions
  private scanLockPerChain: boolean[] = [];

  /**
   * Create Wallet controller
   * @param db - database
   * @param merkletree - merkle tree to use
   * @param id - wallet ID
   * @param encryptionKey - database encryption key
   */
  constructor(
    id: string,
    db: Database,
    spendingKey: Node,
    viewingKey: Node,
  ) {
    super();
    this.id = id;
    this.db = db;

    this.spendingPublicKey = spendingKey.babyJubJubKeyPair.pubkey;
    this.#viewingKey = viewingKey;
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
  getWalletDetailsPath(chainID: number): string[] {
    return this.getWalletDBPrefix(chainID);
  }

  /**
   * Sign message with ed25519 node derived at path index
   * @param message - hex or Uint8 bytes of message to sign
   * @param index - index to get keypair at
   * @returns Promise<Uint8Array>
   */
  async signEd25519(message: string | Uint8Array) {
    return await this.#viewingKey.signEd25519(message);
  }

  /**
   * Get public key from ed25519 node at index
   * @param index - index to get keypair at
   * @returns Promise<Uint8Array>
   */
  async getSigningPublicKey(): Promise<string> {
    return await this.#viewingKey.getViewingPublicKey();
  }

  /**
   * Load encrypted spending key Node from database and return babyjubjub private key
   * @returns Promise<String>
   */
  async getSpendingPrivateKey(encryptionKey: bytes.BytesData): Promise<string> {
    const node = await this.loadSpendingKey(encryptionKey);
    return node.babyJubJubKeyPair.privateKey;
  }

  /**
   * Get Address at index
   * @param index - index to get address at
   * @param change - get change address
   * @param chainID - chainID for address
   * @returns address
   * @todo hisham
   */
  // eslint-disable-next-line class-methods-use-this
  getAddress(chainID: number | undefined = undefined): string {
    return `${chainID} notimplemented`;
  }

  /**
   * Get encrypted wallet details for this wallet
   */
  async getWalletDetails(encryptionKey: bytes.BytesData, chainID: number): Promise<WalletDetails> {
    let walletDetails: WalletDetails;

    try {
      // Try fetching from database
      walletDetails = msgpack.decode(
        bytes.arrayify(
          await this.db.getEncrypted(this.getWalletDetailsPath(chainID), encryptionKey),
        ),
      );
    } catch {
      // If details don't exist yet, return defaults
      walletDetails = {
        treeScannedHeights: [],
      };
    }

    return walletDetails;
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
  private async scan(
    // leaves: Commitment[],
    // tree: number,
    // chainID: number,
  ): Promise<boolean> {
    // const decryptionKey = this.#viewingKey.getEd25519Key();
    // const nullifierKey = this.#viewingKey.getBabyJubJubKey();

    const writeBatch: AbstractBatch[] = [];

    // Loop through passed commitments
    /*
  leaves.forEach((leaf, position) => {
    let note: ERC20Note;

    if ('ciphertext' in leaf) {
      // Derive shared secret
      const sharedKey = babyjubjub.ecdh(key.privateKey, leaf.senderPubKey);

      // Decrypt
      note = ERC20Note.decrypt(leaf.ciphertext, sharedKey);
    } else {
      // Deserialize
      note = ERC20Note.deserialize(leaf.data);
    }

    // If this note is addressed to us add to write queue
    if (note.ypubkey === key.pubkey) {
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
          nullifier: ERC20Note.getNullifier(key.privateKey, tree, position),
          decrypted: note.serialize(),
        }),
      });
    }
  });
    */

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
    const viewingKeyPrivate = await this.#viewingKey.getNullifyingKey();
    const { masterPublicKey } = this.#viewingKey;


    // Stream list of keys out
    const keys: string[] = await new Promise((resolve) => {
      const keyList: string[] = [];

      // Stream list of keys and resolve on end
      this.db
        .streamNamespace(namespace)
        .on('data', (key) => {
          keyList.push(key);
        })
        .on('end', () => {
          resolve(keyList);
        });
    });

    // Calculate UTXOs
    return Promise.all(
      keys.map(async (key) => {
        // Split key into path components
        const keySplit = key.split(':');

        // Decode UTXO
        const UTXO = msgpack.decode(bytes.arrayify(await this.db.get(keySplit)));

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

        const note = Note.deserialize(UTXO.decrypted, viewingKeyPrivate, masterPublicKey);

        return {
          tree,
          position,
          index: UTXO.index,
          change: UTXO.change,
          txid: UTXO.txid,
          spendtxid: UTXO.spendtxid,
          note,
        };
      }),
    );
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
        balances[txOutput.note.token].balance.iadd(bytes.numberify(txOutput.note.value));
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
            balance: bytes.numberify(utxo.note.value),
            utxos: [utxo],
          };
        } else {
          balancesByTree[token][utxo.tree].balance.iadd(bytes.numberify(utxo.note.value));
          balancesByTree[token][utxo.tree].utxos.push(utxo);
        }
      });
    });

    return balancesByTree;
  }

  /**
   * Scans for new balances
   * @param chainID - chainID to scan
   */
  /*
  async scan(chainID: number) {
    // Don't proceed if scan write is locked
    if (this.scanLockPerChain[chainID]) {
      this.leptonDebugger?.log(`scan locked: chainID ${chainID}`);
      return;
    }
    this.leptonDebugger?.log(`scan wallet balances: chainID ${chainID}`);

    // Lock scan on this chain
    this.scanLockPerChain[chainID] = true;

    // Fetch wallet details
    const walletDetails = await this.getWalletDetails();

    // Get latest tree
    const latestTree = await this.merkletree[chainID].latestTree();

    // Refresh list of trees
    while (walletDetails.treeScannedHeights.length < latestTree + 1) {
      // Instantiate new trees in wallet data
      walletDetails.treeScannedHeights.push(0);
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
      walletDetails.treeScannedHeights[tree] = leaves.length > 0 ? leaves.length - 1 : 0;
    }

    // Write wallet details to db
    await this.db.putEncrypted(
      this.getWalletDetailsPath(),
      this.#encryptionKey,
      msgpack.encode(walletDetails),
    );

    // Emit scanned event for this chain
    this.leptonDebugger?.log(`wallet: scanned ${chainID}`);
    this.emit('scanned', { chainID } as ScannedEventData);

    // Release lock
    this.scanLockPerChain[chainID] = false;
  }
  */

  static dbPath(id: string): bytes.BytesData[] {
    return [bytes.fromUTF8String('wallet'), id];
  }

  static async read(
    db: Database,
    id: string,
    encryptionKey: bytes.BytesData
  ): Promise<WalletData> {
    return msgpack.decode(
      bytes.arrayify(await db.getEncrypted(Wallet.dbPath(id), encryptionKey)),
    );
  }

  static async write(
    db: Database,
    id: string,
    encryptionKey: bytes.BytesData,
    data: WalletData
  ): Promise<void> {
    await db.putEncrypted(
      Wallet.dbPath(id),
      encryptionKey,
      msgpack.encode(data)
    );
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
    encryptionKey: bytes.BytesData,
    mnemonic: string,
    index: number = 0,
  ): Promise<Wallet> {
    // Calculate ID
    const id = hash.sha256(
      bytes.combine([mnemonicToSeed(mnemonic), index.toString(16)]),
    );

    // Write encrypted mnemonic to DB
    await Wallet.write(db, id, encryptionKey, { mnemonic, index });

    const { spendingKey, viewingKey } = deriveNodes(mnemonic, index)

    // Create wallet object and return
    return new Wallet(id, db, spendingKey, viewingKey);
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
    encryptionKey: bytes.BytesData,
    id: string,
  ): Promise<Wallet> {
    // Get encrypted mnemonic and derivation path from DB
    const { mnemonic, index } = await Wallet.read(db, id, encryptionKey);

    const { spendingKey, viewingKey } = deriveNodes(mnemonic, index);

    // Create wallet object and return
    return new Wallet(id, db, spendingKey, viewingKey);
  }

  async loadSpendingKey(encryptionKey: bytes.BytesData): Promise<Node> {
    const { mnemonic, index } = await Wallet.read(this.db, this.id, encryptionKey)

    return deriveNodes(mnemonic, index).spendingKey;
  }
}

export { Wallet };
