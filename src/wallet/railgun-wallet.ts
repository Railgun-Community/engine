import { Signature } from '@railgun-community/circomlibjs';
import { poseidon } from '../utils/poseidon';
import { Database } from '../database/database';
import {
  deriveNodes,
  SpendingKeyPair,
  WalletNode,
  deriveEphemeralWalletFromPathSuffix,
  getEphemeralWalletBasePath,
  getEphemeralWalletPathSuffix,
} from '../key-derivation';
import { WalletData } from '../models/wallet-types';
import { ByteUtils } from '../utils/bytes';
import { sha256 } from '../utils/hash';
import { AbstractWallet } from './abstract-wallet';
import { Mnemonic } from '../key-derivation/bip39';
import { PublicInputsRailgun } from '../models';
import { signEDDSA } from '../utils/keys-utils';
import { Prover } from '../prover/prover';
import { HDNodeWallet, Authorization } from 'ethers';
import { RelayAdapt7702Helper } from '../contracts/relay-adapt/relay-adapt-7702-helper';
import { TransactionStructV2, TransactionStructV3 } from '../models/transaction-types';
import { RelayAdapt7702 } from '../abi/typechain/RelayAdapt7702';

export type EphemeralWalletDerivationStrategy = (
  index: number,
) => string;

// Optional namespace segments appended after the engine-owned chain path.
export type EphemeralWalletDBPathStrategy = () => string[];

const EPHEMERAL_KEY_INDEX_PROVIDER_NAMESPACE = 'provider';

const getEphemeralKeyIndexBaseDBPath = (
  id: string,
  chainId: bigint,
): string[] => {
  return [id, 'ephemeral_index', chainId.toString(10)];
};

const normalizeEphemeralKeyIndexDBPathSuffix = (
  dbPathSuffix: string[],
): string[] => {
  if (dbPathSuffix.some((segment) => segment.length === 0 || segment === '.' || segment === '..')) {
    throw new Error('Invalid ephemeral key index DB path suffix.');
  }

  return dbPathSuffix;
};

const getEphemeralKeyIndexDBPath = (
  id: string,
  chainId: bigint,
  dbPathSuffix: string[],
): string[] => {
  const normalizedDBPathSuffix = normalizeEphemeralKeyIndexDBPathSuffix(dbPathSuffix);
  if (normalizedDBPathSuffix.length === 0) {
    return getEphemeralKeyIndexBaseDBPath(id, chainId);
  }

  return [
    ...getEphemeralKeyIndexBaseDBPath(id, chainId),
    EPHEMERAL_KEY_INDEX_PROVIDER_NAMESPACE,
    ...normalizedDBPathSuffix,
  ];
};

const getEphemeralSignerPathSuffix = (
  provider: EphemeralSignerProvider,
  index: number,
): string => {
  const pathSuffix = provider.getPathSuffix(index);
  if (typeof pathSuffix !== 'string') {
    throw new Error('Invalid ephemeral wallet derivation path suffix.');
  }

  return pathSuffix;
};

const getEphemeralSignerDBPathSuffix = (
  provider: EphemeralSignerProvider,
): string[] => {
  const dbPathSuffix = provider.getDBPathSuffix();
  if (!Array.isArray(dbPathSuffix) || dbPathSuffix.some((segment) => typeof segment !== 'string')) {
    throw new Error('Invalid ephemeral key index DB path suffix.');
  }

  return dbPathSuffix;
};

export interface EphemeralSignerProvider {
  getPathSuffix: EphemeralWalletDerivationStrategy;
  getDBPathSuffix: EphemeralWalletDBPathStrategy;
}

const defaultEphemeralSignerProvider: EphemeralSignerProvider = {
  getPathSuffix: getEphemeralWalletPathSuffix,
  getDBPathSuffix: () => [],
};

