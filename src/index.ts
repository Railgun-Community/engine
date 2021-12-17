import type { AbstractLevelDOWN } from 'abstract-leveldown';
import type { ethers } from 'ethers';
import { ERC20RailgunContract } from './contract';
import { Database } from './database';
import { BIP32Node } from './keyderivation';
import { MerkleTree, Commitment } from './merkletree';
import { Prover, ArtifactsGetter } from './prover';
import { ERC20Transaction } from './transaction';
import { ERC20Note } from './note';
import { encode, decode } from './keyderivation/bech32-encode';
import { bytes } from './utils';
import { Wallet } from './wallet';

class Lepton {
  readonly db;

  readonly merkletree: {erc20: MerkleTree, /* erc721: MerkleTree */}[] = [];

  readonly contracts: ERC20RailgunContract[] = [];

  readonly prover: Prover;

  readonly wallets: {[key: string]: Wallet} = {};

  readonly deploymentBlocks: number[] = [];

  /**
   * Create a lepton instance
   * @param leveldown - abstract-leveldown compatible store
   */
  constructor(leveldown: AbstractLevelDOWN, artifactsGetter: ArtifactsGetter) {
    this.db = new Database(leveldown);
    this.prover = new Prover(artifactsGetter);
  }

  async listener(chainID: number, tree: number, startingIndex: number, leaves: Commitment[]) {
    // Queue leaves to merkle tree
    await this.merkletree[chainID].erc20.queueLeaves(tree, startingIndex, leaves);

    // Trigger wallet scans
    await Promise.all(Object.values(this.wallets).map((wallet) => wallet.scan(chainID)));
  }

  async scanHistory(
    chainID: number,
  ) {
    // Get latest tree
    const latestTree = await this.merkletree[chainID].erc20.latestTree();

    // Get latest synced event
    const treeLength = await this.merkletree[chainID].erc20.getTreeLength(latestTree);

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

    // Run scan
    await this.contracts[chainID].getHistoricalEvents(startScanningBlock, (
      tree: number,
      startingIndex: number,
      leaves: Commitment[],
    ) => {
      this.listener(chainID, tree, startingIndex, leaves);
    });
  }

  /**
   * Load network
   * @param address - address of railgun instance (proxy contract)
   * @param provider - ethers provider for network
   * @param deploymentBlock - block number to start scanning from
   */
  async loadNetwork(
    address: string,
    provider: ethers.providers.JsonRpcProvider,
    deploymentBlock: number,
  ) {
    // Get chainID of this provider
    const chainID = (await provider.getNetwork()).chainId;

    // If a network with this chainID exists, unload it and load the provider as a new network
    if (this.merkletree[chainID] || this.contracts[chainID]) this.unloadNetwork(chainID);

    // Create contract instance
    this.contracts[chainID] = new ERC20RailgunContract(address, provider);

    // Create tree controllers
    this.merkletree[chainID] = {
      erc20: new MerkleTree(this.db, chainID, 'erc20', (tree: number, root: bytes.BytesData) => this.contracts[chainID].validateRoot(tree, root)),
    };

    this.deploymentBlocks[chainID] = deploymentBlock;

    // Load merkle tree to wallets
    Object.values(this.wallets).forEach((wallet) => {
      wallet.loadTree(this.merkletree[chainID].erc20);
    });

    // Setup listeners
    this.contracts[chainID].treeUpdates((
      tree: number,
      startingIndex: number,
      leaves: Commitment[],
    ) => {
      this.listener(chainID, tree, startingIndex, leaves);
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
    const wallet = await Wallet.loadExisting(this.db, encryptionKey, id);

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
    const wallet = await Wallet.fromMnemonic(this.db, encryptionKey, mnemonic);

    // Store wallet against ID
    this.wallets[wallet.id] = wallet;

    // Load merkle trees for wallet
    this.merkletree.forEach((tree) => {
      wallet.loadTree(tree.erc20);
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
