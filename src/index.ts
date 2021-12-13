import type { AbstractLevelDOWN } from 'abstract-leveldown';
import type { ethers } from 'ethers';
import { ERC20RailgunContract } from './contract';
import { Database } from './database';
import { BIP32Node } from './keyderivation';
import { MerkleTree } from './merkletree';

class Lepton {
  readonly db;

  readonly merkletree: {erc20: MerkleTree, /* erc721: MerkleTree */}[] = [];

  readonly contracts: ERC20RailgunContract[] = [];

  /**
   * Create a lepton instance
   * @param leveldown - abstract-leveldown compatible store
   */
  constructor(leveldown: AbstractLevelDOWN) {
    this.db = new Database(leveldown);
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

    // Setup listeners
    this.contracts[chainID].treeUpdates(this.merkletree[chainID].erc20.queueLeaves);
  }

  /**
   * Unload network
   * @param chainID - chainID of network to unload
   */
  unloadNetwork(chainID: number) {
    if (this.merkletree[chainID]) {
      // Unload listeners
      this.contracts[chainID].unload();

      // Delete contract and merkle tree objects
      delete this.contracts[chainID];
      delete this.merkletree[chainID];
    }
  }

  /**
   * Get list of loaded networks
   */
  get networks(): number[] {
    return this.contracts.map((element, index) => index);
  }

  /**
   * Generate mnemonic
   */
  static createMnemonic(): string {
    return BIP32Node.createMnemonic();
  }
}

export { Lepton };
