import BN from 'bn.js';
import msgpack from 'msgpack-lite';
import EventEmitter from 'events';
import type { AbstractBatch } from 'abstract-leveldown';
import { HDNode } from '@ethersproject/hdnode';
import { babyjubjub, encryption, hash } from '../utils';
import { Database } from '../database';
import { mnemonicToSeed } from '../keyderivation/bip39';
import { Note } from '../note';
import type { Commitment, MerkleTree } from '../merkletree';
import { bech32, Node } from '../keyderivation';
import { LeptonDebugger } from '../models/types';
import { NoteSerialized } from '../transaction/types';
import {
  arrayify,
  BytesData,
  combine,
  formatToByteLength,
  fromUTF8String,
  hexlify,
  numberify,
  padToLength,
} from '../utils/bytes';
import { decode } from '../keyderivation/bech32-encode';

export type WalletDetails = {
  treeScannedHeights: number[];
};

export type TXO = {
  tree: number;
  position: number;
  index: number;
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

export type WalletData = { mnemonic: string; index: number };
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
function derivePathsForIndex(index: number = 0) {
  return {
    spending: `${DERIVATION_PATH_PREFIXES.SPENDING}${index}'`,
    viewing: `${DERIVATION_PATH_PREFIXES.VIEWING}${index}'`,
  };
}

function deriveNodes(mnemonic: string, index: number = 0) {
  const paths = derivePathsForIndex(index);
  return {
    spendingKey: Node.fromMnemonic(mnemonic).derive(paths.spending),
    viewingKey: Node.fromMnemonic(mnemonic).derive(paths.viewing),
  };
}

/**
 * Derive Master Public Key (MPK) which is used as the user's address
 * @returns {string}
 */
export async function getMasterPublicKey(spendingKey: Node, viewingKey: Node): Promise<string> {
  const unpacked = babyjubjub.unpackPubKey(spendingKey.babyJubJubPublicKey);
  return hash.poseidon([...unpacked, await viewingKey.getNullifyingKey()]);
}

class Wallet extends EventEmitter {
  private db: Database;

  readonly id: string;

  #viewingKey: Node;

  readonly masterPublicKey: string;

  readonly merkletree: MerkleTree[] = [];

  // Lock scanning operations to prevent race conditions
  private scanLockPerChain: boolean[] = [];

  private leptonDebugger: LeptonDebugger = console;

  /**
   * Create Wallet controller
   * @param id - wallet ID
   * @param db - database
   * @param masterPublicKey - Master Public Key mpk
   * @param viewingKey - viewing key
   */
  constructor(id: string, db: Database, masterPublicKey: string, viewingKey: Node) {
    super();
    this.id = id;
    this.db = db;

    this.masterPublicKey = masterPublicKey;
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
   * Prefix consists of ['wallet', id, chainID]
   * May be appended with tree and position
   * @param chainID - chainID
   * @returns wallet DB prefix
   */
  getWalletDBPrefix(chainID: number, tree?: number, position?: number): string[] {
    const path = [fromUTF8String('wallet'), hexlify(this.id), hexlify(new BN(chainID))].map(
      (element) => element.padStart(64, '0'),
    );
    if (tree !== undefined) path.push(hexlify(padToLength(new BN(tree), 32)));
    if (position !== undefined) path.push(hexlify(padToLength(new BN(position), 32)));
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
   * @returns Promise<string>
   */
  async getSpendingPrivateKey(encryptionKey: BytesData): Promise<string> {
    const node = await this.loadSpendingKey(encryptionKey);
    return node.babyJubJubKeyPair.privateKey;
  }

  async getViewingPrivateKey(): Promise<string> {
    return (await this.#viewingKey.getViewingKeyPair()).privateKey;
  }

  /**
   * Get Viewing Public Key (VK)
   * @returns Promise<string>
   */
  async getViewingPublicKey(): Promise<string> {
    return this.#viewingKey.getViewingPublicKey();
  }

  /**
   * Get Address which is 64 bytes (MPK, VK)
   */
  async getAddressKeys(): Promise<[string, string]> {
    const viewingPublicKey = await this.getViewingPublicKey();
    return [this.masterPublicKey, viewingPublicKey];
  }

  /**
   * Encode address from (MPK, VK) + chainID
   * @returns address
   */
  async getAddress(chainID: number | undefined): Promise<string> {
    const [masterPublicKey, viewingPublicKey] = await this.getAddressKeys();
    return bech32.encode({ masterPublicKey, viewingPublicKey, chainID });
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
          await this.db.getEncrypted(this.getWalletDetailsPath(chainID), this.masterPublicKey),
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
  async scanLeaves(leaves: Commitment[], tree: number, chainID: number): Promise<boolean> {
    this.leptonDebugger?.log(
      `wallet:scanLeaves ${tree} ${chainID} leaves.length: ${leaves.length}`,
    );
    const address = decode(await this.getAddress(chainID));
    const key = this.#viewingKey.babyJubJubKeyPair;
    const viewingPrivateKey = await this.getViewingPrivateKey();

    const writeBatch: AbstractBatch[] = [];

    // Loop through passed commitments
    for (let position = 0; position < leaves.length; position += 1) {
      let note: Note;
      const leaf = leaves[position];

      if ('ciphertext' in leaf) {
        // Derive shared secret
        // eslint-disable-next-line no-await-in-loop
        const sharedKey = await encryption.getSharedKey(
          viewingPrivateKey,
          leaf.ciphertext.ephemeralKeys[0],
        );

        // Decrypt
        note = Note.decrypt(leaf.ciphertext.ciphertext, sharedKey);
      } else {
        // Deserialize
        const serialized: NoteSerialized = {
          npk: leaf.data.npk,
          encryptedRandom: leaf.data.encryptedRandom,
          token: leaf.data.token.tokenAddress,
          value: leaf.data.value,
        };
        try {
          note = Note.deserialize(serialized, viewingPrivateKey, address);
        } catch (e: any) {
          this.leptonDebugger?.error(e);
          throw e;
        }
      }

      // If this note is addressed to us add to write queue
      if (note.masterPublicKey === this.masterPublicKey) {
        const data = {
          type: 'put',
          key: this.getWalletDBPrefix(chainID, tree, position).join(':'),
          value: msgpack.encode({
            spendtxid: false,
            txid: hexlify(leaf.txid),
            nullifier: Note.getNullifier(key.privateKey, position),
            decrypted: note.serialize(viewingPrivateKey),
          }),
        };
        writeBatch.push(data as AbstractBatch);
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
    const address = decode(await this.getAddress(chainID));
    const latestTree = await this.merkletree[chainID].latestTree();
    // Get chain namespace
    const namespace = this.getWalletDBPrefix(chainID, latestTree);
    const viewingKeyPrivate = await this.getViewingPrivateKey();

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
          const nullifierTX = await this.merkletree[chainID].getNullified(UTXO.nullifier);

          // If it's nullified write spend txid to wallet storage
          if (nullifierTX) {
            UTXO.spendtxid = nullifierTX;

            // Write nullifier spend txid to db
            await this.db.put(keySplit, msgpack.encode(UTXO));
          }
        }

        const tree = numberify(keySplit[3]).toNumber();
        const position = numberify(keySplit[4]).toNumber();

        const note = Note.deserialize(UTXO.decrypted, viewingKeyPrivate, address);

        return {
          tree,
          position,
          index: UTXO.index,
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
      const { token } = txOutput.note;
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

  async getBalance(chainID: number, tokenAddress: string) {
    return (await this.balances(chainID))[formatToByteLength(tokenAddress, 32, false)].balance;
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
      this.leptonDebugger?.log(`wallet: scan(${chainID}) locked`);
      return;
    }
    this.leptonDebugger?.log(`wallet: scan(${chainID})`);

    // Lock scan on this chain
    this.scanLockPerChain[chainID] = true;

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

      // Wait till all leaves are fetched
      // eslint-disable-next-line no-await-in-loop
      const leaves: Commitment[] = await Promise.all(fetcher);

      // Delete undefined values and return sparse array
      leaves.forEach((value, index) => {
        if (value === undefined) delete leaves[index];
      });

      // Start scanning primary and change
      // eslint-disable-next-line no-await-in-loop
      await this.scanLeaves(leaves, tree, chainID);

      // Commit new scanned height
      walletDetails.treeScannedHeights[tree] = leaves.length > 0 ? leaves.length - 1 : 0;
    }

    // Write wallet details to db
    await this.db.putEncrypted(
      this.getWalletDetailsPath(chainID),
      this.masterPublicKey,
      msgpack.encode(walletDetails),
    );

    // Emit scanned event for this chain
    this.leptonDebugger?.log(`wallet: scanned ${chainID}`);
    this.emit('scanned', { chainID } as ScannedEventData);

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
    index: number = 0,
  ): Promise<Wallet> {
    // Calculate ID
    const id = hash.sha256(combine([mnemonicToSeed(mnemonic), index.toString(16)]));

    // Write encrypted mnemonic to DB
    await Wallet.write(db, id, encryptionKey, { mnemonic, index });

    const { spendingKey, viewingKey } = deriveNodes(mnemonic, index);
    const masterPublicKey = await getMasterPublicKey(spendingKey, viewingKey);

    // Create wallet object and return
    return new Wallet(id, db, masterPublicKey, viewingKey);
  }

  /**
   * Loads wallet data from database and creates wallet object
   * @param db - database
   * @param encryptionKey - encryption key to use with database
   * @param id - wallet id
   * @returns Wallet
   */
  static async loadExisting(db: Database, encryptionKey: BytesData, id: string): Promise<Wallet> {
    // Get encrypted mnemonic and derivation path from DB
    const { mnemonic, index } = await Wallet.read(db, id, encryptionKey);
    const { spendingKey, viewingKey } = deriveNodes(mnemonic, index);
    const masterPublicKey = await getMasterPublicKey(spendingKey, viewingKey);
    // Create wallet object and return
    return new Wallet(id, db, masterPublicKey, viewingKey);
  }

  async loadSpendingKey(encryptionKey: BytesData): Promise<Node> {
    const { mnemonic, index } = await Wallet.read(this.db, this.id, encryptionKey);

    return deriveNodes(mnemonic, index).spendingKey;
  }

  async getChainAddress(encryptionKey: BytesData): Promise<string> {
    const { mnemonic, index } = await Wallet.read(this.db, this.id, encryptionKey);
    const path = `m/44'/60'/0'/0/${index}`;
    const hdnode = HDNode.fromMnemonic(mnemonic).derivePath(path);
    return hdnode.address;
  }
}

export { Wallet };
