import BN from 'bn.js';
import msgpack from 'msgpack-lite';
import EventEmitter from 'events';
import type { AbstractBatch } from 'abstract-leveldown';
import { HDNode } from '@ethersproject/hdnode';
import { hexToBytes } from 'ethereum-cryptography/utils';
import { hash, keysUtils } from '../utils';
import { Database } from '../database';
import { mnemonicToSeed } from '../keyderivation/bip39';
import { Note } from '../note';
import { MerkleTree } from '../merkletree';
import { bech32, Node } from '../keyderivation';
import { BytesData, Commitment, NoteSerialized } from '../models/transaction-types';
import {
  arrayify,
  ByteLength,
  combine,
  formatToByteLength,
  fromUTF8String,
  hexlify,
  hexToBigInt,
  nToHex,
  numberify,
  padToLength,
} from '../utils/bytes';
import { SpendingKeyPair, ViewingKeyPair } from '../keyderivation/bip32';
import LeptonDebug from '../debugger';
import { signED25519 } from '../utils/keys-utils';

const { poseidon } = keysUtils;

export type WalletDetails = {
  treeScannedHeights: number[];
};

export type TXO = {
  tree: number;
  position: number;
  txid: string;
  spendtxid: string | false;
  dummyKey?: string; // For dummy notes
  note: Note;
};

export type TreeBalance = {
  balance: bigint;
  utxos: TXO[];
};

export type Balances = {
  [key: string]: TreeBalance;
  // Key: Token
};

export type BalancesByTree = {
  [key: string]: TreeBalance[];
  // Index = tree
};

export type ScannedEventData = {
  chainID: number;
};

export type AddressKeys = {
  masterPublicKey: bigint;
  viewingPublicKey: Uint8Array;
};

export type WalletData = { mnemonic: string; index: number };

export type WalletNodes = { spending: Node; viewing: Node };
/**
 * constant defining the derivation path prefixes for spending and viewing keys
 * must be appended with index' to form a complete path
 */
const DERIVATION_PATH_PREFIXES = {
  SPENDING: "m/44'/1984'/0'/0'/",
  VIEWING: "m/420'/1984'/0'/0'/",
};

/**
 * Helper to append DERIVATION_PATH_PREFIXES with index'
 */
export function derivePathsForIndex(index: number = 0) {
  return {
    spending: `${DERIVATION_PATH_PREFIXES.SPENDING}${index}'`,
    viewing: `${DERIVATION_PATH_PREFIXES.VIEWING}${index}'`,
  };
}

export function deriveNodes(mnemonic: string, index: number = 0): WalletNodes {
  const paths = derivePathsForIndex(index);
  return {
    // eslint-disable-next-line no-use-before-define
    spending: Node.fromMnemonic(mnemonic).derive(paths.spending),
    // eslint-disable-next-line no-use-before-define
    viewing: Node.fromMnemonic(mnemonic).derive(paths.viewing),
  };
}

class Wallet extends EventEmitter {
  private db: Database;

  readonly id: string;

  // #viewingKey: Node;

  #viewingKeyPair!: ViewingKeyPair;

  masterPublicKey!: bigint;

  readonly merkletree: MerkleTree[] = [];

  // Lock scanning operations to prevent race conditions
  private scanLockPerChain: boolean[] = [];

  public spendingPublicKey!: [bigint, bigint];

  /**
   * Create Wallet controller
   * @param id - wallet ID
   * @param db - database
   */
  constructor(id: string, db: Database) {
    super();
    this.id = id;
    this.db = db;
  }