class RailgunWallet extends AbstractWallet {
  ephemeralWalletOverride: HDNodeWallet | undefined;
  private ephemeralSignerProvider: EphemeralSignerProvider = defaultEphemeralSignerProvider;
  /**
   * Load encrypted spending key Node from database
   * Spending key should be kept private and only accessed on demand
   * @returns {Promise<SpendingKeyPair>}
   */
  async getSpendingKeyPair(
    encryptionKey: string,
    mnemonicPassword?: string,
  ): Promise<SpendingKeyPair> {
    const node = await this.loadSpendingKey(encryptionKey, mnemonicPassword);
    return node.getSpendingKeyPair();
  }

  async sign(
    publicInputs: PublicInputsRailgun,
    encryptionKey: string,
    mnemonicPassword?: string,
  ): Promise<Signature> {
    const spendingKeyPair = await this.getSpendingKeyPair(encryptionKey, mnemonicPassword);
    const msg = poseidon([publicInputs.merkleRoot, publicInputs.boundParamsHash, ...publicInputs.nullifiers, ...publicInputs.commitmentsOut]);
    return signEDDSA(spendingKeyPair.privateKey, msg);
  }

  /**
   * Get ephemeral wallet for RelayAdapt7702
   * @param {string} encryptionKey - encryption key to use with database
   * @param {bigint} chainId - Chain ID for the ephemeral key
   * @param {number} index - index of derivation path
   * @returns {Promise<HDNodeWallet>}
   */
  async getEphemeralWallet(
    encryptionKey: string,
    chainId: bigint,
    index: number,
  ): Promise<HDNodeWallet> {
    const { mnemonic, index: railgunIndex } = (await AbstractWallet.read(
      this.db,
      this.id,
      encryptionKey,
    )) as WalletData;
    const basePath = getEphemeralWalletBasePath(railgunIndex, chainId);
    const pathSuffix = getEphemeralSignerPathSuffix(this.ephemeralSignerProvider, index);
    return deriveEphemeralWalletFromPathSuffix(mnemonic, basePath, pathSuffix);
  }

  /**
   * Get current ephemeral key index
   * @returns {Promise<number>}
   */
  async getEphemeralKeyIndex(chainId: bigint): Promise<number> {
    const dbPath = getEphemeralKeyIndexDBPath(
      this.id,
      chainId,
      getEphemeralSignerDBPathSuffix(this.ephemeralSignerProvider),
    );
    try {
      const index = await this.db.get(dbPath, 'utf8');
      return parseInt(index as string, 10);
    } catch (err) {
      return 0;
    }
  }

  /**
   * Set ephemeral key index
   * @param {bigint} chainId - Chain ID for the ephemeral key
   * @param {number} index - new index
   * @returns {Promise<void>}
   */
  async setEphemeralKeyIndex(chainId: bigint, index: number): Promise<void> {
    const dbPath = getEphemeralKeyIndexDBPath(
      this.id,
      chainId,
      getEphemeralSignerDBPathSuffix(this.ephemeralSignerProvider),
    );
    await this.db.put(dbPath, index.toString(), 'utf8');
  }

  /**
   * Get current ephemeral address
   * @param {string} encryptionKey - encryption key to use with database
   * @param {bigint} chainId - Chain ID for the ephemeral key 
   * @returns {Promise<string>}
   */
  async getCurrentEphemeralAddress(
    encryptionKey: string,
    chainId: bigint,
  ): Promise<string> {
    const wallet = await this.getCurrentEphemeralWallet(encryptionKey, chainId);
    return wallet.address;
  }

  /**
   * Get current ephemeral wallet
   * @param {string} encryptionKey - encryption key to use with database
   * @returns {Promise<HDNodeWallet>}
   */
  async getCurrentEphemeralWallet(
    encryptionKey: string,
    chainId: bigint,
  ): Promise<HDNodeWallet> {
    if (this.ephemeralWalletOverride) {
      return this.ephemeralWalletOverride;
    }

    const index = await this.getEphemeralKeyIndex(chainId);
    return this.getEphemeralWallet(encryptionKey, chainId, index);
  }

  setEphemeralSignerProvider(provider: EphemeralSignerProvider): void {
    this.ephemeralSignerProvider = provider;
  }

