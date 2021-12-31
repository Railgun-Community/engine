import type { AbstractLevelDOWN } from 'abstract-leveldown';
import type { ethers } from 'ethers';
import { ERC20RailgunContract } from './contract';
import { Database } from './database';
import { BIP32Node } from './keyderivation';
import { MerkleTree, Commitment, Nullifier } from './merkletree';
import { Prover, ArtifactsGetter } from './prover';
import { ERC20Transaction } from './transaction';
import { ERC20Note } from './note';
import { encode, decode } from './keyderivation/bech32-encode';
import { bytes } from './utils';
import { Wallet } from './wallet';
import { LeptonDebugger } from './models/types';

// eslint-disable-next-line no-unused-vars, @typescript-eslint/no-unused-vars
export type QuickSync = (chainID: number, startingBlock: number) => Promise<{
  commitments: {
    tree: number;
    startingIndex: number;
    leaves: Commitment[];
  }[];
  nullifiers: Nullifier[],
}>;

class Lepton {
  readonly db;

  readonly merkletree: {erc20: MerkleTree, /* erc721: MerkleTree */}[] = [];

  readonly contracts: ERC20RailgunContract[] = [];

  readonly prover: Prover;

  readonly wallets: {[key: string]: Wallet} = {};

  readonly deploymentBlocks: number[] = [];

  readonly quickSync: QuickSync | undefined;

  readonly leptonDebugger: LeptonDebugger | undefined;

  /**
   * Create a lepton instance
   * @param leveldown - abstract-leveldown compatible store
   * @param artifactsGetter - async function to retrieve artifacts, lepton doesn't handle caching
   * @param quickSync - quick sync function to speed up sync
   */
  constructor(
    leveldown: AbstractLevelDOWN,
    artifactsGetter: ArtifactsGetter,
    quickSync?: QuickSync,
    leptonDebugger?: LeptonDebugger,
  ) {
    this.db = new Database(leveldown);
    this.prover = new Prover(artifactsGetter);
    this.quickSync = quickSync;
    this.leptonDebugger = leptonDebugger;
  }

  /**
   * Handle new commitment events and kick off balance scan on wallets
   * @param chainID - chainID of commitments
   * @param tree - tree of commitments
   * @param startingIndex - starting index of commitments
   * @param leaves - commitments
   */
  async listener(chainID: number, tree: number, startingIndex: number, leaves: Commitment[], skipWalletScan = false) {

    this.leptonDebugger?.log(`trigger listener: chainID ${chainID}, leaves: ${JSON.stringify(leaves)}`);

    // Queue leaves to merkle tree
    await this.merkletree[chainID].erc20.queueLeaves(tree, startingIndex, leaves);

    // Trigger wallet scans
    if (!skipWalletScan) {
      await Promise.all(Object.values(this.wallets).map((wallet) => wallet.scan(chainID)));
    }
  }

  /**
   * Handle new nullifiers
   * @param chainID - chainID of nullifiers
   * @param nullifier - nullifer
   * @param txid - txid of nullifier transaction
   */
  async nullifierListener(chainID: number, nullifiers: {
    nullifier: bytes.BytesData,
    txid: bytes.BytesData,
  }[]) {
    await this.merkletree[chainID].erc20.nullify(nullifiers);
  }

  /**
   * Scan contract history and sync
   * @param chainID - chainID to scan
   */
  async scanHistory(
    chainID: number,
  ) {
    // Get latest tree
    const latestTree = await this.merkletree[chainID].erc20.latestTree();

    // Get latest synced event
    const treeLength = await this.merkletree[chainID].erc20.getTreeLength(latestTree);
    this.leptonDebugger?.log(`scanHistory: treeLength ${treeLength}`);

    let startScanningBlock: number;

    if (treeLength > 0) {
      // Get block number of last scanned event
      const latestEvent = await this.merkletree[chainID].erc20.getCommitment(
        latestTree,
        treeLength - 1,
      );

      startScanningBlock = (await this.contracts[chainID].contract.provider.getTransactionReceipt(
        bytes.hexlify(latestEvent.txid, true),
      )).blockNumber;
    } else {
      // If we haven't scanned anything yet, start scanning at deployment block
      startScanningBlock = this.deploymentBlocks[chainID];
    }

    // Call quicksync
    if (this.quickSync) {
      try {
        this.leptonDebugger?.log(`quickSync: chainID ${chainID}`);

        // Fetch events
        const events = await this.quickSync(chainID, startScanningBlock);

        const skipWalletScan = true;

        // Pass events to commitments listener and wait for resolution
        for (const commitmentEvent of events.commitments) {
          await this.listener(
            chainID,
            commitmentEvent.tree,
            commitmentEvent.startingIndex,
            commitmentEvent.leaves,
            skipWalletScan,
          )
        }

        // Scan after all leaves added.
        if (events.commitments.length) {
          await Promise.all(Object.values(this.wallets).map((wallet) => wallet.scan(chainID)));
        }

        // Pass nullifier events to listener
        await this.nullifierListener(chainID, events.nullifiers);

      } catch (err: any) {
        this.leptonDebugger?.error(err);
      }
    }

    // Run slow scan
    await this.contracts[chainID].getHistoricalEvents(startScanningBlock, async (
      tree: number,
      startingIndex: number,
      leaves: Commitment[],
    ) => {
      await this.listener(chainID, tree, startingIndex, leaves);
    }, async (
      nullifiers: {
        nullifier: bytes.BytesData,
        txid: bytes.BytesData,
      }[],
    ) => {
      await this.nullifierListener(chainID, nullifiers);
    });
  }

