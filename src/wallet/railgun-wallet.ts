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
import {
  DEFAULT_RELAY_ADAPT_7702_EXECUTION_TYPE,
  RelayAdapt7702ExecutionDetails,
} from '../transaction/relay-adapt-7702-signature';
import type { RelayAdapt7702HookedSigner } from '../transaction/relay-adapt-7702-signer';

export type EphemeralWalletDerivationStrategy = (
  index: number,
) => string;

// Optional namespace segments appended after the engine-owned chain path.
export type EphemeralWalletDBPathStrategy = () => string[];

export type EphemeralSignerRequest = {
  readonly railgunWalletID: string;
  readonly railgunAccountIndex: number;
  readonly chainId: bigint;
  readonly ephemeralIndex: number;
};

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
  getSigner?: (request: EphemeralSignerRequest) => Promise<RelayAdapt7702HookedSigner>;
}

const defaultEphemeralSignerProvider: EphemeralSignerProvider = {
  getPathSuffix: getEphemeralWalletPathSuffix,
  getDBPathSuffix: () => [],
};

class RailgunWallet extends AbstractWallet {
  ephemeralWalletOverride: HDNodeWallet | undefined;
  private ephemeralSignerProvider: EphemeralSignerProvider = defaultEphemeralSignerProvider;
  private ephemeralProviderIsCustom = false;
  private ephemeralIndexLocks = new Map<bigint, Promise<unknown>>();
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
   * @param {string} mnemonicPassword - BIP-39 mnemonic password, if the wallet uses one
   * @returns {Promise<HDNodeWallet>}
   */
  async getEphemeralWallet(
    encryptionKey: string,
    chainId: bigint,
    index: number,
    mnemonicPassword?: string,
  ): Promise<HDNodeWallet> {
    const { mnemonic, index: railgunIndex } = (await AbstractWallet.read(
      this.db,
      this.id,
      encryptionKey,
    )) as WalletData;
    // The mnemonic password is never persisted; a wrong/missing one would silently derive a
    // different, unrelated ephemeral key. Fail loudly, as the spending-key path does.
    RailgunWallet.assertMnemonicPasswordMatchesID(this.id, mnemonic, railgunIndex, mnemonicPassword);
    const basePath = getEphemeralWalletBasePath(railgunIndex, chainId);
    const pathSuffix = getEphemeralSignerPathSuffix(this.ephemeralSignerProvider, index);
    return deriveEphemeralWalletFromPathSuffix(mnemonic, basePath, pathSuffix, mnemonicPassword);
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
      const parsed = parseInt(index as string, 10);
      return Number.isInteger(parsed) && parsed >= 0 ? parsed : 0;
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
    mnemonicPassword?: string,
  ): Promise<string> {
    const signer = await this.getCurrentEphemeralSigner(encryptionKey, chainId, mnemonicPassword);
    return signer.address;
  }

  async getCurrentEphemeralSigner(
    encryptionKey: string,
    chainId: bigint,
    mnemonicPassword?: string,
  ): Promise<RelayAdapt7702HookedSigner> {
    const ephemeralIndex = await this.getEphemeralKeyIndex(chainId);
    if (this.ephemeralSignerProvider.getSigner) {
      // Custom signer providers (e.g. hardware wallets) control their own keys and do not
      // derive from the mnemonic, so the mnemonic password does not apply to this branch.
      const { index: railgunAccountIndex } = (await AbstractWallet.read(
        this.db,
        this.id,
        encryptionKey,
      )) as WalletData;
      return this.ephemeralSignerProvider.getSigner({
        railgunWalletID: this.id,
        railgunAccountIndex,
        chainId,
        ephemeralIndex,
      });
    }

    return this.getEphemeralWallet(encryptionKey, chainId, ephemeralIndex, mnemonicPassword);
  }

  /**
   * Get current ephemeral wallet
   * @param {string} encryptionKey - encryption key to use with database
   * @returns {Promise<HDNodeWallet>}
   */
  async getCurrentEphemeralWallet(
    encryptionKey: string,
    chainId: bigint,
    mnemonicPassword?: string,
  ): Promise<HDNodeWallet> {
    if (this.ephemeralWalletOverride) {
      return this.ephemeralWalletOverride;
    }

    const index = await this.getEphemeralKeyIndex(chainId);
    return this.getEphemeralWallet(encryptionKey, chainId, index, mnemonicPassword);
  }

