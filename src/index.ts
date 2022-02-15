import type { AbstractLevelDOWN } from 'abstract-leveldown';
import type { ethers } from 'ethers';
import { ERC20RailgunContract } from './contract';
import { Database, DatabaseNamespace } from './database';
import { BIP32Node } from './keyderivation';
import { MerkleTree, Commitment, Nullifier } from './merkletree';
import { Prover, ArtifactsGetter } from './prover';
import { ERC20Transaction } from './transaction';
import { ERC20Note } from './note';
import { encode, decode } from './keyderivation/bech32-encode';
import { bytes } from './utils';
import { Wallet } from './wallet';
import { LeptonDebugger } from './models/types';
import { BytesData } from './utils/bytes';

export type QuickSyncCommitmentEvent = {
  txid: BytesData;
  tree: number;
  startingIndex: number;
  commitments: Commitment[];
};

export type QuickSync = (
  chainID: number,
  startingBlock: number,
) => Promise<{
  commitmentEvents: QuickSyncCommitmentEvent[];
  nullifierEvents: Nullifier[];
}>;

class Lepton {
  readonly db;

  readonly merkletree: { erc20: MerkleTree /* erc721: MerkleTree */ }[] = [];

  readonly contracts: ERC20RailgunContract[] = [];

  readonly prover: Prover;

  readonly wallets: { [key: string]: Wallet } = {};

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
  async listener(chainID: number, tree: number, startingIndex: number, leaves: Commitment[]) {
    // Queue leaves to merkle tree
    await this.merkletree[chainID].erc20.queueLeaves(tree, startingIndex, leaves);
  }

  /**
   * Handle new nullifiers
   * @param chainID - chainID of nullifiers
   * @param nullifier - nullifer
   * @param txid - txid of nullifier transaction
   */
  async nullifierListener(
    chainID: number,
    nullifiers: {
      nullifier: bytes.BytesData;
      txid: bytes.BytesData;
    }[],
  ) {
    await this.merkletree[chainID].erc20.nullify(nullifiers);
  }

  /**
   * Scan contract history and sync
   * @param chainID - chainID to scan
   */
  async scanHistory(chainID: number) {
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

      startScanningBlock = (
        await this.contracts[chainID].contract.provider.getTransactionReceipt(
          bytes.hexlify(latestEvent.txid, true),
        )
      ).blockNumber;
    } else {
      // If we haven't scanned anything yet, start scanning at deployment block
      startScanningBlock = this.deploymentBlocks[chainID];
    }

    const lastSyncedBlock = await this.getLastSyncedBlock(chainID);
    if (lastSyncedBlock && lastSyncedBlock > startScanningBlock) {
      startScanningBlock = lastSyncedBlock;
    }

    // Call quicksync
    if (this.quickSync) {
      try {
        this.leptonDebugger?.log(`quickSync: chainID ${chainID}`);

        // Fetch events
        const { commitmentEvents, nullifierEvents } = await this.quickSync(
          chainID,
          startScanningBlock,
        );

        // Pass events to commitments listener and wait for resolution
        commitmentEvents.forEach(async (commitmentEvent) => {
          await this.listener(
            chainID,
            commitmentEvent.treeNumber,
            commitmentEvent.startPosition,
            commitmentEvent.commitments,
          );
        });

        // Scan after all leaves added.
        if (commitmentEvents.length) {
          await this.scanAllWallets(chainID);
        }

        // Pass nullifier events to listener
        await this.nullifierListener(chainID, nullifierEvents);
      } catch (err: any) {
        this.leptonDebugger?.error(err);
      }
    }

    // Run slow scan
    await this.contracts[chainID].getHistoricalEvents(
      startScanningBlock,
      async (_txid: BytesData, tree: number, startingIndex: number, leaves: Commitment[]) => {
        await this.listener(chainID, tree, startingIndex, leaves);
      },
      async (
        nullifiers: {
          nullifier: bytes.BytesData;
          txid: bytes.BytesData;
        }[],
      ) => {
        await this.nullifierListener(chainID, nullifiers);
      },
      (block: number) => this.setLastSyncedBlock(block, chainID),
    );

    // Final scan after all leaves added.
    await this.scanAllWallets(chainID);
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
    provider: ethers.providers.JsonRpcProvider | ethers.providers.FallbackProvider,
    deploymentBlock: number,
  ) {
    this.leptonDebugger?.log(`loadNetwork: ${chainID}`);

    // If a network with this chainID exists, unload it and load the provider as a new network
    if (this.merkletree[chainID] || this.contracts[chainID]) this.unloadNetwork(chainID);

    // Create contract instance
    this.contracts[chainID] = new ERC20RailgunContract(address, provider, this.leptonDebugger);

    // Create tree controllers
    this.merkletree[chainID] = {
      erc20: new MerkleTree(
        this.db,
        chainID,
        'erc20',
        (tree: number, root: bytes.BytesData) => this.contracts[chainID].validateRoot(tree, root),
        this.leptonDebugger,
      ),
    };

    this.deploymentBlocks[chainID] = deploymentBlock;

    // Load merkle tree to wallets
    Object.values(this.wallets).forEach((wallet) => {
      wallet.loadTree(this.merkletree[chainID].erc20);
    });

    // Setup listeners
    this.contracts[chainID].treeUpdates(
      async (_txid: BytesData, tree: number, startingIndex: number, leaves: Commitment[]) => {
        await this.listener(chainID, tree, startingIndex, leaves);
        await this.scanAllWallets(chainID);
      },
      async (
        nullifiers: {
          nullifier: bytes.BytesData;
          txid: bytes.BytesData;
        }[],
      ) => {
        await this.nullifierListener(chainID, nullifiers);
      },
    );

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
   * Sets last synced block to resume syncing on next load.
   * @param lastSyncedBlock - last synced block
   */
  setLastSyncedBlock(lastSyncedBlock: number, chainID: number): Promise<void> {
    return this.db.put(
      [`${DatabaseNamespace.ChainSyncInfo}:last_synced_block:${chainID}`],
      lastSyncedBlock,
      'utf8',
    );
  }

  /**
   * Sets last synced block to resume syncing on next load.
   * @returns lastSyncedBlock - last synced block
   */
  getLastSyncedBlock(chainID: number): Promise<number | undefined> {
    return this.db
      .get([`${DatabaseNamespace.ChainSyncInfo}:last_synced_block:${chainID}`], 'utf8')
      .then((val) => parseInt(val, 10))
      .catch(() => Promise.resolve(undefined));
  }

  private async scanAllWallets(chainID: number) {
    await Promise.all(Object.values(this.wallets).map((wallet) => wallet.scan(chainID)));
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

export { Lepton, ERC20Note, ERC20Transaction };