  /**
   * Load network
   * @param address - address of railgun instance (proxy contract)
   * @param provider - ethers provider for network
   * @param deploymentBlock - block number to start scanning from
   */
  async loadNetwork(
    chainID: number,
    address: string,
    provider: ethers.providers.JsonRpcProvider,
    deploymentBlock: number,
  ) {
    this.leptonDebugger?.log(`loadNetwork: ${chainID}`);

    // If a network with this chainID exists, unload it and load the provider as a new network
    if (this.merkletree[chainID] || this.contracts[chainID]) this.unloadNetwork(chainID);

    // Create contract instance
    this.contracts[chainID] = new ERC20RailgunContract(address, provider);

    // Create tree controllers
    this.merkletree[chainID] = {
      erc20: new MerkleTree(this.db, chainID, 'erc20', (tree: number, root: bytes.BytesData) => this.contracts[chainID].validateRoot(tree, root), this.leptonDebugger),
    };

    this.deploymentBlocks[chainID] = deploymentBlock;

    // Load merkle tree to wallets
    Object.values(this.wallets).forEach((wallet) => {
      wallet.loadTree(this.merkletree[chainID].erc20);
    });

    // Setup listeners
    this.contracts[chainID].treeUpdates(async (
      tree: number,
      startingIndex: number,
      leaves: Commitment[],
    ) => {
      await this.listener(chainID, tree, startingIndex, leaves);
    }, async (
      nullifiers: {
        nullifier: bytes.BytesData,
        txid: bytes.BytesData,
      }[],
    ) => {
      await this.nullifierListener(chainID, nullifiers);
    });

    await this.scanHistory(chainID);
  }

  /**
   * Unload network
   * @param chainID - chainID of network to unload
   */
  unloadNetwork(chainID: number) {
    if (this.contracts[chainID]) {
      // Unload listeners
      this.contracts[chainID].unload();

      // Unlaod tree from wallets
      Object.values(this.wallets).forEach((wallet) => {
        wallet.unloadTree(chainID);
      });

      // Delete contract and merkle tree objects
      delete this.contracts[chainID];
      delete this.merkletree[chainID];
    }
  }

  /**
   * Unload wallet
   * @param id - wallet id to unload
   */
  unloadWallet(id: string) {
    delete this.wallets[id];
  }

  /**
   * Unloads everything and closes DB
   */
  unload() {
    // Unload chains
    this.contracts.forEach((contract, chainID) => {
      this.unloadNetwork(chainID);
    });

    // Unload wallets
    Object.keys(this.wallets).forEach((walletID) => {
      this.unloadWallet(walletID);
    });

    this.db.close();
  }

  /**
   * Get list of loaded networks
   */
  get networks(): number[] {
    return this.contracts.map((element, index) => index);
  }

  /**
   * Load existing wallet
   * @param encryptionKey - encryption key of wallet
   * @param id - wallet ID
   * @returns id
   */
  async loadExistingWallet(encryptionKey: bytes.BytesData, id: bytes.BytesData): Promise<string> {
    // Instantiate wallet
    const wallet = await Wallet.loadExisting(this.db, encryptionKey, id, this.leptonDebugger);

    // Store wallet against ID
    this.wallets[bytes.hexlify(id)] = wallet;

    // Load merkle trees for wallet
    this.merkletree.forEach((tree) => {
      wallet.loadTree(tree.erc20);
    });

    // Return wallet ID
    return bytes.hexlify(id);
  }

  /**
   * Creates wallet from mnemonic
   * @param encryptionKey - encryption key of wallet
   * @param mnemonic - mnemonic to load
   * @returns id
   */
  async createWalletFromMnemonic(
    encryptionKey: bytes.BytesData,
    mnemonic: string,
  ): Promise<string> {
    // Instantiate wallet
    const wallet = await Wallet.fromMnemonic(this.db, encryptionKey, mnemonic, this.leptonDebugger);

    // Store wallet against ID
    this.wallets[wallet.id] = wallet;

    // Load merkle trees for wallet
    this.merkletree.forEach((tree) => {
      wallet.loadTree(tree.erc20);
      // TODO: trigger tree scan after loading
    });

    // Return wallet ID
    return wallet.id;
  }

  /**
   * Generate mnemonic
   */
  static createMnemonic(): string {
    return BIP32Node.createMnemonic();
  }

  static encodeAddress = encode;

  static decodeAddress = decode;
}

export {
  Lepton,
  ERC20Note,
  ERC20Transaction,
};