  setEphemeralWalletDerivationStrategy(strategy: EphemeralWalletDerivationStrategy): void {
    this.ephemeralSignerProvider.getPathSuffix = strategy;
  }

  /**
   * Set current ephemeral wallet. This is not typically needed as the wallet can be derived on demand, but can be used to set a specific wallet if desired.
   */
  async setCurrentEphemeralWallet(wallet: HDNodeWallet): Promise<void> {
    this.ephemeralWalletOverride = wallet;
  }

  /**
   * Sign EIP-7702 Authorization and Execution Payload
   * @param {string} encryptionKey - encryption key to use with database
   * @param {string} contractAddress - RelayAdapt7702 contract address
   * @param {bigint} chainId - Chain ID
   * @param {(TransactionStructV2 | TransactionStructV3)[]} transactions - Railgun transactions
  * @param {RelayAdapt7702.ActionDataStruct} actionData - Action Data
   * @returns {Promise<{ authorization: Authorization; signature: string }>}
   */
  async sign7702Request(
    encryptionKey: string,
    contractAddress: string,
    chainId: bigint,
    transactions: (TransactionStructV2 | TransactionStructV3)[],
    actionData: RelayAdapt7702.ActionDataStruct,
    nonce: number = 0,
  ): Promise<{ authorization: Authorization; signature: string }> {
    const ephemeralWallet = await this.getCurrentEphemeralWallet(encryptionKey, chainId);

    const authorization = await RelayAdapt7702Helper.signEIP7702Authorization(
      ephemeralWallet,
      contractAddress,
      chainId,
      nonce,
    );

    const signature = await RelayAdapt7702Helper.signExecutionAuthorization(
      ephemeralWallet,
      transactions,
      actionData,
      chainId,
    );

    return { authorization, signature };
  }

  /**
   * Ratchet ephemeral key index
   * @returns {Promise<void>}
   */
  async ratchetEphemeralAddress(
    chainId: bigint,
  ): Promise<void> {
    const index = await this.getEphemeralKeyIndex(chainId);
    await this.setEphemeralKeyIndex(chainId, index + 1);
  }

  /**
   * Load encrypted node from database with encryption key
   * @param {BytesData} encryptionKey
   * @returns {Node} BabyJubJub node
   */
  private async loadSpendingKey(
    encryptionKey: string,
    mnemonicPassword?: string,
  ): Promise<WalletNode> {
    const { mnemonic, index } = (await RailgunWallet.read(
      this.db,
      this.id,
      encryptionKey,
    )) as WalletData;
    RailgunWallet.assertMnemonicPasswordMatchesID(this.id, mnemonic, index, mnemonicPassword);
    return deriveNodes(mnemonic, index, mnemonicPassword).spending;
  }

  /**
   * Helper to get the ethereum/whatever address is associated with this wallet.
   * The BIP39 mnemonic password (if any) must be supplied; it is never stored.
   */
  async getChainAddress(encryptionKey: string, mnemonicPassword?: string): Promise<string> {
    const { mnemonic, index } = (await AbstractWallet.read(
      this.db,
      this.id,
      encryptionKey,
    )) as WalletData;
    RailgunWallet.assertMnemonicPasswordMatchesID(this.id, mnemonic, index, mnemonicPassword);
    return Mnemonic.to0xAddress(mnemonic, index, mnemonicPassword);
  }

  /**
   * Calculate Wallet ID from mnemonic and derivation path index
   * @returns {string} hash of mnemonic and index
   */
  private static generateID(
    mnemonic: string,
    index: number,
    mnemonicPassword: string = '',
  ): string {
    return sha256(
      ByteUtils.combine([Mnemonic.toSeed(mnemonic, mnemonicPassword), index.toString(16)]),
    );
  }

