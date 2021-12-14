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
    Object.values(this.wallets).forEach((wallet) => {
      wallet.scan(chainID);
    });
  }

  /**
   * Load network
   * @param address - address of railgun instance (proxy contract)
   * @param provider - ethers provider for network
   */
  async loadNetwork(address: string, provider: ethers.providers.JsonRpcProvider) {
    // Get chainID of this provider
    const chainID = (await provider.getNetwork()).chainId;

    // If a network with this chainID exists, unload it and load the provider as a new network
    if (this.merkletree[chainID]) this.unloadNetwork(chainID);

    // Create contract instance
    this.contracts[chainID] = new ERC20RailgunContract(address, provider);

    // Create tree controllers
    this.merkletree[chainID] = {
      erc20: new MerkleTree(this.db, chainID, 'erc20', this.contracts[chainID].validateRoot),
    };

    // Load merkle tree to wallets
    Object.values(this.wallets).forEach((wallet) => {
      wallet.loadTree(this.merkletree[chainID].erc20);
    });

    // Setup listeners
    this.contracts[chainID].treeUpdates(this.listener.bind(this, chainID));
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
   * Unloads everything and closes DB
   */
  unload() {
    this.contracts.forEach((contract, chainID) => {
      // Unload listeners
      contract.unload();

      // Delete contract and merkle tree objects
      delete this.contracts[chainID];
      delete this.merkletree[chainID];
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
  async createFromMnemonic(encryptionKey: bytes.BytesData, mnemonic: string): Promise<string> {
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