  setEphemeralSignerProvider(provider: EphemeralSignerProvider): void {
    this.ephemeralSignerProvider = provider;
    this.ephemeralProviderIsCustom = true;
  }

  setEphemeralWalletDerivationStrategy(strategy: EphemeralWalletDerivationStrategy): void {
    // Replace with a fresh object — never mutate the provider in place, which (when the
    // field still aliases the shared default singleton) would leak this strategy into
    // every other wallet, silently changing their derivation while their own
    // ephemeralProviderIsCustom flag stays false.
    this.ephemeralSignerProvider = { ...this.ephemeralSignerProvider, getPathSuffix: strategy };
    this.ephemeralProviderIsCustom = true;
  }

  /**
   * Whether ephemeral derivation uses the engine's default canonical layout
   * (m/.../<index>'). A custom signer provider controls its own derivation, so the
   * engine cannot reconstruct its addresses from an integer index — index ratcheting
   * and history scanning are therefore unsupported for custom providers, which must
   * manage their own index via setEphemeralKeyIndex (namespaced by getDBPathSuffix).
   */
  isCanonicalEphemeralProvider(): boolean {
    return !this.ephemeralProviderIsCustom;
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
    executionDetails: RelayAdapt7702ExecutionDetails = {
      executionType: DEFAULT_RELAY_ADAPT_7702_EXECUTION_TYPE,
      executeNonce: 0n,
    },
    mnemonicPassword?: string,
  ): Promise<{ authorization: Authorization; signature: string }> {
    const ephemeralSigner = await this.getCurrentEphemeralSigner(
      encryptionKey,
      chainId,
      mnemonicPassword,
    );

    const authorization = await RelayAdapt7702Helper.signEIP7702Authorization(
      ephemeralSigner,
      contractAddress,
      chainId,
      nonce,
    );

    const signature = await RelayAdapt7702Helper.signExecutionAuthorization(
      ephemeralSigner,
      transactions,
      actionData,
      chainId,
      executionDetails,
    );

    return { authorization, signature };
  }

  /**
   * Serialize a read-modify-write of the ephemeral key index per chain so
   * concurrent callers can never observe the same index and derive the same
   * ephemeral signer (which would reuse the EIP-7702 key / execute nonce).
   */
  private async runExclusiveEphemeralIndex<T>(
    chainId: bigint,
    fn: () => Promise<T>,
  ): Promise<T> {
    const previous = this.ephemeralIndexLocks.get(chainId) ?? Promise.resolve();
    const run = previous.then(fn, fn);
    this.ephemeralIndexLocks.set(
      chainId,
      run.then(
        () => undefined,
        () => undefined,
      ),
    );
    return run;
  }

  /**
   * Atomically increment and persist the ephemeral key index for a chain,
   * returning the new index.
   * @returns {Promise<number>}
   */
  async incrementEphemeralKeyIndex(chainId: bigint): Promise<number> {
    if (this.ephemeralProviderIsCustom) {
      throw new Error(
        'Ephemeral key index ratcheting is only supported for the default ephemeral provider. ' +
          'A custom ephemeral signer provider must manage its own index via setEphemeralKeyIndex.',
      );
    }
    return this.runExclusiveEphemeralIndex(chainId, async () => {
      const index = await this.getEphemeralKeyIndex(chainId);
      const nextIndex = index + 1;
      await this.setEphemeralKeyIndex(chainId, nextIndex);
      return nextIndex;
    });
  }

  /**
   * Atomically raise the ephemeral key index to candidateIndex when it exceeds the
   * current stored index, returning the resulting index. Serialized with
   * incrementEphemeralKeyIndex so a concurrent ratchet cannot be clobbered (used by the
   * history-recovery scan).
   * @returns {Promise<number>}
   */
  async setEphemeralKeyIndexIfGreater(chainId: bigint, candidateIndex: number): Promise<number> {
    return this.runExclusiveEphemeralIndex(chainId, async () => {
      const current = await this.getEphemeralKeyIndex(chainId);
      if (candidateIndex > current) {
        await this.setEphemeralKeyIndex(chainId, candidateIndex);
        return candidateIndex;
      }
      return current;
    });
  }

  /**
   * Ratchet ephemeral key index
   * @returns {Promise<void>}
   */
  async ratchetEphemeralAddress(
    chainId: bigint,
  ): Promise<void> {
    await this.incrementEphemeralKeyIndex(chainId);
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