  async initialize(nodes: WalletNodes): Promise<Wallet> {
    const { spending, viewing } = nodes;
    this.#viewingKeyPair = await viewing.getViewingKeyPair();
    const spendingKeyPair = spending.getSpendingKeyPair();
    this.masterPublicKey = Node.getMasterPublicKey(spendingKeyPair.pubkey, this.getNullifyingKey());
    this.spendingPublicKey = spendingKeyPair.pubkey;

    return this;
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
   * Prefix consists of ['wallet', id, chainID]
   * May be appended with tree and position
   * @param chainID - chainID
   * @returns wallet DB prefix
   */
  getWalletDBPrefix(chainID: number, tree?: number, position?: number): string[] {
    const path = [fromUTF8String('wallet'), hexlify(this.id), hexlify(new BN(chainID))].map(
      (element) => element.padStart(64, '0'),
    );
    if (tree != null) path.push(hexlify(padToLength(new BN(tree), 32)));
    if (position != null) path.push(hexlify(padToLength(new BN(position), 32)));
    return path;
  }

  /**
   * Construct DB path from chainID
   * @returns wallet DB path
   */
  getWalletDetailsPath(chainID: number): string[] {
    return this.getWalletDBPrefix(chainID);
  }

  /**
   * Load encrypted spending key Node from database
   * @returns Promise<string>
   */
  async getSpendingKeyPair(encryptionKey: BytesData): Promise<SpendingKeyPair> {
    const node = await this.loadSpendingKey(encryptionKey);
    return node.getSpendingKeyPair();
  }

  getViewingKeyPair(): ViewingKeyPair {
    return this.#viewingKeyPair;
  }

  /**
   * Used only to sign Relayer fee messages.
   * Verified using Relayer's viewingPublicKey, which is contained in its rail address.
   */
  async signWithViewingKey(message: Uint8Array): Promise<Uint8Array> {
    const viewingPrivateKey = this.getViewingKeyPair().privateKey;
    return signED25519(message, viewingPrivateKey);
  }

  /**
   * Nullifying Key (ie poseidon hash of Viewing Private Key) aka vpk derived on ed25519 curve
   * Used to decrypt and nullify notes
   * @todo protect like spending private key
   */
  getNullifyingKey(): bigint {
    return poseidon([hexToBigInt(hexlify(this.#viewingKeyPair.privateKey, true))]);
  }

  /**
   * Get Viewing Public Key (VK)
   * @returns string
   */
  get viewingPublicKey(): Uint8Array {
    return this.#viewingKeyPair.pubkey;
  }

  /**
   * Public keys of wallet encoded in address
   */
  get addressKeys(): AddressKeys {
    return {
      masterPublicKey: this.masterPublicKey,
      viewingPublicKey: this.viewingPublicKey,
    };
  }

  /**
   * Encode address from (MPK, VK) + chainID
   * @returns address
   */
  getAddress(chainID: number | undefined): string {
    return bech32.encode({ ...this.addressKeys, chainID });
  }

  /**
   * Get encrypted wallet details for this wallet
   */
  async getWalletDetails(chainID: number): Promise<WalletDetails> {
    let walletDetails: WalletDetails;

    try {
      // Try fetching from database
      walletDetails = msgpack.decode(
        arrayify(
          // @todo use different key?
          await this.db.getEncrypted(
            this.getWalletDetailsPath(chainID),
            nToHex(this.masterPublicKey, ByteLength.UINT_256),
          ),
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
   * Commitment index in array should be same as commitment index in tree
   * @param tree - tree number we're scanning
   * @param chainID - chainID we're scanning
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async scanLeaves(
    leaves: Commitment[],
    tree: number,
    chainID: number,
    scannedHeight: number,
  ): Promise<boolean> {
    LeptonDebug.log(`wallet:scanLeaves ${tree} ${chainID} leaves.length: ${leaves.length}`);
    const vpk = this.getViewingKeyPair().privateKey;

    const writeBatch: AbstractBatch[] = [];

    // Loop through passed commitments
    for (let position = scannedHeight; position < scannedHeight + leaves.length; position += 1) {
      LeptonDebug.log(`inserting ${leaves.length} at ${position}`);
      let note: Note | undefined;
      const leaf = leaves[position];
      if (leaf == null) {
        continue;
      }

      if ('ciphertext' in leaf) {
        // Derive shared secret
        const ephemeralKey = leaf.ciphertext.ephemeralKeys[0];
        // eslint-disable-next-line no-await-in-loop
        const sharedKey = await keysUtils.getSharedSymmetricKey(vpk, hexToBytes(ephemeralKey));
        // Try to decrypt.
        try {
          note = Note.decrypt(leaf.ciphertext.ciphertext, sharedKey);
        } catch (e: any) {
          // Expect error if leaf not addressed to us.
        }
      } else {
        // preImage
        // Deserialize
        const serialized: NoteSerialized = {
          npk: leaf.preImage.npk,
          encryptedRandom: leaf.encryptedRandom,
          token: leaf.preImage.token.tokenAddress,
          value: leaf.preImage.value,
        };
        try {
          note = Note.deserialize(serialized, vpk, this.addressKeys);
        } catch (e: any) {
          // Expect error if leaf not addressed to us.
        }
      }

      // If this note is addressed to us add to write queue
      if (note != null) {
        const nullifier = Note.getNullifier(this.getNullifyingKey(), position);
        const storedCommitment = {
          spendtxid: false,
          txid: hexlify(leaf.txid),
          nullifier: nullifier ? nToHex(nullifier, ByteLength.UINT_256) : undefined,
          decrypted: note.serialize(vpk),
        };
        writeBatch.push({
          type: 'put',
          key: this.getWalletDBPrefix(chainID, tree, position).join(':'),
          value: msgpack.encode(storedCommitment),
        } as AbstractBatch);
      }
    }

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
    const address = this.addressKeys;
    const vpk = this.getViewingKeyPair().privateKey;

    const latestTree = await this.merkletree[chainID].latestTree();
    // Get chain namespace
    const namespace = this.getWalletDBPrefix(chainID, latestTree);

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
        const UTXO = msgpack.decode(arrayify(await this.db.get(keySplit)));

        // If this UTXO hasn't already been marked as spent, check if it has
        if (!UTXO.spendtxid) {
          // Get nullifier
          const storedNullifier = await this.merkletree[chainID].getStoredNullifier(UTXO.nullifier);

          // If it's nullified write spend txid to wallet storage
          if (storedNullifier) {
            UTXO.spendtxid = storedNullifier;

            // Write nullifier spend txid to db
            await this.db.put(keySplit, msgpack.encode(UTXO));
          }
        }

        const tree = numberify(keySplit[3]).toNumber();
        const position = numberify(keySplit[4]).toNumber();

        const note = Note.deserialize(UTXO.decrypted, vpk, address);

        return {
          tree,
          position,
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
      const token = formatToByteLength(txOutput.note.token, 32, false);
      // If we don't have an entry for this token yet, create one
      if (!balances[token]) {
        balances[token] = {
          balance: BigInt(0),
          utxos: [],
        };
      }

      // If txOutput is unspent process it
      if (!txOutput.spendtxid) {
        // Store txo
        balances[token].utxos.push(txOutput);

        // Increment balance
        balances[token].balance += txOutput.note.value;
      }
    });

    return balances;
  }

  async getBalance(chainID: number, tokenAddress: string): Promise<bigint | undefined> {
    const balances = await this.balances(chainID);
    const balanceForToken = balances[formatToByteLength(tokenAddress, 32, false)];
    return balanceForToken ? balanceForToken.balance : undefined;
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
            balance: utxo.note.value,
            utxos: [utxo],
          };
        } else {
          balancesByTree[token][utxo.tree].balance += utxo.note.value;
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
  async scan(chainID: number) {
    // Don't proceed if scan write is locked
    if (this.scanLockPerChain[chainID]) {
      LeptonDebug.log(`scan locked: chainID ${chainID}`);
      return;
    }
    LeptonDebug.log(`scan wallet balances: chainID ${chainID}`);

    // Lock scan on this chain
    this.scanLockPerChain[chainID] = true;

    try {
      // Fetch wallet details
      const walletDetails = await this.getWalletDetails(chainID);

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

        // Wait until all leaves are fetched
        // eslint-disable-next-line no-await-in-loop
        const leaves: Commitment[] = await Promise.all(fetcher);

        const filteredLeaves = leaves.filter((value) => value.hash != null);

        // Start scanning primary and change
        // eslint-disable-next-line no-await-in-loop
        await this.scanLeaves(filteredLeaves, tree, chainID, scannedHeight);

        // Commit new scanned height
        walletDetails.treeScannedHeights[tree] =
          filteredLeaves.length > 0 ? filteredLeaves.length - 1 : 0;
      }

      // Write wallet details to db
      await this.db.putEncrypted(
        this.getWalletDetailsPath(chainID),
        nToHex(this.masterPublicKey, ByteLength.UINT_256),
        msgpack.encode(walletDetails),
      );

      // Emit scanned event for this chain
      LeptonDebug.log(`wallet: scanned ${chainID}`);
      this.emit('scanned', { chainID } as ScannedEventData);
    } catch (err: any) {
      LeptonDebug.log(`wallet.scan error: ${err.message}`);
      LeptonDebug.error(err);
    }

    // Release lock
    this.scanLockPerChain[chainID] = false;
  }

  static dbPath(id: string): BytesData[] {
    return [fromUTF8String('wallet'), id];
  }

  static async read(db: Database, id: string, encryptionKey: BytesData): Promise<WalletData> {
    return msgpack.decode(arrayify(await db.getEncrypted(Wallet.dbPath(id), encryptionKey)));
  }

  static async write(
    db: Database,
    id: string,
    encryptionKey: BytesData,
    data: WalletData,
  ): Promise<void> {
    await db.putEncrypted(Wallet.dbPath(id), encryptionKey, msgpack.encode(data));
  }

  /**
   * Calculate Wallet ID from mnemonic and derivation path index
   * @param {string} mnemonic
   * @param {index} number
   * @returns {string} - hash of mnemonic and index
   */
  static generateID(mnemonic: string, index: number) {
    return hash.sha256(combine([mnemonicToSeed(mnemonic), index.toString(16)]));
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
    await Wallet.write(db, id, encryptionKey, { mnemonic, index });

    const nodes = deriveNodes(mnemonic, index);

    // Create wallet object and return
    return await new Wallet(id, db).initialize(nodes);
  }

  /**
   * Loads wallet data from database and creates wallet object
   * @param {Database} db - database
   * @param {BytesData} encryptionKey - encryption key to use with database
   * @param {string} id - wallet id
   * @returns {Wallet} Wallet
   */
  static async loadExisting(db: Database, encryptionKey: BytesData, id: string): Promise<Wallet> {
    // Get encrypted mnemonic and derivation path from DB
    const { mnemonic, index } = await Wallet.read(db, id, encryptionKey);
    const nodes = deriveNodes(mnemonic, index);

    // Create wallet object and return
    return await new Wallet(id, db).initialize(nodes);
  }

  /**
   * Load encrypted node from database with encryption key
   * @param {BytesData} encryptionKey
   * @returns {Node} BabyJubJub node
   */
  async loadSpendingKey(encryptionKey: BytesData): Promise<Node> {
    const { mnemonic, index } = await Wallet.read(this.db, this.id, encryptionKey);

    return deriveNodes(mnemonic, index).spending;
  }

  /**
   * Helper to get the ethereum/whatever address is associated with this wallet
   */
  async getChainAddress(encryptionKey: BytesData): Promise<string> {
    const { mnemonic, index } = await Wallet.read(this.db, this.id, encryptionKey);
    const path = `m/44'/60'/0'/0/${index}`;
    const hdnode = HDNode.fromMnemonic(mnemonic).derivePath(path);
    return hdnode.address;
  }

  /**
   * Loads encrypted wallet data from database.
   * @param db - database
   * @param encryptionKey - encryption key to use with database
   * @param id - wallet id
   * @returns Data (JSON any)
   */
  static async getEncryptedData(db: Database, encryptionKey: BytesData, id: string) {
    return msgpack.decode(
      arrayify(await db.getEncrypted([fromUTF8String('wallet'), id], encryptionKey)),
    );
  }
}

export { Wallet };