  /**
   * The BIP39 mnemonic password is never persisted; it must be supplied by the caller
   * on load and on every spend. Verify the supplied password reproduces this wallet's
   * ID — a mismatch means the wrong (or a missing) password was supplied, which would
   * otherwise silently derive a different, unrelated key. Fail loudly instead.
   */
  private static assertMnemonicPasswordMatchesID(
    id: string,
    mnemonic: string,
    index: number,
    mnemonicPassword: string = '',
  ): void {
    if (RailgunWallet.generateID(mnemonic, index, mnemonicPassword) !== id) {
      throw new Error('Incorrect mnemonic password for wallet.');
    }
  }

  private static async createWallet(
    id: string,
    db: Database,
    mnemonic: string,
    mnemonicPassword: string,
    index: number,
    creationBlockNumbers: Optional<number[][]>,
    prover: Prover,
  ) {
    const nodes = deriveNodes(mnemonic, index, mnemonicPassword);

    const viewingKeyPair = await nodes.viewing.getViewingKeyPair();
    const spendingPublicKey = nodes.spending.getSpendingKeyPair().pubkey;
    return new RailgunWallet(
      id,
      db,
      viewingKeyPair,
      spendingPublicKey,
      creationBlockNumbers,
      prover,
    );
  }

  /**
   * Create a wallet from mnemonic
   * @param {Database} db - database
   * @param {BytesData} encryptionKey - encryption key to use with database
   * @param {string} mnemonic - mnemonic to load wallet from
   * @param {number} index - index of derivation path to derive if not 0
   * @returns {RailgunWallet} Wallet
   */
  static async fromMnemonic(
    db: Database,
    encryptionKey: string,
    mnemonic: string,
    index: number,
    creationBlockNumbers: Optional<number[][]>,
    prover: Prover,
  ): Promise<RailgunWallet> {
    return this.fromMnemonicWithPassword(
      db,
      encryptionKey,
      mnemonic,
      '', // mnemonicPassword
      index,
      creationBlockNumbers,
      prover,
    );
  }

  /**
   * Create a wallet from mnemonic and BIP39 mnemonic password.
   */
  static async fromMnemonicWithPassword(
    db: Database,
    encryptionKey: string,
    mnemonic: string,
    mnemonicPassword: string,
    index: number,
    creationBlockNumbers: Optional<number[][]>,
    prover: Prover,
  ): Promise<RailgunWallet> {
    const id = RailgunWallet.generateID(mnemonic, index, mnemonicPassword);

    // Write encrypted mnemonic to DB. The BIP39 mnemonic password is intentionally NOT
    // persisted: storing it next to the mnemonic would defeat its purpose as a second
    // factor. The caller owns the password and must supply it on load and on spend.
    await AbstractWallet.write(db, id, encryptionKey, { mnemonic, index, creationBlockNumbers });

    return this.createWallet(
      id,
      db,
      mnemonic,
      mnemonicPassword,
      index,
      creationBlockNumbers,
      prover,
    );
  }

  /**
   * Loads wallet data from database and creates wallet object
   * @param {Database} db - database
   * @param {BytesData} encryptionKey - encryption key to use with database
   * @param {string} id - wallet id
   * @returns {RailgunWallet} Wallet
   */
  static async loadExisting(
    db: Database,
    encryptionKey: string,
    id: string,
    prover: Prover,
    mnemonicPassword?: string,
  ): Promise<RailgunWallet> {
    // Get encrypted mnemonic and index from DB
    const { mnemonic, index, creationBlockNumbers } = (await AbstractWallet.read(
      db,
      id,
      encryptionKey,
    )) as WalletData;
    if (!mnemonic) {
      throw new Error('Incorrect wallet type.');
    }
    // The mnemonic password is not stored — the supplied one must reproduce this wallet's
    // ID. Verifying here turns a wrong/missing password into a clear error instead of
    // silently loading a different, unrelated wallet's keys.
    RailgunWallet.assertMnemonicPasswordMatchesID(id, mnemonic, index, mnemonicPassword);

    return this.createWallet(
      id,
      db,
      mnemonic,
      mnemonicPassword ?? '',
      index,
      creationBlockNumbers,
      prover,
    );
  }
}

export { RailgunWallet };
