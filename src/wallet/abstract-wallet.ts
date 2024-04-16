/* eslint-disable no-await-in-loop */
import { Signature } from '@railgun-community/circomlibjs';
import type { PutBatch } from 'abstract-leveldown';
import BN from 'bn.js';
import EventEmitter from 'events';
import msgpack from 'msgpack-lite';
import { BigNumberish, ContractTransaction } from 'ethers';
import { poseidonHex } from '../utils/poseidon';
import { Database } from '../database/database';
import EngineDebug from '../debugger/debugger';
import { encodeAddress } from '../key-derivation/bech32';
import { SpendingPublicKey, ViewingKeyPair, WalletNode } from '../key-derivation/wallet-node';
import {
  EngineEvent,
  POICurrentProofEventData,
  POIProofEventStatus,
  UnshieldStoredEvent,
  WalletScannedEventData,
} from '../models/event-types';
import {
  BytesData,
  Ciphertext,
  CiphertextXChaCha,
  Commitment,
  CommitmentType,
  LegacyEncryptedCommitment,
  LegacyGeneratedCommitment,
  LegacyNoteSerialized,
  MerkleProof,
  NoteSerialized,
  OutputType,
  ShieldCommitment,
  StoredReceiveCommitment,
  StoredSendCommitment,
  TXIDMerkletreeData,
  TransactCommitmentV2,
  TransactCommitmentV3,
} from '../models/formatted-types';
import {
  SentCommitment,
  TXO,
  TXOsReceivedPOIStatusInfo,
  TXOsSpentPOIStatusInfo,
  WalletBalanceBucket,
} from '../models/txo-types';
import { LEGACY_MEMO_METADATA_BYTE_CHUNKS } from '../note/memo';
import {
  arrayify,
  ByteLength,
  combine,
  fastBytesToHex,
  fastHexToBytes,
  formatToByteLength,
  fromUTF8String,
  hexlify,
  hexStringToBytes,
  hexToBigInt,
  hexToBytes,
  nToHex,
  numberify,
  padToLength,
} from '../utils/bytes';
import { generateSimpleKey, getSharedSymmetricKey, signED25519 } from '../utils/keys-utils';
import {
  AddressKeys,
  TokenBalancesAllTxidVersions,
  TotalBalancesByTreeNumber,
  ShareableViewingKeyData,
  TokenBalances,
  TransactionHistoryEntry,
  TransactionHistoryEntryPreprocessSpent,
  TransactionHistoryEntryReceived,
  TransactionHistoryEntrySpent,
  TransactionHistoryItemVersion,
  TransactionHistoryTokenAmount,
  TransactionHistoryTransferTokenAmount,
  TransactionHistoryUnshieldTokenAmount,
  TreeBalance,
  ViewOnlyWalletData,
  WalletData,
  WalletDetails,
  WalletDetailsMap,
} from '../models/wallet-types';
import { packPoint, unpackPoint } from '../key-derivation/babyjubjub';
import { Chain } from '../models/engine-types';
import { assertChainSupportsV3, getChainFullNetworkID, getChainSupportsV3 } from '../chain/chain';
import { TransactNote } from '../note/transact-note';
import { getSharedSymmetricKeyLegacy } from '../utils/keys-utils-legacy';
import { ShieldNote } from '../note';
import {
  getTokenDataERC20,
  getTokenDataHash,
  getTokenDataHashERC20,
  serializeTokenData,
} from '../note/note-util';
import { TokenDataGetter } from '../token/token-data-getter';
import { isDefined, removeDuplicates, removeUndefineds } from '../utils/is-defined';
import { PrivateInputsRailgun, PublicInputsRailgun } from '../models/prover-types';
import { UTXOMerkletree } from '../merkletree/utxo-merkletree';
import {
  isShieldCommitmentType,
  isTransactCommitment,
  isTransactCommitmentType,
} from '../utils/commitment';
import { POI } from '../poi/poi';
import {
  getBlindedCommitmentForShieldOrTransact,
  getBlindedCommitmentForUnshield,
} from '../poi/blinded-commitment';
import { TXIDMerkletree } from '../merkletree/txid-merkletree';
import {
  ACTIVE_TXID_VERSIONS,
  BlindedCommitmentData,
  BlindedCommitmentType,
  LegacyTransactProofData,
  POIEngineProofInputs,
  POIsPerList,
  PreTransactionPOI,
  PreTransactionPOIsPerTxidLeafPerList,
  TXIDVersion,
} from '../models/poi-types';
import {
  GLOBAL_UTXO_POSITION_PRE_TRANSACTION_POI_PROOF_HARDCODED_VALUE,
  GLOBAL_UTXO_TREE_PRE_TRANSACTION_POI_PROOF_HARDCODED_VALUE,
  getGlobalTreePosition,
  getGlobalTreePositionPreTransactionPOIProof,
} from '../poi/global-tree-position';
import { createDummyMerkleProof, verifyMerkleProof } from '../merkletree/merkle-proof';
import { Prover } from '../prover/prover';
import {
  formatTXOsReceivedPOIStatusInfo,
  formatTXOsSpentPOIStatusInfo,
} from '../poi/poi-status-formatter';
import {
  CURRENT_UTXO_MERKLETREE_HISTORY_VERSION,
  ZERO_32_BYTE_VALUE,
  delay,
  stringifySafe,
} from '../utils';
import {
  getRailgunTransactionIDFromBigInts,
  getRailgunTxidLeafHash,
} from '../transaction/railgun-txid';
import { ExtractedRailgunTransactionData } from '../models/transaction-types';
import { POIValidation } from '../validation/poi-validation';
import { extractFirstNoteERC20AmountMapFromTransactionRequest } from '../validation/extract-transaction-data';
import { Registry } from '../utils/registry';

type ScannedDBCommitment = PutBatch<string, Buffer>;

type CachedStoredReceiveCommitment = {
  tree: number;
  position: number;
  storedReceiveCommitment: StoredReceiveCommitment;
};

type CachedStoredSendCommitment = {
  tree: number;
  position: number;
  storedSendCommitment: StoredSendCommitment;
};

type GeneratePOIsData = {
  railgunTxid: string;
  txid: string;
  listKey: string;
  isLegacyPOIProof: boolean;
  orderedSpentTXOs: TXO[];
  txidMerkletreeData: TXIDMerkletreeData;
  sentCommitmentsForRailgunTxid: SentCommitment[];
  unshieldEventsForRailgunTxid: UnshieldStoredEvent[];
};

abstract class AbstractWallet extends EventEmitter {
  protected readonly db: Database;

  private readonly tokenDataGetter: TokenDataGetter;

  readonly id: string;

  readonly viewingKeyPair: ViewingKeyPair;

  readonly masterPublicKey: bigint;

  private readonly spendingPublicKey: SpendingPublicKey;

  readonly nullifyingKey: bigint;

  private readonly utxoMerkletrees: Registry<UTXOMerkletree> = new Registry();

  private readonly txidMerkletrees: Registry<TXIDMerkletree> = new Registry();

  readonly isRefreshingPOIs: Partial<Record<TXIDVersion, boolean[][]>> = {};

  private readonly prover: Prover;

  private readonly isClearingBalances: Registry<boolean> = new Registry();

  private readonly decryptBalancesKeyForChain: Registry<Optional<string>> = new Registry();

  private creationBlockNumbers: Optional<number[][]>;

  // [type: [id: CachedStoredReceiveCommitment[]]]
  private: CachedStoredReceiveCommitment[][][] = [];

  private generatingPOIsForChain: Registry<boolean> = new Registry();

  private receiveCommitmentsCache: Registry<Optional<TXO[]>> = new Registry();

  private sentCommitmentsCache: Registry<Optional<SentCommitment[]>> = new Registry();

  /**
   * Create Wallet controller
   * @param id - wallet ID
   * @param db - database
   */
  constructor(
    id: string,
    db: Database,
    viewingKeyPair: ViewingKeyPair,
    spendingPublicKey: SpendingPublicKey,
    creationBlockNumbers: Optional<number[][]>,
    prover: Prover,
  ) {
    super();

    this.id = hexlify(id);
    this.db = db;
    this.tokenDataGetter = new TokenDataGetter(db);
    this.viewingKeyPair = viewingKeyPair;
    this.spendingPublicKey = spendingPublicKey;
    this.nullifyingKey = hexToBigInt(poseidonHex([fastBytesToHex(this.viewingKeyPair.privateKey)]));
    this.masterPublicKey = WalletNode.getMasterPublicKey(spendingPublicKey, this.nullifyingKey);
    this.creationBlockNumbers = creationBlockNumbers;
    this.prover = prover;
  }

  /**
   * Loads utxo merkle tree into wallet
   */
  async loadUTXOMerkletree(
    txidVersion: TXIDVersion,
    utxoMerkletree: UTXOMerkletree,
  ): Promise<void> {
    // Remove balances if the UTXO merkletree is out of date for this wallet.
    const { chain } = utxoMerkletree;
    const utxoMerkletreeHistoryVersion = await this.getUTXOMerkletreeHistoryVersion(chain);
    if (
      !isDefined(utxoMerkletreeHistoryVersion) ||
      utxoMerkletreeHistoryVersion < CURRENT_UTXO_MERKLETREE_HISTORY_VERSION
    ) {
      await this.clearDecryptedBalancesAllTXIDVersions(chain);
      await this.setUTXOMerkletreeHistoryVersion(chain, CURRENT_UTXO_MERKLETREE_HISTORY_VERSION);

      this.utxoMerkletrees.set(txidVersion, utxoMerkletree.chain, utxoMerkletree);

      return;
    }

    this.utxoMerkletrees.set(txidVersion, utxoMerkletree.chain, utxoMerkletree);
  }

  /**
   * Unload utxo merkle tree by chain
   */
  unloadUTXOMerkletree(txidVersion: TXIDVersion, chain: Chain) {
    this.utxoMerkletrees.del(txidVersion, chain);
  }

  /**
   * Loads txid merkle tree into wallet
   */
  loadRailgunTXIDMerkletree(txidVersion: TXIDVersion, txidMerkletree: TXIDMerkletree) {
    this.txidMerkletrees.set(txidVersion, txidMerkletree.chain, txidMerkletree);
  }

  /**
   * Unload txid merkle tree by chain
   */
  unloadRailgunTXIDMerkletree(txidVersion: TXIDVersion, chain: Chain) {
    this.txidMerkletrees.del(txidVersion, chain);
  }

  private getUTXOMerkletreeHistoryVersionDBPrefix(chain: Chain): string[] {
    const path = [...this.getWalletDBPrefix(chain), 'merkleetree_history_version'];
    if (chain != null) {
      path.push(getChainFullNetworkID(chain));
    }
    return path;
  }

  setUTXOMerkletreeHistoryVersion(chain: Chain, merkletreeHistoryVersion: number): Promise<void> {
    return this.db.put(
      this.getUTXOMerkletreeHistoryVersionDBPrefix(chain),
      merkletreeHistoryVersion,
      'utf8',
    );
  }

  getUTXOMerkletreeHistoryVersion(chain: Chain): Promise<Optional<number>> {
    return this.db
      .get(this.getUTXOMerkletreeHistoryVersionDBPrefix(chain), 'utf8')
      .then((val: string) => parseInt(val, 10))
      .catch(() => Promise.resolve(undefined));
  }

  private emitPOIProofUpdateEvent(
    status: POIProofEventStatus,
    txidVersion: TXIDVersion,
    chain: Chain,
    progress: number,
    listKey: string,
    txid: string,
    railgunTxid: string,
    index: number,
    totalCount: number,
    errorMsg: Optional<string>,
  ) {
    const updateData: POICurrentProofEventData = {
      status,
      txidVersion,
      chain,
      progress,
      listKey,
      txid,
      railgunTxid,
      index,
      totalCount,
      errorMsg,
    };
    this.emit(EngineEvent.POIProofUpdate, updateData);
  }

  /**
   * Construct DB TXO path from chain
   * Prefix consists of ['wallet', id, chain]
   * May be appended with tree and position
   * @param chain - chain type/id
   * @optional tree - without this param, all trees
   * @optional position - without this param, all positions
   * @returns wallet DB prefix
   */
  getWalletDBPrefix(chain: Chain, tree?: number, position?: number): string[] {
    const path = [fromUTF8String('wallet'), hexlify(this.id), getChainFullNetworkID(chain)].map(
      (el) => formatToByteLength(el, ByteLength.UINT_256),
    );
    if (tree != null) {
      path.push(hexlify(padToLength(new BN(tree), 32)));
    }
    if (position != null) {
      path.push(hexlify(padToLength(new BN(position), 32)));
    }
    return path;
  }

  /**
   * Construct DB received commitment path from chain
   * Prefix consists of ['wallet', id, chain]
   */
  getWalletReceiveCommitmentDBPrefix(chain: Chain, tree: number, position: number): string[] {
    return this.getWalletDBPrefix(chain, tree, position);
  }

  /**
   * Construct DB spent commitment path from chain
   * Prefix consists of ['wallet', id + "-spent", chain]
   * May be appended with tree and position
   * @param chain - chain type/id
   * @optional tree - without this param, all trees
   * @optional position - without this param, all positions
   * @returns wallet DB prefix
   */
  getWalletSentCommitmentDBPrefix(chain: Chain, tree?: number, position?: number): string[] {
    const path = [
      fromUTF8String('wallet'),
      `${hexlify(this.id)}-spent`,
      getChainFullNetworkID(chain),
    ].map((el) => formatToByteLength(el, ByteLength.UINT_256));
    if (tree != null) {
      path.push(hexlify(padToLength(new BN(tree), 32)));
    }
    if (position != null) {
      path.push(hexlify(padToLength(new BN(position), 32)));
    }
    return path;
  }

  /**
   * Construct DB path from chain
   * @returns wallet DB path
   */
  getWalletDetailsPath(chain: Chain): string[] {
    const detailsPath = fromUTF8String('details');
    return [...this.getWalletDBPrefix(chain), detailsPath];
  }

  /**
   * Return object of Viewing privateKey and pubkey
   * @returns {ViewingKeyPair}
   */
  getViewingKeyPair(): ViewingKeyPair {
    return this.viewingKeyPair;
  }

  /**
   * Used only to sign Relayer fee messages.
   * Verified using Relayer's viewingPublicKey, which is encoded in its rail address.
   * @param {Uint8Array} message - message to sign as Uint8Array
   */
  async signWithViewingKey(message: Uint8Array): Promise<Uint8Array> {
    const viewingPrivateKey = this.getViewingKeyPair().privateKey;
    return signED25519(message, viewingPrivateKey);
  }

  /**
   * Nullifying Key (ie poseidon hash of Viewing Private Key) aka vpk derived on ed25519 curve
   * Used to decrypt and nullify notes
   * @returns {bigint}
   */
  getNullifyingKey(): bigint {
    return this.nullifyingKey;
  }

  /**
   * Get Viewing Public Key (VK)
   * @returns {Uint8Array}
   */
  get viewingPublicKey(): Uint8Array {
    return this.viewingKeyPair.pubkey;
  }

  /**
   * Return masterPublicKey and viewingPublicKey used to encode RAILGUN addresses
   * @returns {AddressKeys}
   */
  get addressKeys(): AddressKeys {
    return {
      masterPublicKey: this.masterPublicKey,
      viewingPublicKey: this.viewingPublicKey,
    };
  }

  /**
   * Encode address from (MPK, VK) + chain
   * @returns {string} bech32 encoded RAILGUN address
   */
  getAddress(chain?: Chain): string {
    return encodeAddress({ ...this.addressKeys, chain });
  }

  async getWalletDetailsMap(chain: Chain): Promise<WalletDetailsMap> {
    try {
      // Try fetching from database
      const walletDetailsMapEncoded = (await this.db.get(
        this.getWalletDetailsPath(chain),
      )) as BytesData;
      const walletDetailsMap = msgpack.decode(
        arrayify(walletDetailsMapEncoded),
      ) as WalletDetailsMap;
      return walletDetailsMap;
    } catch {
      return {};
    }
  }

  /**
   * Get encrypted wallet details for this wallet
   * @param chain - chain type/id
   * @returns walletDetails - including treeScannedHeight
   */
  async getWalletDetails(txidVersion: TXIDVersion, chain: Chain): Promise<WalletDetails> {
    try {
      const walletDetailsMap = await this.getWalletDetailsMap(chain);

      const walletDetails = walletDetailsMap[txidVersion];
      if (!isDefined(walletDetails)) {
        throw new Error('No wallet details stored for txid version');
      }

      if (walletDetails.creationTree == null) {
        walletDetails.creationTree = undefined;
      }
      if (walletDetails.creationTreeHeight == null) {
        walletDetails.creationTreeHeight = undefined;
      }
      return walletDetails;
    } catch {
      // If details don't exist yet, return defaults
      const walletDetails = {
        treeScannedHeights: [],
        creationTree: undefined,
        creationTreeHeight: undefined,
      };
      return walletDetails;
    }
  }

  private async decryptLeaf(
    txidVersion: TXIDVersion,
    chain: Chain,
    ciphertext: Ciphertext | CiphertextXChaCha,
    memoV2: string,
    annotationData: string,
    sharedKey: Uint8Array,
    blindedReceiverViewingKey: Optional<Uint8Array>,
    blindedSenderViewingKey: Optional<Uint8Array>,
    isSentNote: boolean,
    isLegacyDecryption: boolean,
    blockNumber: number,
    transactCommitmentBatchIndexV3: Optional<number>,
  ): Promise<Optional<TransactNote>> {
    try {
      const decrypted = await TransactNote.decrypt(
        txidVersion,
        chain,
        this.addressKeys,
        ciphertext,
        sharedKey,
        memoV2,
        annotationData,
        this.viewingKeyPair.privateKey,
        blindedReceiverViewingKey,
        blindedSenderViewingKey,
        isSentNote,
        isLegacyDecryption,
        this.tokenDataGetter,
        blockNumber,
        transactCommitmentBatchIndexV3,
      );
      return decrypted;
    } catch (err) {
      // Expect error if leaf not addressed to this wallet.
      return undefined;
    }
  }

  private static getCommitmentType(commitment: Commitment) {
    if (isDefined(commitment.commitmentType)) {
      // New or legacy commitment.
      return commitment.commitmentType;
    }
    // Legacy commitments pre-v3 only.
    return 'ciphertext' in commitment
      ? CommitmentType.LegacyEncryptedCommitment
      : CommitmentType.LegacyGeneratedCommitment;
  }

  private async createScannedDBCommitments(
    txidVersion: TXIDVersion,
    leaf: Commitment,
    viewingPrivateKey: Uint8Array,
    tree: number,
    chain: Chain,
    position: number,
    totalLeaves: number,
  ): Promise<ScannedDBCommitment[]> {
    let noteReceive: Optional<TransactNote>;
    let noteSend: Optional<TransactNote>;
    let serializedNoteReceive: Optional<NoteSerialized | LegacyNoteSerialized>;
    let serializedNoteSend: Optional<NoteSerialized | LegacyNoteSerialized>;

    if (EngineDebug.verboseScanLogging()) {
      EngineDebug.log(
        `Trying to decrypt commitment. Current index ${position}/${totalLeaves - 1}.`,
      );
    }

    const walletAddress = this.getAddress();
    const commitmentType: CommitmentType = AbstractWallet.getCommitmentType(leaf);

    switch (commitmentType) {
      case CommitmentType.TransactCommitmentV2: {
        const commitment = leaf as TransactCommitmentV2;
        const blindedSenderViewingKey = hexStringToBytes(
          commitment.ciphertext.blindedSenderViewingKey,
        );
        const blindedReceiverViewingKey = hexStringToBytes(
          commitment.ciphertext.blindedReceiverViewingKey,
        );
        const [sharedKeyReceiver, sharedKeySender] = await Promise.all([
          getSharedSymmetricKey(viewingPrivateKey, blindedSenderViewingKey),
          getSharedSymmetricKey(viewingPrivateKey, blindedReceiverViewingKey),
        ]);
        if (sharedKeyReceiver) {
          noteReceive = await this.decryptLeaf(
            txidVersion,
            chain,
            commitment.ciphertext.ciphertext,
            commitment.ciphertext.memo,
            commitment.ciphertext.annotationData,
            sharedKeyReceiver,
            blindedReceiverViewingKey,
            blindedSenderViewingKey,
            false, // isSentNote
            false, // isLegacyDecryption
            leaf.blockNumber,
            undefined, // transactCommitmentBatchIndex
          );
          serializedNoteReceive = noteReceive ? noteReceive.serialize() : undefined;
        }
        if (sharedKeySender) {
          noteSend = await this.decryptLeaf(
            txidVersion,
            chain,
            commitment.ciphertext.ciphertext,
            commitment.ciphertext.memo,
            commitment.ciphertext.annotationData,
            sharedKeySender,
            blindedReceiverViewingKey,
            blindedSenderViewingKey,
            true, // isSentNote
            false, // isLegacyDecryption
            leaf.blockNumber,
            undefined, // transactCommitmentBatchIndex
          );
          serializedNoteSend = noteSend ? noteSend.serialize() : undefined;
        }
        break;
      }
      case CommitmentType.ShieldCommitment: {
        const commitment = leaf as ShieldCommitment;
        const sharedKey = await getSharedSymmetricKey(
          viewingPrivateKey,
          hexToBytes(commitment.shieldKey),
        );
        try {
          if (!sharedKey) {
            throw new Error('No sharedKey from shield note');
          }
          const random = ShieldNote.decryptRandom(commitment.encryptedBundle, sharedKey);

          const serialized: NoteSerialized = {
            npk: commitment.preImage.npk,
            random,
            tokenHash: getTokenDataHash(commitment.preImage.token),
            value: commitment.preImage.value,
            outputType: undefined, // not used for non-private txs
            senderRandom: undefined, // not used for non-private txs
            walletSource: undefined, // not used for non-private txs
            recipientAddress: walletAddress,
            senderAddress: undefined,
            memoText: undefined,
            shieldFee: commitment.fee,
            blockNumber: leaf.blockNumber,
          };

          noteReceive = await TransactNote.deserialize(
            txidVersion,
            chain,
            serialized,
            viewingPrivateKey,
            this.tokenDataGetter,
          );
          serializedNoteReceive = serialized;
        } catch (err) {
          // Expect error if leaf not addressed to this wallet.
        }
        break;
      }

      case CommitmentType.TransactCommitmentV3: {
        const commitment = leaf as TransactCommitmentV3;
        const blindedSenderViewingKey = hexStringToBytes(
          commitment.ciphertext.blindedSenderViewingKey,
        );
        const blindedReceiverViewingKey = hexStringToBytes(
          commitment.ciphertext.blindedReceiverViewingKey,
        );
        const [sharedKeyReceiver, sharedKeySender] = await Promise.all([
          getSharedSymmetricKey(viewingPrivateKey, blindedSenderViewingKey),
          getSharedSymmetricKey(viewingPrivateKey, blindedReceiverViewingKey),
        ]);
        if (sharedKeyReceiver) {
          noteReceive = await this.decryptLeaf(
            txidVersion,
            chain,
            commitment.ciphertext.ciphertext,
            '', // memoV2
            commitment.senderCiphertext, // annotationData
            sharedKeyReceiver,
            blindedReceiverViewingKey,
            blindedSenderViewingKey,
            false, // isSentNote
            false, // isLegacyDecryption
            leaf.blockNumber,
            commitment.transactCommitmentBatchIndex,
          );
          serializedNoteReceive = noteReceive ? noteReceive.serialize() : undefined;
        }
        if (sharedKeySender) {
          noteSend = await this.decryptLeaf(
            txidVersion,
            chain,
            commitment.ciphertext.ciphertext,
            '', // memoV2
            commitment.senderCiphertext, // annotationData
            sharedKeySender,
            blindedReceiverViewingKey,
            blindedSenderViewingKey,
            true, // isSentNote
            false, // isLegacyDecryption
            leaf.blockNumber,
            commitment.transactCommitmentBatchIndex,
          );
          serializedNoteSend = noteSend ? noteSend.serialize() : undefined;
        }
        break;
      }
      case CommitmentType.LegacyEncryptedCommitment: {
        const commitment = leaf as LegacyEncryptedCommitment;
        const blindedSenderViewingKey = hexStringToBytes(commitment.ciphertext.ephemeralKeys[0]);
        const blindedReceiverViewingKey = hexStringToBytes(commitment.ciphertext.ephemeralKeys[1]);
        const [sharedKeyReceiver, sharedKeySender] = await Promise.all([
          getSharedSymmetricKeyLegacy(viewingPrivateKey, blindedSenderViewingKey),
          getSharedSymmetricKeyLegacy(viewingPrivateKey, blindedReceiverViewingKey),
        ]);
        const annotationData = combine(
          commitment.ciphertext.memo.slice(0, LEGACY_MEMO_METADATA_BYTE_CHUNKS),
        );
        const memo = combine(commitment.ciphertext.memo.slice(LEGACY_MEMO_METADATA_BYTE_CHUNKS));
        if (sharedKeyReceiver) {
          noteReceive = await this.decryptLeaf(
            txidVersion,
            chain,
            commitment.ciphertext.ciphertext,
            memo,
            annotationData,
            sharedKeyReceiver,
            blindedReceiverViewingKey,
            blindedSenderViewingKey,
            false, // isSentNote
            true, // isLegacyDecryption
            leaf.blockNumber,
            undefined, // transactCommitmentBatchIndex
          );
          serializedNoteReceive = noteReceive
            ? noteReceive.serializeLegacy(viewingPrivateKey)
            : undefined;
        }
        if (sharedKeySender) {
          noteSend = await this.decryptLeaf(
            txidVersion,
            chain,
            commitment.ciphertext.ciphertext,
            memo,
            annotationData,
            sharedKeySender,
            blindedReceiverViewingKey,
            blindedSenderViewingKey,
            true, // isSentNote
            true, // isLegacyDecryption
            leaf.blockNumber,
            undefined, // transactCommitmentBatchIndex
          );
          serializedNoteSend = noteSend ? noteSend.serializeLegacy(viewingPrivateKey) : undefined;
        }
        break;
      }
      case CommitmentType.LegacyGeneratedCommitment: {
        const commitment = leaf as LegacyGeneratedCommitment;
        const serialized: LegacyNoteSerialized = {
          npk: commitment.preImage.npk,
          encryptedRandom: commitment.encryptedRandom,
          tokenHash: getTokenDataHashERC20(commitment.preImage.token.tokenAddress),
          value: commitment.preImage.value,
          recipientAddress: walletAddress,
          memoField: [],
          memoText: undefined,
          blockNumber: leaf.blockNumber,
        };
        try {
          noteReceive = await TransactNote.deserialize(
            txidVersion,
            chain,
            serialized,
            viewingPrivateKey,
            this.tokenDataGetter,
          );
          serializedNoteReceive = serialized;
        } catch (err) {
          // Expect error if leaf not addressed to us.
        }
        break;
      }
    }

    const scannedCommitments: ScannedDBCommitment[] = [];

    if ((noteReceive && !serializedNoteReceive) || (noteSend && !serializedNoteSend)) {
      throw new Error('Scan requires a serialized note.');
    }

    if (noteReceive && serializedNoteReceive) {
      const nullifier = TransactNote.getNullifier(this.nullifyingKey, position);
      const storedReceiveCommitment: StoredReceiveCommitment = {
        txidVersion,
        spendtxid: false,
        txid: leaf.txid,
        timestamp: leaf.timestamp,
        blockNumber: leaf.blockNumber,
        nullifier: nToHex(nullifier, ByteLength.UINT_256),
        decrypted: noteReceive.serialize(),
        senderAddress: noteReceive.senderAddressData
          ? encodeAddress(noteReceive.senderAddressData)
          : undefined,
        commitmentType: leaf.commitmentType,
        poisPerList: undefined,
        blindedCommitment: getBlindedCommitmentForShieldOrTransact(
          leaf.hash,
          noteReceive.notePublicKey,
          getGlobalTreePosition(leaf.utxoTree, leaf.utxoIndex),
        ),
        transactCreationRailgunTxid: 'railgunTxid' in leaf ? leaf.railgunTxid : undefined,
      };
      EngineDebug.log(
        `Adding RECEIVE commitment at ${position} (Wallet ${this.id}). Chain: ${chain.id}`,
      );
      scannedCommitments.push({
        type: 'put',
        key: this.getWalletReceiveCommitmentDBPrefix(chain, tree, position).join(':'),
        value: msgpack.encode(storedReceiveCommitment),
      });
    }

    if (noteSend && serializedNoteSend) {
      const storedSendCommitment: StoredSendCommitment = {
        txidVersion,
        txid: leaf.txid,
        timestamp: leaf.timestamp,
        decrypted: serializedNoteSend,
        commitmentType: leaf.commitmentType,
        walletSource: noteSend.walletSource,
        outputType: noteSend.outputType,
        recipientAddress: encodeAddress(noteSend.receiverAddressData),
        poisPerList: undefined,
        blindedCommitment: getBlindedCommitmentForShieldOrTransact(
          leaf.hash,
          noteSend.notePublicKey,
          getGlobalTreePosition(leaf.utxoTree, leaf.utxoIndex),
        ),
        railgunTxid: 'railgunTxid' in leaf ? leaf.railgunTxid : undefined,
      };
      EngineDebug.log(
        `Adding SPEND commitment at ${position} (Wallet ${this.id}). Chain: ${chain.id}`,
      );
      scannedCommitments.push({
        type: 'put',
        key: this.getWalletSentCommitmentDBPrefix(chain, tree, position).join(':'),
        value: msgpack.encode(storedSendCommitment),
      });
    }

    return scannedCommitments;
  }

  /**
   * Scans wallet at index for new balances
   * Commitment index in array should be same as commitment index in tree
   * @param {Commitment[]} leaves - commitments from events to attempt parsing
   * @param {number} tree - tree number we're scanning
   * @param {number} chain - chain type/id we're scanning
   * @param {number} startScanHeight - starting position
   */
  async scanLeaves(
    txidVersion: TXIDVersion,
    leaves: Optional<Commitment>[],
    tree: number,
    chain: Chain,
    startScanHeight: number,
    scanTicker: Optional<() => void>,
  ): Promise<void> {
    EngineDebug.log(
      `wallet:scanLeaves tree:${tree} chain:${chain.type}:${chain.id} leaves:${leaves.length}, startScanHeight:${startScanHeight}`,
    );
    const vpk = this.getViewingKeyPair().privateKey;

    const leafSyncPromises: Promise<ScannedDBCommitment[]>[] = [];

    for (let i = 0; i < leaves.length; i += 1) {
      const leaf = leaves[i];
      const position = startScanHeight + i;
      if (leaf == null) {
        if (scanTicker) {
          scanTicker();
        }
        continue;
      }
      const scanPromiseWithTicker = async () => {
        const scanned = await this.createScannedDBCommitments(
          txidVersion,
          leaf,
          vpk,
          tree,
          chain,
          position,
          leaves.length,
        );
        if (scanTicker) {
          scanTicker();
        }
        return scanned;
      };
      leafSyncPromises.push(scanPromiseWithTicker());
    }

    const writeBatch: ScannedDBCommitment[] = (await Promise.all(leafSyncPromises)).flat();

    // Write to DB
    await this.db.batch(writeBatch);

    this.invalidateCommitmentsCache(chain);
  }

  private async keySplits(namespace: string[], fieldCount: number): Promise<string[][]> {
    const keys: string[] = await this.db.getNamespaceKeys(namespace);
    const keySplits = keys
      .map((key) => key.split(':'))
      .filter((keySplit) => keySplit.length === fieldCount);
    return keySplits;
  }

  private async queryAllStoredReceiveCommitments(
    txidVersion: TXIDVersion,
    chain: Chain,
  ): Promise<CachedStoredReceiveCommitment[]> {
    const namespace = this.getWalletDBPrefix(chain);
    const keySplits = await this.keySplits(namespace, 5);

    const dbStoredReceiveCommitments: CachedStoredReceiveCommitment[] = removeUndefineds(
      await Promise.all(
        keySplits.map(async (keySplit) => {
          const data = (await this.db.get(keySplit)) as BytesData;
          const storedReceiveCommitment = msgpack.decode(arrayify(data)) as StoredReceiveCommitment;

          if (storedReceiveCommitment.txidVersion !== txidVersion) {
            return undefined;
          }

          const tree = numberify(keySplit[3]).toNumber();
          const position = numberify(keySplit[4]).toNumber();

          return { storedReceiveCommitment, tree, position };
        }),
      ),
    );
    return dbStoredReceiveCommitments;
  }

  private async queryAllStoredSendCommitments(
    txidVersion: TXIDVersion,
    chain: Chain,
  ): Promise<CachedStoredSendCommitment[]> {
    const namespace = this.getWalletSentCommitmentDBPrefix(chain);
    const keySplits = await this.keySplits(namespace, 5);

    const dbStoredSendCommitments: CachedStoredSendCommitment[] = removeUndefineds(
      await Promise.all(
        keySplits.map(async (keySplit) => {
          const data = (await this.db.get(keySplit)) as BytesData;
          const storedSendCommitment = msgpack.decode(arrayify(data)) as StoredSendCommitment;

          if (storedSendCommitment.txidVersion !== txidVersion) {
            return undefined;
          }

          const tree = numberify(keySplit[3]).toNumber();
          const position = numberify(keySplit[4]).toNumber();

          return { storedSendCommitment, tree, position };
        }),
      ),
    );

    return dbStoredSendCommitments;
  }

  /**
   * Clears commitments cache
   */
  invalidateCommitmentsCache(chain: Chain) {
    // eslint-disable-next-line no-restricted-syntax
    for (const txidVersion of ACTIVE_TXID_VERSIONS) {
      this.receiveCommitmentsCache.del(txidVersion, chain);
      this.sentCommitmentsCache.del(txidVersion, chain);
    }
  }

  /**
   * Get TXOs list of a chain
   * @param chain - chain type/id to get UTXOs for
   * @returns UTXOs list
   */
  async TXOs(txidVersion: TXIDVersion, chain: Chain): Promise<TXO[]> {
    if (!this.hasUTXOMerkletree(txidVersion, chain)) {
      return [];
    }

    const cachedTXOs = this.receiveCommitmentsCache.get(txidVersion, chain);
    if (isDefined(cachedTXOs)) {
      return cachedTXOs;
    }

    const recipientAddress = encodeAddress(this.addressKeys);
    const vpk = this.getViewingKeyPair().privateKey;
    const merkletree = this.getUTXOMerkletree(txidVersion, chain);

    const storedReceiveCommitments = await this.queryAllStoredReceiveCommitments(
      txidVersion,
      chain,
    );

    const TXOs = await Promise.all(
      storedReceiveCommitments.map(async ({ storedReceiveCommitment, tree, position }) => {
        const receiveCommitment = storedReceiveCommitment;

        const note = await TransactNote.deserialize(
          txidVersion,
          chain,
          {
            ...receiveCommitment.decrypted,
            recipientAddress,
          },
          vpk,
          this.tokenDataGetter,
        );

        // Check if TXO has been spent.
        if (receiveCommitment.spendtxid === false) {
          const nullifierTxid = await merkletree.getNullifierTxid(receiveCommitment.nullifier);
          if (isDefined(nullifierTxid)) {
            receiveCommitment.spendtxid = nullifierTxid;
            await this.updateReceiveCommitmentInDB(chain, tree, position, receiveCommitment);
          }
        }

        // Look up blinded commitment.
        if (
          !isDefined(receiveCommitment.blindedCommitment) ||
          (!isDefined(receiveCommitment.transactCreationRailgunTxid) &&
            isTransactCommitmentType(receiveCommitment.commitmentType))
        ) {
          const globalTreePosition = getGlobalTreePosition(tree, position);
          const commitment = await merkletree.getCommitment(tree, position);
          if (
            isTransactCommitment(commitment) &&
            !isTransactCommitmentType(receiveCommitment.commitmentType)
          ) {
            // Should never happen
            throw new Error('Fatal - Invalid commitment type');
          }

          let hasUpdate = false;

          if (
            isTransactCommitment(commitment) &&
            (isDefined(receiveCommitment.transactCreationRailgunTxid) ||
              isDefined(commitment.railgunTxid)) &&
            receiveCommitment.transactCreationRailgunTxid !== commitment.railgunTxid
          ) {
            receiveCommitment.transactCreationRailgunTxid = commitment.railgunTxid;
            hasUpdate = true;
          }

          const blindedCommitment = getBlindedCommitmentForShieldOrTransact(
            commitment.hash,
            note.notePublicKey,
            globalTreePosition,
          );

          if (
            (isDefined(receiveCommitment.blindedCommitment) || isDefined(blindedCommitment)) &&
            receiveCommitment.blindedCommitment !== blindedCommitment
          ) {
            receiveCommitment.blindedCommitment = blindedCommitment;
            hasUpdate = true;
          }

          if (hasUpdate) {
            await this.updateReceiveCommitmentInDB(chain, tree, position, receiveCommitment);
          }
        }

        const txo: TXO = {
          tree,
          position,
          blockNumber: receiveCommitment.blockNumber,
          txid: receiveCommitment.txid,
          timestamp: receiveCommitment.timestamp,
          spendtxid: receiveCommitment.spendtxid,
          nullifier: receiveCommitment.nullifier,
          note,
          poisPerList: receiveCommitment.poisPerList,
          blindedCommitment: receiveCommitment.blindedCommitment,
          commitmentType: receiveCommitment.commitmentType,
          transactCreationRailgunTxid: receiveCommitment.transactCreationRailgunTxid,
        };

        return txo;
      }),
    );

    this.receiveCommitmentsCache.set(txidVersion, chain, TXOs);

    return TXOs;
  }

  /**
   * Get spent commitments of a chain
   * @param chain - chain type/id to get spent commitments for
   * @returns SentCommitment list
   */
  private async getSentCommitments(
    txidVersion: TXIDVersion,
    chain: Chain,
    startingBlock: Optional<number>,
  ): Promise<SentCommitment[]> {
    if (!this.hasUTXOMerkletree(txidVersion, chain)) {
      return [];
    }

    // We have a cache invalidation problem elsewhere, so this is disabled for now:
    // const cachedSentCommitments = this.sentCommitmentsCache.get(txidVersion, chain);
    // if (isDefined(cachedSentCommitments)) {
    //   return cachedSentCommitments;
    // }

    const vpk = this.getViewingKeyPair().privateKey;

    const sentCommitments: SentCommitment[] = [];

    const storedSendCommitments = await this.queryAllStoredSendCommitments(txidVersion, chain);

    await Promise.all(
      storedSendCommitments.map(async ({ storedSendCommitment, tree, position }) => {
        const sentCommitment = storedSendCommitment;

        const note = await TransactNote.deserialize(
          txidVersion,
          chain,
          sentCommitment.decrypted,
          vpk,
          this.tokenDataGetter,
        );

        if (!isDefined(note.blockNumber)) {
          return;
        }
        if (startingBlock != null && note.blockNumber < startingBlock) {
          return;
        }

        // Look up railgunTxid.
        if (
          !isDefined(sentCommitment.railgunTxid) ||
          !isDefined(sentCommitment.blindedCommitment)
        ) {
          const utxoMerkletree = this.getUTXOMerkletree(txidVersion, chain);
          const commitment = await utxoMerkletree.getCommitment(tree, position);

          if (isTransactCommitment(commitment) && isDefined(commitment.railgunTxid)) {
            sentCommitment.blindedCommitment = getBlindedCommitmentForShieldOrTransact(
              commitment.hash,
              note.notePublicKey,
              getGlobalTreePosition(commitment.utxoTree, commitment.utxoIndex),
            );
            sentCommitment.railgunTxid = commitment.railgunTxid;

            await this.updateSentCommitmentInDB(chain, tree, position, sentCommitment);
          }
        }

        sentCommitments.push({
          tree,
          position,
          txid: sentCommitment.txid,
          timestamp: sentCommitment.timestamp,
          note,
          walletSource: sentCommitment.walletSource,
          outputType: sentCommitment.outputType,
          isLegacyTransactNote: TransactNote.isLegacyTransactNote(sentCommitment.decrypted),
          railgunTxid: sentCommitment.railgunTxid,
          poisPerList: sentCommitment.poisPerList,
          blindedCommitment: sentCommitment.blindedCommitment,
          commitmentType: sentCommitment.commitmentType,
        });
      }),
    );

    this.sentCommitmentsCache.set(txidVersion, chain, sentCommitments);

    return sentCommitments;
  }

  private async updateReceiveCommitmentInDB(
    chain: Chain,
    tree: number,
    position: number,
    receiveCommitment: StoredReceiveCommitment,
  ): Promise<void> {
    await this.db.put(
      this.getWalletReceiveCommitmentDBPrefix(chain, tree, position),
      msgpack.encode(receiveCommitment),
    );
    this.invalidateCommitmentsCache(chain);
  }

  private async updateSentCommitmentInDB(
    chain: Chain,
    tree: number,
    position: number,
    sentCommitment: StoredSendCommitment,
  ): Promise<void> {
    await this.db.put(
      this.getWalletSentCommitmentDBPrefix(chain, tree, position),
      msgpack.encode(sentCommitment),
    );
    this.invalidateCommitmentsCache(chain);
  }

  async getTXOsReceivedPOIStatusInfo(
    txidVersion: TXIDVersion,
    chain: Chain,
  ): Promise<TXOsReceivedPOIStatusInfo[]> {
    const TXOs = await this.TXOs(txidVersion, chain);
    return formatTXOsReceivedPOIStatusInfo(TXOs);
  }

  async getTXOsSpentPOIStatusInfo(
    txidVersion: TXIDVersion,
    chain: Chain,
  ): Promise<TXOsSpentPOIStatusInfo[]> {
    const [sentCommitments, TXOs] = await Promise.all([
      this.getSentCommitments(txidVersion, chain, undefined),
      this.TXOs(txidVersion, chain),
    ]);
    const unshieldEvents = await this.getUnshieldEventsFromSpentNullifiers(
      txidVersion,
      chain,
      TXOs,
    );
    const txidMerkletree = this.getRailgunTXIDMerkletreeForChain(txidVersion, chain);
    return formatTXOsSpentPOIStatusInfo(txidMerkletree, sentCommitments, TXOs, unshieldEvents);
  }

  async getNumSpendPOIProofsPossible(txidVersion: TXIDVersion, chain: Chain): Promise<number> {
    const spendProofStatusInfo = await this.getTXOsSpentPOIStatusInfo(txidVersion, chain);
    const totalListKeysCanGenerateSpentPOIs = spendProofStatusInfo.reduce(
      (acc, curr) => acc + curr.strings.listKeysCanGenerateSpentPOIs.length,
      0,
    );
    return totalListKeysCanGenerateSpentPOIs;
  }

  async submitLegacyTransactPOIEventsReceiveCommitments(
    txidVersion: TXIDVersion,
    chain: Chain,
  ): Promise<void> {
    const TXOs = await this.TXOs(txidVersion, chain);
    const txosNeedLegacyCreationPOIs = TXOs.filter((txo) =>
      POI.shouldSubmitLegacyTransactEventsTXOs(chain, txo),
    );
    if (txosNeedLegacyCreationPOIs.length === 0) {
      return;
    }

    const legacyTransactProofDatas: LegacyTransactProofData[] = [];

    const txidMerkletree = this.getRailgunTXIDMerkletreeForChain(txidVersion, chain);

    // eslint-disable-next-line no-restricted-syntax
    for (const txo of txosNeedLegacyCreationPOIs) {
      const txidIndex = await txidMerkletree.getTxidIndexByRailgunTxid(
        txo.transactCreationRailgunTxid as string,
      );
      if (!isDefined(txidIndex)) {
        EngineDebug.error(
          new Error(
            `txidIndex not found for railgunTxid - cannot submit legacy transact POI event: railgun txid ${
              txo.transactCreationRailgunTxid ?? 'N/A'
            }`,
          ),
        );
        continue;
      }
      legacyTransactProofDatas.push({
        txidIndex: txidIndex.toString(),
        blindedCommitment: txo.blindedCommitment as string,
        npk: nToHex(txo.note.notePublicKey, ByteLength.UINT_256, true),
        value: txo.note.value.toString(),
        tokenHash: txo.note.tokenHash,
      });
    }

    const listKeys = POI.getListKeysCanSubmitLegacyTransactEvents(TXOs);

    await POI.submitLegacyTransactProofs(txidVersion, chain, listKeys, legacyTransactProofDatas);

    // Delay slightly, so POI queue can index the events. Refresh after submitting all legacy events.
    await delay(1000);
    await this.refreshReceivePOIsAllTXOs(txidVersion, chain);
  }

  async receiveCommitmentHasValidPOI(
    txidVersion: TXIDVersion,
    chain: Chain,
    commitment: string,
  ): Promise<boolean> {
    const cachedStoredReceiveCommitments = await this.queryAllStoredReceiveCommitments(
      txidVersion,
      chain,
    );

    const utxoMerkletree = this.getUTXOMerkletree(txidVersion, chain);

    const formattedCommitment = formatToByteLength(commitment, ByteLength.UINT_256);

    // eslint-disable-next-line no-restricted-syntax
    for (const cachedStoredReceiveCommitment of cachedStoredReceiveCommitments) {
      const receiveCommitment = await utxoMerkletree.getCommitment(
        cachedStoredReceiveCommitment.tree,
        cachedStoredReceiveCommitment.position,
      );
      if (!isTransactCommitmentType(receiveCommitment.commitmentType)) {
        continue;
      }
      if (formattedCommitment === formatToByteLength(receiveCommitment.hash, ByteLength.UINT_256)) {
        return POI.hasValidPOIsActiveLists(
          cachedStoredReceiveCommitment.storedReceiveCommitment.poisPerList,
        );
      }
    }
    return false;
  }

  async getChainTxidsStillPendingSpentPOIs(
    txidVersion: TXIDVersion,
    chain: Chain,
  ): Promise<string[]> {
    const { sentCommitmentsNeedPOIs, unshieldEventsNeedPOIs } =
      await this.getSentCommitmentsAndUnshieldEventsNeedPOIs(txidVersion, chain);

    const txids = [...sentCommitmentsNeedPOIs, ...unshieldEventsNeedPOIs].map((item) => item.txid);
    return removeDuplicates(txids);
  }

  async getSpendableReceivedChainTxids(txidVersion: TXIDVersion, chain: Chain): Promise<string[]> {
    const TXOs = await this.TXOs(txidVersion, chain);
    const spendableTXOs = TXOs.filter(
      (txo) => POI.getBalanceBucket(txo) === WalletBalanceBucket.Spendable,
    );
    const txids = spendableTXOs.map((item) => item.txid);
    return removeDuplicates(txids);
  }

  async refreshReceivePOIsAllTXOs(txidVersion: TXIDVersion, chain: Chain): Promise<void> {
    const TXOs = await this.TXOs(txidVersion, chain);
    const txosNeedCreationPOIs = TXOs.filter((txo) => POI.shouldRetrieveTXOPOIs(txo)).sort((a, b) =>
      AbstractWallet.sortPOIsPerListUndefinedFirst(a, b),
    );
    if (txosNeedCreationPOIs.length === 0) {
      return;
    }

    const blindedCommitmentDatas: BlindedCommitmentData[] = txosNeedCreationPOIs
      .slice(0, 1000) // 1000 max in request
      .map((txo) => ({
        type: isTransactCommitmentType(txo.commitmentType)
          ? BlindedCommitmentType.Transact
          : BlindedCommitmentType.Shield,
        blindedCommitment: txo.blindedCommitment as string,
      }));
    const blindedCommitmentToPOIList = await POI.retrievePOIsForBlindedCommitments(
      txidVersion,
      chain,
      blindedCommitmentDatas,
    );

    // eslint-disable-next-line no-restricted-syntax
    for (const txo of txosNeedCreationPOIs) {
      if (!isDefined(txo.blindedCommitment)) {
        continue;
      }
      const poisPerList = blindedCommitmentToPOIList[txo.blindedCommitment];
      if (!isDefined(poisPerList)) {
        continue;
      }
      txo.poisPerList = poisPerList;
      await this.updateReceiveCommitmentCreatedPOIs(chain, txo.tree, txo.position, txo.poisPerList);
    }
  }

  private static sortPOIsPerListUndefinedFirst(
    a: { poisPerList: Optional<POIsPerList> },
    b: { poisPerList: Optional<POIsPerList> },
  ) {
    return isDefined(a.poisPerList) && !isDefined(b.poisPerList) ? -1 : 1;
  }

  private static filterByRailgunTxid(
    item: { railgunTxid: Optional<string> },
    railgunTxid: Optional<string>,
  ) {
    return isDefined(railgunTxid) ? item.railgunTxid === railgunTxid : true;
  }

  async getSentCommitmentsAndUnshieldEventsNeedPOIRefresh(
    txidVersion: TXIDVersion,
    chain: Chain,
    filterRailgunTxid?: string,
  ) {
    const [sentCommitments, TXOs] = await Promise.all([
      this.getSentCommitments(txidVersion, chain, undefined),
      this.TXOs(txidVersion, chain),
    ]);
    const sentCommitmentsNeedPOIRefresh = sentCommitments
      .filter((sendCommitment) => POI.shouldRetrieveSentCommitmentPOIs(sendCommitment))
      .filter((sentCommitment) =>
        AbstractWallet.filterByRailgunTxid(sentCommitment, filterRailgunTxid),
      )
      .sort((a, b) => AbstractWallet.sortPOIsPerListUndefinedFirst(a, b));

    const unshieldEvents = await this.getUnshieldEventsFromSpentNullifiers(
      txidVersion,
      chain,
      TXOs,
    );
    const unshieldEventsNeedPOIRefresh = unshieldEvents
      .filter((unshieldEvent) => POI.shouldRetrieveUnshieldEventPOIs(unshieldEvent))
      .filter((unshieldEvent) =>
        AbstractWallet.filterByRailgunTxid(unshieldEvent, filterRailgunTxid),
      )
      .sort((a, b) => AbstractWallet.sortPOIsPerListUndefinedFirst(a, b));

    return { sentCommitmentsNeedPOIRefresh, unshieldEventsNeedPOIRefresh, TXOs };
  }

  async getSentCommitmentsAndUnshieldEventsNeedPOIs(
    txidVersion: TXIDVersion,
    chain: Chain,
    filterRailgunTxid?: string,
  ) {
    const [sentCommitments, TXOs] = await Promise.all([
      this.getSentCommitments(txidVersion, chain, undefined),
      this.TXOs(txidVersion, chain),
    ]);
    const sentCommitmentsNeedPOIs = sentCommitments
      .filter((sendCommitment) => POI.shouldGenerateSpentPOIsSentCommitment(sendCommitment))
      .filter((sentCommitment) =>
        AbstractWallet.filterByRailgunTxid(sentCommitment, filterRailgunTxid),
      )
      .sort((a, b) => AbstractWallet.sortPOIsPerListUndefinedFirst(a, b));

    const unshieldEvents = await this.getUnshieldEventsFromSpentNullifiers(
      txidVersion,
      chain,
      TXOs,
    );
    const unshieldEventsNeedPOIs = unshieldEvents
      .filter((unshieldEvent) => POI.shouldGenerateSpentPOIsUnshieldEvent(unshieldEvent))
      .filter((unshieldEvent) =>
        AbstractWallet.filterByRailgunTxid(unshieldEvent, filterRailgunTxid),
      )
      .sort((a, b) => AbstractWallet.sortPOIsPerListUndefinedFirst(a, b));

    return {
      sentCommitments,
      sentCommitmentsNeedPOIs,
      unshieldEvents,
      unshieldEventsNeedPOIs,
      TXOs,
    };
  }

  async refreshSpentPOIsAllSentCommitmentsAndUnshieldEvents(
    txidVersion: TXIDVersion,
    chain: Chain,
    filterRailgunTxid?: string,
  ): Promise<void> {
    const { sentCommitmentsNeedPOIRefresh, unshieldEventsNeedPOIRefresh } =
      await this.getSentCommitmentsAndUnshieldEventsNeedPOIRefresh(
        txidVersion,
        chain,
        filterRailgunTxid,
      );
    if (!sentCommitmentsNeedPOIRefresh.length && !unshieldEventsNeedPOIRefresh.length) {
      return;
    }

    const blindedCommitmentDatas: BlindedCommitmentData[] = [
      ...sentCommitmentsNeedPOIRefresh.map((sentCommitment) => ({
        type: isTransactCommitmentType(sentCommitment.commitmentType)
          ? BlindedCommitmentType.Transact
          : BlindedCommitmentType.Shield,
        blindedCommitment: sentCommitment.blindedCommitment as string,
      })),
      ...unshieldEventsNeedPOIRefresh.map((unshieldEvent) => ({
        type: BlindedCommitmentType.Unshield,
        blindedCommitment: getBlindedCommitmentForUnshield(unshieldEvent.railgunTxid as string),
      })),
    ];
    const blindedCommitmentToPOIList = await POI.retrievePOIsForBlindedCommitments(
      txidVersion,
      chain,
      blindedCommitmentDatas.slice(0, 1000), // 1000 max in request
    );

    // eslint-disable-next-line no-restricted-syntax
    for (const sentCommitment of sentCommitmentsNeedPOIRefresh) {
      if (!isDefined(sentCommitment.blindedCommitment)) {
        continue;
      }
      const poisPerList = blindedCommitmentToPOIList[sentCommitment.blindedCommitment];
      if (!isDefined(poisPerList)) {
        continue;
      }
      sentCommitment.poisPerList = poisPerList;
      await this.updateSentCommitmentSpentPOIs(
        chain,
        sentCommitment.tree,
        sentCommitment.position,
        sentCommitment.poisPerList,
      );
    }

    const utxoMerkletree = this.getUTXOMerkletree(txidVersion, chain);

    // eslint-disable-next-line no-restricted-syntax
    for (const unshieldEvent of unshieldEventsNeedPOIRefresh) {
      if (!isDefined(unshieldEvent.railgunTxid)) {
        continue;
      }
      const blindedCommitment = getBlindedCommitmentForUnshield(unshieldEvent.railgunTxid);
      const poisPerList = blindedCommitmentToPOIList[blindedCommitment];
      if (!isDefined(poisPerList)) {
        continue;
      }
      unshieldEvent.poisPerList = poisPerList;
      await utxoMerkletree.updateUnshieldEvent(unshieldEvent);

      this.invalidateCommitmentsCache(chain);
    }
  }

  async generatePOIsAllSentCommitmentsAndUnshieldEvents(
    chain: Chain,
    txidVersion: TXIDVersion,
    railgunTxidFilter?: string,
  ): Promise<number> {
    if (!this.hasUTXOMerkletree(txidVersion, chain)) {
      return 0;
    }
    if (this.generatingPOIsForChain.get(null, chain) === true) {
      return 0;
    }
    this.generatingPOIsForChain.set(null, chain, true);

    try {
      const {
        sentCommitments,
        sentCommitmentsNeedPOIs,
        unshieldEvents,
        unshieldEventsNeedPOIs,
        TXOs,
      } = await this.getSentCommitmentsAndUnshieldEventsNeedPOIs(
        txidVersion,
        chain,
        railgunTxidFilter,
      );

      if (!sentCommitmentsNeedPOIs.length && !unshieldEventsNeedPOIs.length) {
        if (isDefined(railgunTxidFilter)) {
          throw new Error(
            `Railgun TXID ${railgunTxidFilter} not found in sent commitments / unshield events.`,
          );
        }
        this.generatingPOIsForChain.set(null, chain, false);
        return 0;
      }

      const railgunTxidsNeedPOIs = new Set<string>();
      sentCommitmentsNeedPOIs.forEach((sentCommitment) => {
        if (isDefined(sentCommitment.railgunTxid)) {
          railgunTxidsNeedPOIs.add(sentCommitment.railgunTxid);
        }
      });
      unshieldEventsNeedPOIs.forEach((unshieldEvent) => {
        if (isDefined(unshieldEvent.railgunTxid)) {
          railgunTxidsNeedPOIs.add(unshieldEvent.railgunTxid);
        }
      });
      const railgunTxids = Array.from(railgunTxidsNeedPOIs);

      if (isDefined(railgunTxidFilter) && !railgunTxids.includes(railgunTxidFilter)) {
        throw new Error('Railgun TXID not found in sent commitments / unshield events.');
      }

      const txidMerkletree = this.getRailgunTXIDMerkletreeForChain(txidVersion, chain);

      const generatePOIsDatas: GeneratePOIsData[] = [];

      // eslint-disable-next-line no-restricted-syntax
      for (const railgunTxid of railgunTxids) {
        try {
          const txidMerkletreeData = await txidMerkletree.getRailgunTxidCurrentMerkletreeData(
            railgunTxid,
          );
          const { railgunTransaction } = txidMerkletreeData;

          const poiLaunchBlock = POI.launchBlocks.get(null, txidMerkletree.chain);
          if (!isDefined(poiLaunchBlock)) {
            throw new Error('No POI launch block for railgun txids');
          }
          const isLegacyPOIProof = railgunTransaction.blockNumber < poiLaunchBlock;

          const spentTXOs = TXOs.filter((txo) =>
            railgunTransaction.nullifiers.includes(`0x${txo.nullifier}`),
          );

          const sentCommitmentsForRailgunTxid = sentCommitments.filter(
            (sentCommitment) => sentCommitment.railgunTxid === railgunTxid,
          );
          const unshieldEventsForRailgunTxid = unshieldEvents.filter(
            (unshieldEvent) => unshieldEvent.railgunTxid === railgunTxid,
          );

          if (
            railgunTransaction.commitments.length !==
            sentCommitmentsForRailgunTxid.length + unshieldEventsForRailgunTxid.length
          ) {
            EngineDebug.error(
              new Error(
                `Cannot generate unshield POI: have not decrypted commitments yet for railgunTxid ${railgunTxid}`,
              ),
            );
            continue;
          }

          if (isDefined(railgunTransaction.unshield) && !unshieldEventsForRailgunTxid.length) {
            continue;
          }

          const listKeys = POI.getListKeysCanGenerateSpentPOIs(
            spentTXOs,
            sentCommitmentsForRailgunTxid,
            unshieldEventsForRailgunTxid,
            isLegacyPOIProof,
          );
          if (!listKeys.length) {
            continue;
          }

          // Make sure Spent TXOs are ordered, so the prover's NullifierCheck and MerkleProof validation will pass.
          const orderedSpentTXOs = removeUndefineds(
            railgunTransaction.nullifiers.map((nullifier) =>
              spentTXOs.find((txo) => `0x${txo.nullifier}` === nullifier),
            ),
          );

          // eslint-disable-next-line no-restricted-syntax
          for (const listKey of listKeys) {
            // Use this syntax to capture each index and totalCount.
            generatePOIsDatas.push({
              railgunTxid,
              txid: railgunTransaction.txid,
              listKey,
              isLegacyPOIProof,
              orderedSpentTXOs,
              txidMerkletreeData,
              sentCommitmentsForRailgunTxid,
              unshieldEventsForRailgunTxid,
            });
          }
        } catch (err) {
          EngineDebug.log(`Skipping POI generation for railgunTxid: ${railgunTxid}`);
          // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
          EngineDebug.error(err);
          // DO NOT THROW. Continue with next railgunTxid...
        }
      }

      const generatePOIErrors: {
        index: number;
        errMessage: string;
        generatePOIData: GeneratePOIsData;
      }[] = [];

      // eslint-disable-next-line no-restricted-syntax
      for (let i = 0; i < generatePOIsDatas.length; i += 1) {
        try {
          await this.generatePOIsForRailgunTxidAndListKey(
            txidVersion,
            chain,
            generatePOIsDatas[i],
            i,
            generatePOIsDatas.length,
          );
        } catch (err) {
          if (!(err instanceof Error)) {
            throw new Error('Non-error thrown in generatePOIsAllSentCommitmentsAndUnshieldEvents', {
              cause: err,
            });
          }
          // Capture error, but continue with all POIs. Throw the error after.
          generatePOIErrors.push({
            // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
            index: i,
            errMessage: err.message,
            generatePOIData: generatePOIsDatas[i],
          });
        }
      }
      this.generatingPOIsForChain.set(null, chain, false);

      if (generatePOIErrors.length > 0) {
        const { index, errMessage, generatePOIData } = generatePOIErrors[0];
        const { listKey, railgunTxid, txid } = generatePOIData;
        this.emitPOIProofUpdateEvent(
          POIProofEventStatus.Error,
          txidVersion,
          chain,
          0, // Progress
          listKey,
          txid,
          railgunTxid,
          index, // index
          generatePOIsDatas.length,
          errMessage,
        );
        throw generatePOIErrors[0];
      }

      return generatePOIsDatas.length;
    } catch (cause) {
      this.generatingPOIsForChain.set(null, chain, false);
      const err = new Error(
        'Failed to generate POIs for all sent commitments and unshield events',
        { cause },
      );
      EngineDebug.error(err);
      throw err;
    }
  }

  async generatePreTransactionPOI(
    txidVersion: TXIDVersion,
    chain: Chain,
    listKey: string,
    utxos: TXO[],
    publicInputs: PublicInputsRailgun,
    privateInputs: PrivateInputsRailgun,
    treeNumber: BigNumberish,
    hasUnshield: boolean,
    progressCallback: (progress: number) => void,
  ): Promise<{ txidLeafHash: string; preTransactionPOI: PreTransactionPOI }> {
    const { commitmentsOut, nullifiers, boundParamsHash } = publicInputs;
    const utxoTreeIn = BigInt(treeNumber);

    const globalTreePosition = getGlobalTreePositionPreTransactionPOIProof();

    const railgunTxidBigInt = getRailgunTransactionIDFromBigInts(
      nullifiers,
      commitmentsOut,
      boundParamsHash,
    );
    const txidLeafHash = getRailgunTxidLeafHash(railgunTxidBigInt, utxoTreeIn, globalTreePosition);
    const railgunTxidHex = nToHex(railgunTxidBigInt, ByteLength.UINT_256);

    const blindedCommitmentsIn = removeUndefineds(utxos.map((txo) => txo.blindedCommitment));
    if (blindedCommitmentsIn.length !== nullifiers.length) {
      throw new Error(
        `Not enough UTXO blinded commitments for railgun transaction nullifiers: expected ${nullifiers.length}, got ${blindedCommitmentsIn.length}`,
      );
    }

    const listPOIMerkleProofs: MerkleProof[] = await AbstractWallet.getListPOIMerkleProofs(
      txidVersion,
      chain,
      listKey,
      blindedCommitmentsIn,
      false, // isLegacyPOIProof
    );

    const railgunTxidIfHasUnshield = hasUnshield
      ? getBlindedCommitmentForUnshield(railgunTxidHex)
      : '0x00';

    listPOIMerkleProofs.forEach((listMerkleProof, listMerkleProofIndex) => {
      if (!verifyMerkleProof(listMerkleProof)) {
        throw new Error(`Invalid list merkleproof: index ${listMerkleProofIndex}`);
      }
    });

    const merkleProofForRailgunTxid = createDummyMerkleProof(txidLeafHash);
    if (!verifyMerkleProof(merkleProofForRailgunTxid)) {
      throw new Error('Invalid txid merkle proof');
    }

    const nonUnshieldCommitments = hasUnshield ? commitmentsOut.slice(0, -1) : commitmentsOut;
    const blindedCommitmentsOut = nonUnshieldCommitments.map((commitment, i) => {
      return getBlindedCommitmentForShieldOrTransact(
        nToHex(commitment, ByteLength.UINT_256, true),
        privateInputs.npkOut[i],
        globalTreePosition + BigInt(i),
      );
    });

    const poiMerkleroots = listPOIMerkleProofs.map((merkleProof) => merkleProof.root);

    const poiProofInputs: POIEngineProofInputs = {
      // --- Public inputs ---
      anyRailgunTxidMerklerootAfterTransaction: merkleProofForRailgunTxid.root,

      // --- Private inputs ---

      // Railgun Transaction info
      boundParamsHash: nToHex(boundParamsHash, ByteLength.UINT_256, true),
      nullifiers: nullifiers.map((el) => nToHex(el, ByteLength.UINT_256, true)),
      commitmentsOut: commitmentsOut.map((el) => nToHex(el, ByteLength.UINT_256, true)),

      // Spender wallet info
      spendingPublicKey: this.spendingPublicKey,
      nullifyingKey: this.nullifyingKey,

      // Nullified notes data
      token: utxos[0].note.tokenHash,
      randomsIn: utxos.map((txo) => txo.note.random),
      valuesIn: utxos.map((txo) => txo.note.value),
      utxoPositionsIn: utxos.map((txo) => txo.position),
      utxoTreeIn: utxos[0].tree,

      // Commitment notes data
      npksOut: hasUnshield ? privateInputs.npkOut.slice(0, -1) : privateInputs.npkOut,
      valuesOut: hasUnshield ? privateInputs.valueOut.slice(0, -1) : privateInputs.valueOut,
      utxoBatchGlobalStartPositionOut: getGlobalTreePosition(
        GLOBAL_UTXO_TREE_PRE_TRANSACTION_POI_PROOF_HARDCODED_VALUE,
        GLOBAL_UTXO_POSITION_PRE_TRANSACTION_POI_PROOF_HARDCODED_VALUE,
      ),
      railgunTxidIfHasUnshield,

      // Railgun txid tree
      railgunTxidMerkleProofIndices: merkleProofForRailgunTxid.indices,
      railgunTxidMerkleProofPathElements: merkleProofForRailgunTxid.elements,

      // POI tree
      poiMerkleroots,
      poiInMerkleProofIndices: listPOIMerkleProofs.map((merkleProof) => merkleProof.indices),
      poiInMerkleProofPathElements: listPOIMerkleProofs.map((merkleProof) => merkleProof.elements),
    };

    const { proof: snarkProof } = await this.prover.provePOI(
      poiProofInputs,
      listKey,
      blindedCommitmentsIn,
      blindedCommitmentsOut,
      progressCallback,
    );

    const preTransactionPOI: PreTransactionPOI = {
      snarkProof,
      txidMerkleroot: merkleProofForRailgunTxid.root,
      poiMerkleroots,
      blindedCommitmentsOut,
      railgunTxidIfHasUnshield,
    };

    return { txidLeafHash, preTransactionPOI };
  }

  private async generatePOIsForRailgunTxidAndListKey(
    txidVersion: TXIDVersion,
    chain: Chain,
    generatePOIsData: GeneratePOIsData,
    index: number,
    totalCount: number,
  ): Promise<void> {
    const {
      railgunTxid,
      listKey,
      isLegacyPOIProof,
      orderedSpentTXOs,
      txidMerkletreeData,
      sentCommitmentsForRailgunTxid,
      unshieldEventsForRailgunTxid,
    } = generatePOIsData;
    const { railgunTransaction } = txidMerkletreeData;

    try {
      if (railgunTransaction.railgunTxid !== railgunTxid) {
        throw new Error('Invalid railgun transaction data for proof');
      }

      EngineDebug.log(`Generating POI for RAILGUN transaction:`);
      EngineDebug.log(stringifySafe(railgunTransaction));

      // Spent TXOs
      const blindedCommitmentsIn = removeUndefineds(
        orderedSpentTXOs.map((txo) => txo.blindedCommitment),
      );
      if (blindedCommitmentsIn.length !== railgunTransaction.nullifiers.length) {
        if (!orderedSpentTXOs.length) {
          throw new Error(`No spent TXOs found for nullifier - data is likely still syncing.`);
        }
        throw new Error(
          `Not enough TXO blinded commitments for railgun transaction nullifiers: expected ${railgunTransaction.nullifiers.length}, got ${blindedCommitmentsIn.length}`,
        );
      }

      const listPOIMerkleProofs: MerkleProof[] = await AbstractWallet.getListPOIMerkleProofs(
        txidVersion,
        chain,
        listKey,
        blindedCommitmentsIn,
        isLegacyPOIProof,
      );

      if (unshieldEventsForRailgunTxid.length > 1) {
        throw new Error('Cannot have more than 1 unshield event per railgun txid');
      }

      const hasUnshield = unshieldEventsForRailgunTxid.length > 0;
      if (isDefined(railgunTransaction.unshield) !== hasUnshield) {
        throw new Error(`Expected unshield railgun transaction to have matching unshield event`);
      }

      const numRailgunTransactionCommitmentsWithoutUnshields = hasUnshield
        ? railgunTransaction.commitments.length - 1
        : railgunTransaction.commitments.length;

      // Use 0x00 if there is no unshield.
      const railgunTxidIfHasUnshield = hasUnshield
        ? getBlindedCommitmentForUnshield(railgunTxid)
        : '0x00';

      if (!sentCommitmentsForRailgunTxid.length && !unshieldEventsForRailgunTxid.length) {
        throw new Error(
          `No sent commitments w/ values or unshield events for railgun txid: ${railgunTxid}`,
        );
      }

      // Do not send 'npks' for unshields. Send for all commitments (so they match the number of commitmentsOut - unshields).
      const npksOut: bigint[] = sentCommitmentsForRailgunTxid.map(
        (sentCommitment) => sentCommitment.note.notePublicKey,
      );
      if (npksOut.length !== numRailgunTransactionCommitmentsWithoutUnshields) {
        throw new Error(
          `Invalid number of npksOut for transaction sent commitments: expected ${numRailgunTransactionCommitmentsWithoutUnshields}, got ${npksOut.length}`,
        );
      }

      // Do not send 'values' for unshields. Send for all commitments (so they match the number of commitmentsOut - unshields).
      const valuesOut: bigint[] = sentCommitmentsForRailgunTxid.map(
        (sentCommitment) => sentCommitment.note.value,
      );
      if (valuesOut.length !== numRailgunTransactionCommitmentsWithoutUnshields) {
        throw new Error(
          `Invalid number of valuesOut for transaction sent commitments: expected ${numRailgunTransactionCommitmentsWithoutUnshields}, got ${valuesOut.length}`,
        );
      }

      // Do not send 'blinded commitments' for unshields. Send for all commitments. Zero out any with 0-values.
      const blindedCommitmentsOut: string[] = removeUndefineds(
        sentCommitmentsForRailgunTxid.map((sentCommitment) => {
          if (sentCommitment.note.value === 0n) {
            // Zero-out any 0-value commitment so this blindedCommitment matches the circuit.
            return ZERO_32_BYTE_VALUE;
          }
          return sentCommitment.blindedCommitment;
        }),
      );
      if (blindedCommitmentsOut.length !== numRailgunTransactionCommitmentsWithoutUnshields) {
        throw new Error(
          `Not enough blindedCommitments out for transaction sent commitments (ONLY with values): expected ${numRailgunTransactionCommitmentsWithoutUnshields}, got ${blindedCommitmentsOut.length}`,
        );
      }

      const anyRailgunTxidMerklerootAfterTransaction =
        txidMerkletreeData.currentMerkleProofForTree.root;

      const merkleProofForRailgunTxid: MerkleProof = {
        leaf: railgunTransaction.hash,
        root: txidMerkletreeData.currentMerkleProofForTree.root,
        indices: txidMerkletreeData.currentMerkleProofForTree.indices,
        elements: txidMerkletreeData.currentMerkleProofForTree.elements,
      };
      if (!verifyMerkleProof(merkleProofForRailgunTxid)) {
        throw new Error(
          isLegacyPOIProof ? 'Invalid TXID merkleproof (snapshot)' : 'Invalid TXID merkleproof',
        );
      }
      listPOIMerkleProofs.forEach((listMerkleProof, listMerkleProofIndex) => {
        if (!verifyMerkleProof(listMerkleProof)) {
          throw new Error(`Invalid list merkleproof: index ${listMerkleProofIndex}`);
        }
      });

      const poiProofInputs: POIEngineProofInputs = {
        // --- Public inputs ---
        anyRailgunTxidMerklerootAfterTransaction: merkleProofForRailgunTxid.root,

        // --- Private inputs ---

        // Railgun Transaction info
        boundParamsHash: railgunTransaction.boundParamsHash,
        nullifiers: railgunTransaction.nullifiers,
        commitmentsOut: railgunTransaction.commitments,

        // Spender wallet info
        spendingPublicKey: this.spendingPublicKey,
        nullifyingKey: this.nullifyingKey,

        // Nullified notes data
        token: orderedSpentTXOs[0].note.tokenHash,
        randomsIn: orderedSpentTXOs.map((txo) => txo.note.random),
        valuesIn: orderedSpentTXOs.map((txo) => txo.note.value),
        utxoPositionsIn: orderedSpentTXOs.map((txo) => txo.position),
        utxoTreeIn: orderedSpentTXOs[0].tree,

        // Commitment notes data
        npksOut,
        valuesOut,
        utxoBatchGlobalStartPositionOut: getGlobalTreePosition(
          railgunTransaction.utxoTreeOut,
          railgunTransaction.utxoBatchStartPositionOut,
        ),
        railgunTxidIfHasUnshield,

        // Railgun txid tree
        railgunTxidMerkleProofIndices: merkleProofForRailgunTxid.indices,
        railgunTxidMerkleProofPathElements: merkleProofForRailgunTxid.elements,

        // POI tree
        poiMerkleroots: listPOIMerkleProofs.map((merkleProof) => merkleProof.root),
        poiInMerkleProofIndices: listPOIMerkleProofs.map((merkleProof) => merkleProof.indices),
        poiInMerkleProofPathElements: listPOIMerkleProofs.map(
          (merkleProof) => merkleProof.elements,
        ),
      };

      const { proof: snarkProof } = await this.prover.provePOI(
        poiProofInputs,
        listKey,
        blindedCommitmentsIn,
        blindedCommitmentsOut,
        (progress: number) => {
          this.emitPOIProofUpdateEvent(
            POIProofEventStatus.InProgress,
            txidVersion,
            chain,
            progress,
            listKey,
            railgunTransaction.txid,
            railgunTxid,
            index,
            totalCount,
            undefined, // errorMsg
          );
        },
      );

      await POI.submitPOI(
        txidVersion,
        chain,
        listKey,
        snarkProof,
        poiProofInputs.poiMerkleroots,
        anyRailgunTxidMerklerootAfterTransaction,
        txidMerkletreeData.currentTxidIndexForTree,
        blindedCommitmentsOut,
        railgunTxidIfHasUnshield,
      );
    } catch (cause) {
      const err = new Error(`Failed to generate POIs for txid ${railgunTxid}`, { cause });
      EngineDebug.error(err);
      throw err;
    }
  }

  async isValidSpendableTransaction(
    txidVersion: TXIDVersion,
    chain: Chain,
    contractAddress: string,
    transactionRequest: ContractTransaction,
    useRelayAdapt: boolean,
    pois: PreTransactionPOIsPerTxidLeafPerList,
  ): Promise<{
    isValid: boolean;
    error?: string;
    extractedRailgunTransactionData?: ExtractedRailgunTransactionData;
  }> {
    return POIValidation.isValidSpendableTransaction(
      txidVersion,
      chain,
      this.prover,
      transactionRequest,
      useRelayAdapt,
      contractAddress,
      pois,
      this.getViewingKeyPair().privateKey,
      this.addressKeys,
      this.tokenDataGetter,
    );
  }

  private static async getListPOIMerkleProofs(
    txidVersion: TXIDVersion,
    chain: Chain,
    listKey: string,
    blindedCommitmentsIn: string[],
    isLegacyPOIProof: boolean,
  ): Promise<MerkleProof[]> {
    if (isLegacyPOIProof) {
      return blindedCommitmentsIn.map(createDummyMerkleProof);
    }
    return POI.getPOIMerkleProofs(txidVersion, chain, listKey, blindedCommitmentsIn);
  }

  private async updateReceiveCommitmentCreatedPOIs(
    chain: Chain,
    tree: number,
    position: number,
    poisPerList: POIsPerList,
  ): Promise<void> {
    const dbPath = this.getWalletReceiveCommitmentDBPrefix(chain, tree, position);
    const data = (await this.db.get(dbPath)) as BytesData;
    const receiveCommitment = msgpack.decode(arrayify(data)) as StoredReceiveCommitment;

    if (JSON.stringify(receiveCommitment.poisPerList) !== JSON.stringify(poisPerList)) {
      // Update receiveCommitment if POIs have changed.
      receiveCommitment.poisPerList = poisPerList;
      await this.updateReceiveCommitmentInDB(chain, tree, position, receiveCommitment);
    }
  }

  private async updateSentCommitmentSpentPOIs(
    chain: Chain,
    tree: number,
    position: number,
    poisPerList: POIsPerList,
  ): Promise<void> {
    const dbPath = this.getWalletSentCommitmentDBPrefix(chain, tree, position);
    const data = (await this.db.get(dbPath)) as BytesData;
    const sentCommitment = msgpack.decode(arrayify(data)) as StoredSendCommitment;

    if (JSON.stringify(sentCommitment.poisPerList) !== JSON.stringify(poisPerList)) {
      // Update sentCommitment if POIs have changed.
      sentCommitment.poisPerList = poisPerList;
      await this.updateSentCommitmentInDB(chain, tree, position, sentCommitment);
    }
  }

  private static getPossibleChangeTokenAmounts(
    historyItem: TransactionHistoryEntry,
  ): TransactionHistoryTokenAmount[] {
    switch (historyItem.version) {
      case TransactionHistoryItemVersion.Unknown:
      case TransactionHistoryItemVersion.Legacy:
        // Legacy versions don't have change token amounts.
        return historyItem.transferTokenAmounts;
      case TransactionHistoryItemVersion.UpdatedAug2022:
      case TransactionHistoryItemVersion.UpdatedNov2022:
        return historyItem.changeTokenAmounts;
    }
    throw new Error('Unrecognized history item version');
  }

  /**
   * Gets transactions history
   * @param chain - chain type/id to get transaction history for
   * @returns history
   */
  async getTransactionHistory(
    chain: Chain,
    startingBlock: Optional<number>,
  ): Promise<TransactionHistoryEntry[]> {
    const transactionHistory: TransactionHistoryEntry[] = [];
    // eslint-disable-next-line no-restricted-syntax
    for (const txidVersion of ACTIVE_TXID_VERSIONS) {
      if (!getChainSupportsV3(chain) && txidVersion === TXIDVersion.V3_PoseidonMerkle) {
        continue;
      }
      transactionHistory.push(
        ...(await this.getTransactionHistoryByTXIDVersion(txidVersion, chain, startingBlock)),
      );
    }
    return transactionHistory;
  }

  private async getTransactionHistoryByTXIDVersion(
    txidVersion: TXIDVersion,
    chain: Chain,
    startingBlock: Optional<number>,
  ): Promise<TransactionHistoryEntry[]> {
    const TXOs = await this.TXOs(txidVersion, chain);
    const filteredTXOs = AbstractWallet.filterTXOsByBlockNumber(TXOs, startingBlock);

    const [receiveHistory, spendHistory] = await Promise.all([
      AbstractWallet.getTransactionReceiveHistory(txidVersion, filteredTXOs),
      this.getTransactionSpendHistory(txidVersion, chain, filteredTXOs, startingBlock),
    ]);

    const history: TransactionHistoryEntry[] = spendHistory.map((sendItem) => ({
      ...sendItem,
      receiveTokenAmounts: [],
    }));

    // Merge "spent" history with "receive" history items.
    // We have to remove all "receive" items that are change outputs.
    receiveHistory.forEach((receiveItem) => {
      let alreadyExistsInHistory = false;

      history.forEach((existingHistoryItem) => {
        if (receiveItem.txid === existingHistoryItem.txid) {
          alreadyExistsInHistory = true;
          const changeTokenAmounts =
            AbstractWallet.getPossibleChangeTokenAmounts(existingHistoryItem);
          receiveItem.receiveTokenAmounts.forEach((receiveTokenAmount) => {
            const matchingChangeOutput = changeTokenAmounts.find(
              (ta) =>
                ta.tokenHash === receiveTokenAmount.tokenHash &&
                ta.amount === receiveTokenAmount.amount,
            );
            if (
              matchingChangeOutput &&
              [
                TransactionHistoryItemVersion.Unknown,
                TransactionHistoryItemVersion.Legacy,
              ].includes(existingHistoryItem.version)
            ) {
              // Remove change output (stored in transferTokenAmounts in legacy history items)
              // Move to change outputs
              const index = existingHistoryItem.transferTokenAmounts.findIndex(
                (ta) =>
                  ta.tokenHash === receiveTokenAmount.tokenHash &&
                  ta.amount === receiveTokenAmount.amount,
              );
              existingHistoryItem.transferTokenAmounts.splice(index, 1);
              existingHistoryItem.changeTokenAmounts.push(matchingChangeOutput);
            } else if (!matchingChangeOutput) {
              // Receive token amount is not a "change" output.
              // Add it to the history item.
              existingHistoryItem.receiveTokenAmounts.push(receiveTokenAmount);
            }
          });
        }
      });
      if (!alreadyExistsInHistory) {
        history.unshift({
          ...receiveItem,
          transferTokenAmounts: [],
          changeTokenAmounts: [],
          unshieldTokenAmounts: [],
          version: TransactionHistoryItemVersion.Unknown,
        });
      }
    });

    return history;
  }

  private static filterTXOsByBlockNumber(txos: TXO[], startingBlock: Optional<number>) {
    if (startingBlock == null) {
      return txos;
    }

    let hasShownNoBlockNumbersError = false;
    return txos.filter((txo) => {
      if (!isDefined(txo.note.blockNumber)) {
        if (!hasShownNoBlockNumbersError) {
          // This will occur for legacy scanned notes.
          // New notes will have block number, and will optimize the history response.
          EngineDebug.error(new Error('No blockNumbers for TXOs'));
          hasShownNoBlockNumbersError = true;
        }
        return true;
      }
      return txo.note.blockNumber >= startingBlock;
    });
  }

  async extractFirstNoteERC20AmountMap(
    txidVersion: TXIDVersion,
    chain: Chain,
    transactionRequest: ContractTransaction,
    useRelayAdapt: boolean,
    contractAddress: string,
  ) {
    return extractFirstNoteERC20AmountMapFromTransactionRequest(
      txidVersion,
      chain,
      transactionRequest,
      useRelayAdapt,
      contractAddress,
      this.getViewingKeyPair().privateKey,
      this.addressKeys,
      this.tokenDataGetter,
    );
  }

  /**
   * Gets transactions history for "received" transactions
   * @param chain - chain type/id to get balances for
   * @returns history
   */
  private static getTransactionReceiveHistory(
    txidVersion: TXIDVersion,
    filteredTXOs: TXO[],
  ): TransactionHistoryEntryReceived[] {
    const txidTransactionMap: { [txid: string]: TransactionHistoryEntryReceived } = {};

    filteredTXOs.forEach((txo) => {
      const { txid, timestamp, note } = txo;
      if (note.value === 0n) {
        return;
      }
      if (!isDefined(txidTransactionMap[txid])) {
        txidTransactionMap[txid] = {
          txidVersion,
          txid,
          timestamp,
          blockNumber: note.blockNumber,
          receiveTokenAmounts: [],
        };
      }
      const tokenHash = formatToByteLength(note.tokenHash, ByteLength.UINT_256, false);
      txidTransactionMap[txid].receiveTokenAmounts.push({
        tokenHash,
        tokenData: note.tokenData,
        amount: note.value,
        memoText: note.memoText,
        senderAddress: note.getSenderAddress(),
        shieldFee: note.shieldFee,
        balanceBucket: POI.getBalanceBucket(txo),
        hasValidPOIForActiveLists: POI.hasValidPOIsActiveLists(txo.poisPerList),
      });
    });

    const history: TransactionHistoryEntryReceived[] = Object.values(txidTransactionMap);
    return history;
  }

  private static getTransactionHistoryItemVersion(
    outputType: Optional<OutputType>,
    isLegacyTransactNote: boolean,
  ) {
    if (!isDefined(outputType)) {
      return TransactionHistoryItemVersion.Legacy;
    }
    if (isLegacyTransactNote) {
      return TransactionHistoryItemVersion.UpdatedAug2022;
    }
    return TransactionHistoryItemVersion.UpdatedNov2022;
  }

  /**
   * NOTE: There are no Unshield events pre-V2.
   */
  async getUnshieldEventsFromSpentNullifiers(
    txidVersion: TXIDVersion,
    chain: Chain,
    filteredTXOs: TXO[],
  ): Promise<UnshieldStoredEvent[]> {
    if (!this.hasUTXOMerkletree(txidVersion, chain)) {
      return [];
    }
    const merkletree = this.getUTXOMerkletree(txidVersion, chain);
    const unshieldEvents: UnshieldStoredEvent[] = [];

    const seenSpentTxids: string[] = [];

    const spentTXOs = filteredTXOs.filter(
      (txo) => isDefined(txo.spendtxid) && txo.spendtxid !== false,
    );

    await Promise.all(
      spentTXOs.map(async ({ spendtxid, note }) => {
        if (note.value === 0n) {
          return;
        }
        if (spendtxid === false || !spendtxid) {
          return;
        }
        if (seenSpentTxids.includes(spendtxid)) {
          return;
        }
        seenSpentTxids.push(spendtxid);

        // Nullifier exists. Find unshield events from txid.

        // NOTE: There are no Unshield events pre-V2.
        const unshieldEventsForNullifier = await merkletree.getAllUnshieldEventsForTxid(spendtxid);
        const filteredUnshieldEventsForNullifier = unshieldEventsForNullifier.filter(
          (event) =>
            unshieldEvents.find((existingUnshieldEvent) =>
              AbstractWallet.compareUnshieldEvents(existingUnshieldEvent, event),
            ) == null,
        );
        unshieldEvents.push(...filteredUnshieldEventsForNullifier);
      }),
    );

    return unshieldEvents;
  }

  private static compareUnshieldEvents(a: UnshieldStoredEvent, b: UnshieldStoredEvent): boolean {
    return (
      a.txid === b.txid &&
      (a.eventLogIndex === b.eventLogIndex ||
        (isDefined(a.railgunTxid) && a.railgunTxid === b.railgunTxid))
    );
  }

  private async getTransactionSpendHistory(
    txidVersion: TXIDVersion,
    chain: Chain,
    filteredTXOs: TXO[],
    startingBlock: Optional<number>,
  ): Promise<TransactionHistoryEntrySpent[]> {
    const [allUnshieldEvents, sentCommitments] = await Promise.all([
      this.getUnshieldEventsFromSpentNullifiers(txidVersion, chain, filteredTXOs),
      this.getSentCommitments(txidVersion, chain, startingBlock),
    ]);

    const txidTransactionMap: { [txid: string]: TransactionHistoryEntryPreprocessSpent } = {};

    sentCommitments.forEach((sentCommitment) => {
      const { txid, timestamp, note, isLegacyTransactNote, outputType, walletSource } =
        sentCommitment;
      if (note.value === 0n) {
        return;
      }
      if (!isDefined(txidTransactionMap[txid])) {
        txidTransactionMap[txid] = {
          txid,
          timestamp,
          blockNumber: note.blockNumber,
          tokenAmounts: [],
          unshieldEvents: [],
          version: AbstractWallet.getTransactionHistoryItemVersion(
            outputType,
            isLegacyTransactNote,
          ),
        };
      }

      const tokenHash = formatToByteLength(note.tokenHash, ByteLength.UINT_256, false);
      const tokenAmount: TransactionHistoryTokenAmount | TransactionHistoryTransferTokenAmount = {
        tokenHash,
        tokenData: note.tokenData,
        amount: note.value,
        outputType,
        walletSource,
        memoText: note.memoText,
        hasValidPOIForActiveLists: POI.hasValidPOIsActiveLists(sentCommitment.poisPerList),
      };
      const isNonLegacyTransfer = !isLegacyTransactNote && outputType === OutputType.Transfer;
      if (isNonLegacyTransfer) {
        (tokenAmount as TransactionHistoryTransferTokenAmount).recipientAddress = encodeAddress(
          note.receiverAddressData,
        );
      }
      txidTransactionMap[txid].tokenAmounts.push(tokenAmount);
    });

    // Add unshield events to txidTransactionMap
    allUnshieldEvents.forEach((unshieldEvent) => {
      const foundUnshieldTransactionInTransactCommitments = txidTransactionMap[unshieldEvent.txid];
      if (!isDefined(foundUnshieldTransactionInTransactCommitments)) {
        // This will occur on a self-signed unshield.
        // There is no commitment (or tokenAmounts) for this kind of unshield transaction.
        txidTransactionMap[unshieldEvent.txid] = {
          txid: unshieldEvent.txid,
          timestamp: unshieldEvent.timestamp,
          blockNumber: unshieldEvent.blockNumber,
          unshieldEvents: [unshieldEvent],
          tokenAmounts: [],
          version: TransactionHistoryItemVersion.UpdatedNov2022,
        };
        return;
      }

      // Unshield event exists. Add to its amount rather than creating a new event.
      // Multiple unshields of the same token can occur in cases of complex circuits. (More than 10 inputs to the unshield).
      const existingUnshieldEvent = txidTransactionMap[unshieldEvent.txid].unshieldEvents.find(
        (existingEvent) => AbstractWallet.compareUnshieldEvents(existingEvent, unshieldEvent),
      );
      if (existingUnshieldEvent) {
        // Add amount to existing unshield event.
        existingUnshieldEvent.amount = (
          BigInt(existingUnshieldEvent.amount) + BigInt(unshieldEvent.amount)
        ).toString();
        return;
      }
      txidTransactionMap[unshieldEvent.txid].unshieldEvents.push(unshieldEvent);
    });

    const preProcessHistory: TransactionHistoryEntryPreprocessSpent[] =
      Object.values(txidTransactionMap);

    const history: TransactionHistoryEntrySpent[] = preProcessHistory.map(
      ({ txid, timestamp, blockNumber, tokenAmounts, unshieldEvents, version }) => {
        const transferTokenAmounts: TransactionHistoryTransferTokenAmount[] = [];
        let relayerFeeTokenAmount: Optional<TransactionHistoryTokenAmount>;
        const changeTokenAmounts: TransactionHistoryTokenAmount[] = [];

        tokenAmounts.forEach((tokenAmount) => {
          if (!isDefined(tokenAmount.outputType)) {
            // Legacy notes without extra data, consider as a simple "transfer".
            transferTokenAmounts.push(tokenAmount as TransactionHistoryTransferTokenAmount);
            return;
          }

          switch (tokenAmount.outputType) {
            case OutputType.Transfer:
              transferTokenAmounts.push(
                // NOTE: recipientAddress is set during pre-process for all non-legacy Transfers.
                tokenAmount as TransactionHistoryTransferTokenAmount,
              );
              break;
            case OutputType.RelayerFee:
              relayerFeeTokenAmount = tokenAmount;
              break;
            case OutputType.Change:
              changeTokenAmounts.push(tokenAmount);
              break;
          }
        });

        const unshieldTokenAmounts: TransactionHistoryUnshieldTokenAmount[] = unshieldEvents.map(
          (unshieldEvent) => {
            const tokenData = serializeTokenData(
              unshieldEvent.tokenAddress,
              unshieldEvent.tokenType,
              unshieldEvent.tokenSubID,
            );
            const tokenHash = getTokenDataHash(tokenData);
            return {
              tokenHash,
              tokenData,
              amount: BigInt(unshieldEvent.amount),
              memoText: undefined,
              recipientAddress: unshieldEvent.toAddress,
              senderAddress: undefined,
              unshieldFee: unshieldEvent.fee,
              hasValidPOIForActiveLists: POI.hasValidPOIsActiveLists(unshieldEvent.poisPerList),
            };
          },
        );

        const historyEntry: TransactionHistoryEntrySpent = {
          txidVersion,
          txid,
          timestamp,
          blockNumber,
          transferTokenAmounts,
          relayerFeeTokenAmount,
          changeTokenAmounts,
          unshieldTokenAmounts,
          version,
        };
        return historyEntry;
      },
    );

    return history;
  }

  getUTXOMerkletree(txidVersion: TXIDVersion, chain: Chain): UTXOMerkletree {
    if (txidVersion === TXIDVersion.V3_PoseidonMerkle) {
      assertChainSupportsV3(chain);
    }
    const merkletree = this.utxoMerkletrees.get(txidVersion, chain);
    if (!isDefined(merkletree)) {
      throw new Error(`No utxo merkletree for chain ${chain.type}:${chain.id}, ${txidVersion}`);
    }
    return merkletree;
  }

  private hasUTXOMerkletree(txidVersion: TXIDVersion, chain: Chain): boolean {
    try {
      this.getUTXOMerkletree(txidVersion, chain);
      return true;
    } catch {
      return false;
    }
  }

  getRailgunTXIDMerkletreeForChain(txidVersion: TXIDVersion, chain: Chain): TXIDMerkletree {
    const merkletree = this.txidMerkletrees.get(txidVersion, chain);
    if (!isDefined(merkletree)) {
      throw new Error(`No txid merkletree for chain ${chain.type}:${chain.id}`);
    }
    return merkletree;
  }

  async getTokenBalancesAllTxidVersions(
    chain: Chain,
    balanceBucketFilter: WalletBalanceBucket[],
  ): Promise<TokenBalancesAllTxidVersions> {
    const balances: TokenBalancesAllTxidVersions = {};

    // eslint-disable-next-line no-restricted-syntax
    for (const txidVersion of ACTIVE_TXID_VERSIONS) {
      if (!getChainSupportsV3(chain) && txidVersion === TXIDVersion.V3_PoseidonMerkle) {
        continue;
      }
      const TXOs = await this.TXOs(txidVersion, chain);
      const balancesByTxidVersion = await AbstractWallet.getTokenBalancesByTxidVersion(
        TXOs,
        balanceBucketFilter,
      );

      Object.keys(balancesByTxidVersion).forEach((tokenHash) => {
        balances[txidVersion] ??= {};
        balances[txidVersion][tokenHash] = balancesByTxidVersion[tokenHash];
      });
    }

    return balances;
  }

  async getTokenBalances(
    txidVersion: TXIDVersion,
    chain: Chain,
    onlySpendable: boolean,
  ): Promise<TokenBalances> {
    const balanceBucketFilter = onlySpendable
      ? await POI.getSpendableBalanceBuckets(chain)
      : Object.values(WalletBalanceBucket);
    const TXOs = await this.TXOs(txidVersion, chain);
    return AbstractWallet.getTokenBalancesByTxidVersion(TXOs, balanceBucketFilter);
  }

  async getTokenBalancesForUnshieldToOrigin(
    txidVersion: TXIDVersion,
    chain: Chain,
    originShieldTxidForSpendabilityOverride?: string,
  ): Promise<TokenBalances> {
    const TXOs = await this.TXOs(txidVersion, chain);
    return AbstractWallet.getTokenBalancesByTxidVersion(
      TXOs,
      [],
      originShieldTxidForSpendabilityOverride,
    );
  }

  async getTokenBalancesByBucket(
    txidVersion: TXIDVersion,
    chain: Chain,
  ): Promise<Record<WalletBalanceBucket, TokenBalances>> {
    const TXOs = await this.TXOs(txidVersion, chain);

    const balancesByBucket: Partial<Record<WalletBalanceBucket, TokenBalances>> = {};

    // eslint-disable-next-line no-restricted-syntax
    for (const balanceBucket of Object.values(WalletBalanceBucket)) {
      const balanceBucketFilter = [balanceBucket];
      balancesByBucket[balanceBucket] = await AbstractWallet.getTokenBalancesByTxidVersion(
        TXOs,
        balanceBucketFilter,
      );
    }

    return balancesByBucket as Record<WalletBalanceBucket, TokenBalances>;
  }

  /**
   * Gets wallet balances
   * @param chain - chain type/id to get balances for
   * @returns balances
   */
  static async getTokenBalancesByTxidVersion(
    TXOs: TXO[],
    balanceBucketFilter: WalletBalanceBucket[],
    originShieldTxidForSpendabilityOverride?: string,
  ): Promise<TokenBalances> {
    const tokenBalances: TokenBalances = {};

    // Loop through each TXO and add to balances if unspent
    TXOs.forEach((txo) => {
      const tokenHash = formatToByteLength(txo.note.tokenHash, ByteLength.UINT_256, false);
      // If we don't have an entry for this token yet, create one
      if (!isDefined(tokenBalances[tokenHash])) {
        tokenBalances[tokenHash] = {
          balance: BigInt(0),
          utxos: [],
          tokenData: txo.note.tokenData,
        };
      }

      const isSpent = txo.spendtxid !== false;
      if (isSpent) {
        return;
      }

      const balanceBucket = POI.getBalanceBucket(txo);

      if (isDefined(originShieldTxidForSpendabilityOverride)) {
        // Only for Unshield-To-Origin transactions. Filter TXOs by the provided shield txid.
        if (
          !isShieldCommitmentType(txo.commitmentType) ||
          formatToByteLength(txo.txid, ByteLength.UINT_256) !==
            formatToByteLength(originShieldTxidForSpendabilityOverride, ByteLength.UINT_256)
        ) {
          // Skip if txid doesn't match.
          return;
        }
      } else if (!balanceBucketFilter.includes(balanceBucket)) {
        if (EngineDebug.isTestRun() && balanceBucket === WalletBalanceBucket.Spendable) {
          // WARNING FOR TESTS ONLY
          EngineDebug.error(
            new Error(
              'WARNING: Missing SPENDABLE balance - likely needs refreshPOIsForAllTXIDVersions before getting balance',
            ),
          );
        }
        return;
      }

      // Store utxo
      tokenBalances[tokenHash].utxos.push(txo);
      // Increment balance
      tokenBalances[tokenHash].balance += txo.note.value;
    });

    return tokenBalances;
  }

  async getBalanceERC20(
    txidVersion: TXIDVersion,
    chain: Chain,
    tokenAddress: string,
    balanceBucketFilter: WalletBalanceBucket[],
  ): Promise<Optional<bigint>> {
    const TXOs = await this.TXOs(txidVersion, chain);
    const balances = await AbstractWallet.getTokenBalancesByTxidVersion(TXOs, balanceBucketFilter);
    const tokenHash = getTokenDataHash(getTokenDataERC20(tokenAddress));
    const balanceForToken = balances[tokenHash];
    return isDefined(balanceForToken) ? balanceForToken.balance : undefined;
  }

  /**
   * Sort token balances by tree
   * @param chain - chain type/id of token
   * @returns balances by tree
   */
  async getTotalBalancesByTreeNumber(
    txidVersion: TXIDVersion,
    chain: Chain,
    balanceBucketFilter: WalletBalanceBucket[],
    originShieldTxidForSpendabilityOverride?: string,
  ): Promise<TotalBalancesByTreeNumber> {
    const TXOs = await this.TXOs(txidVersion, chain);

    const tokenBalances = await AbstractWallet.getTokenBalancesByTxidVersion(
      TXOs,
      balanceBucketFilter,
      originShieldTxidForSpendabilityOverride,
    );

    // Sort token balances by tree
    const totalBalancesByTreeNumber: TotalBalancesByTreeNumber = {};

    // Loop through each token

    Object.keys(tokenBalances).forEach((tokenHash) => {
      // Create balances tree array
      totalBalancesByTreeNumber[tokenHash] = [];

      // Loop through each TXO and sort by tree
      tokenBalances[tokenHash].utxos.forEach((utxo) => {
        if (!isDefined(totalBalancesByTreeNumber[tokenHash][utxo.tree])) {
          totalBalancesByTreeNumber[tokenHash][utxo.tree] = {
            balance: utxo.note.value,
            utxos: [utxo],
            tokenData: utxo.note.tokenData,
          };
        } else {
          totalBalancesByTreeNumber[tokenHash][utxo.tree].balance += utxo.note.value;
          totalBalancesByTreeNumber[tokenHash][utxo.tree].utxos.push(utxo);
        }
      });
    });

    return totalBalancesByTreeNumber;
  }

  async balancesByTreeForToken(
    txidVersion: TXIDVersion,
    chain: Chain,
    tokenHash: string,
    balanceBucketFilter: WalletBalanceBucket[],
    originShieldTxidForSpendabilityOverride?: string,
  ): Promise<TreeBalance[]> {
    const totalBalancesByTreeNumber = await this.getTotalBalancesByTreeNumber(
      txidVersion,
      chain,
      balanceBucketFilter,
      originShieldTxidForSpendabilityOverride,
    );
    const treeSortedBalances = totalBalancesByTreeNumber[tokenHash] ?? [];
    return treeSortedBalances;
  }

  static tokenBalanceAcrossAllTrees(treeSortedBalances: TreeBalance[]): bigint {
    const tokenBalance: bigint = treeSortedBalances.reduce(
      (left, right) => left + right.balance,
      BigInt(0),
    );
    return tokenBalance;
  }

  async decryptBalances(
    txidVersion: TXIDVersion,
    chain: Chain,
    progressCallback: Optional<(progress: number) => void>,
    deferCompletionEvent: boolean, // the caller will handle emitting EngineEvent.WalletDecryptBalancesComplete
  ) {
    try {
      if (this.isClearingBalances.get(null, chain) === true) {
        EngineDebug.log('Clearing balances... cannot scan wallet balances.');
        return;
      }

      EngineDebug.log(`scan wallet balances: chain ${chain.type}:${chain.id}`);

      // Set a simple key for this run of decryptBalances, so we can return early if it changes
      // This will change if another decryptBalances is called for this chain, and we don't need multiple running at once
      const decryptingBalancesKey = generateSimpleKey();
      this.decryptBalancesKeyForChain.set(null, chain, decryptingBalancesKey)

      const utxoMerkletree = this.getUTXOMerkletree(txidVersion, chain);

      // Fetch wallet details and latest tree.
      const [walletDetails, latestTree] = await Promise.all([
        this.getWalletDetails(txidVersion, chain),
        utxoMerkletree.latestTree(),
      ]);

      // Fill list of tree heights with 0s up to # of trees
      while (walletDetails.treeScannedHeights.length <= latestTree) {
        walletDetails.treeScannedHeights.push(0);
      }

      if (
        this.creationBlockNumbers &&
        this.creationBlockNumbers[chain.type] != null &&
        this.creationBlockNumbers[chain.type][chain.id] != null &&
        (walletDetails.creationTree == null || walletDetails.creationTreeHeight == null)
      ) {
        const creationBlockNumber = this.creationBlockNumbers[chain.type][chain.id];
        const creationTreeInfo = await AbstractWallet.getCreationTreeAndPosition(
          utxoMerkletree,
          latestTree,
          creationBlockNumber,
        );
        if (creationTreeInfo != null) {
          walletDetails.creationTree = creationTreeInfo.tree;
          walletDetails.creationTreeHeight = creationTreeInfo.position;
        }
      }

      const startScanTree = walletDetails.creationTree ?? 0;

      const treesToScan = latestTree - startScanTree + 1;

      // Loop through each tree and scan
      for (let treeIndex = startScanTree; treeIndex <= latestTree; treeIndex += 1) {
        // Get scanned height
        let startScanHeight = walletDetails.treeScannedHeights[treeIndex];

        // If creationTreeHeight exists, check if it is higher than default startScanHeight and start there if needed
        if (
          treeIndex === walletDetails.creationTree &&
          isDefined(walletDetails.creationTreeHeight)
        ) {
          startScanHeight = Math.max(walletDetails.creationTreeHeight, startScanHeight);
        }

        // Create sparse array of tree
        const treeHeight = await utxoMerkletree.getTreeLength(treeIndex);

        const batchSize = 2000;
        const totalLeavesToScan = treeHeight - startScanHeight;
        const totalBatches = Math.ceil(totalLeavesToScan / batchSize);

        for (let batchIndex = 0; batchIndex < totalBatches; batchIndex += 1) {
          const batchStart = startScanHeight + batchIndex * batchSize;
          const batchEnd = Math.min(batchStart + batchSize, treeHeight);

          const leaves = await utxoMerkletree.getCommitmentRange(
            treeIndex,
            batchStart,
            batchEnd - 1,
          );

          const finishedTreeCount = treeIndex - startScanTree;
          const finishedTreesProgress = finishedTreeCount / treesToScan;
          const afterFetchLeavesProgress = 0.5; // After Promise.all to get leaves, say we are 50% done with this batch.
          let newTreeProgress =
            (batchIndex + afterFetchLeavesProgress) / totalBatches / treesToScan;
          if (progressCallback) {
            progressCallback(finishedTreesProgress + newTreeProgress);
          }

          await this.scanLeaves(
            txidVersion,
            leaves,
            treeIndex,
            chain,
            batchStart,
            undefined, // scanTicker
          );

          const afterScanLeavesProgress = 1.0;
          newTreeProgress = (batchIndex + afterScanLeavesProgress) / totalBatches / treesToScan;
          if (progressCallback) {
            progressCallback(finishedTreesProgress + newTreeProgress);
          }

          if (this.decryptBalancesKeyForChain.get(null, chain) !== decryptingBalancesKey) {
            // Key changed because some other decryptBalances run has started.
            // No need to run multiple decrypt balances at once, return early.
            EngineDebug.log(
              `wallet: decryptBalances key changed, returning early. ${chain.type}:${chain.id}`,
            );
            return;
          }

          // Commit new scanned height
          const walletDetailsMap = await this.getWalletDetailsMap(chain);
          walletDetails.treeScannedHeights[treeIndex] = batchEnd;
          walletDetailsMap[txidVersion] = walletDetails;

          // Write new wallet details to db
          await this.db.put(this.getWalletDetailsPath(chain), msgpack.encode(walletDetailsMap));
        }
      }

      // Reset decryptBalancesKeyForChain
      this.decryptBalancesKeyForChain.del(null, chain);

      await this.refreshPOIsForTXIDVersion(chain, txidVersion);

      // Emit scanned event for this chain
      EngineDebug.log(`wallet: scanned ${chain.type}:${chain.id}`);
      if (!deferCompletionEvent) {
        const walletScannedEventData: WalletScannedEventData = { txidVersion, chain };
        this.emit(EngineEvent.WalletDecryptBalancesComplete, walletScannedEventData);
      }
    } catch (err) {
      // Reset decryptBalancesKeyForChain
      this.decryptBalancesKeyForChain.del(null, chain);

      if (err instanceof Error) {
        EngineDebug.log(`wallet.scan error: ${err.message}`);
        EngineDebug.error(err, true /* ignoreInTests */);
      }
    }
  }

  async refreshPOIsForAllTXIDVersions(chain: Chain, forceRefresh?: boolean) {
    // eslint-disable-next-line no-restricted-syntax
    for (const txidVersion of ACTIVE_TXID_VERSIONS) {
      if (!getChainSupportsV3(chain) && txidVersion === TXIDVersion.V3_PoseidonMerkle) {
        continue;
      }
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      this.refreshPOIsForTXIDVersion(chain, txidVersion, forceRefresh);
    }
  }

  /**
   * Occurs after balances are scanned.
   */
  async refreshPOIsForTXIDVersion(chain: Chain, txidVersion: TXIDVersion, forceRefresh?: boolean) {
    if (!POI.isActiveForChain(chain)) {
      return;
    }
    if (!this.hasUTXOMerkletree(txidVersion, chain)) {
      return;
    }
    if (
      forceRefresh !== true &&
      this.isRefreshingPOIs[txidVersion]?.[chain.type]?.[chain.id] === true
    ) {
      return;
    }
    this.isRefreshingPOIs[txidVersion] ??= [];
    (this.isRefreshingPOIs[txidVersion] as boolean[][])[chain.type] ??= [];
    (this.isRefreshingPOIs[txidVersion] as boolean[][])[chain.type][chain.id] = true;

    try {
      // eslint-disable-next-line no-restricted-syntax
      // Refresh POIs - Receive commitments
      await this.refreshReceivePOIsAllTXOs(txidVersion, chain);

      // Submit POI events - Legacy received transact commitments
      await this.submitLegacyTransactPOIEventsReceiveCommitments(txidVersion, chain);

      // Refresh POIs - Sent commitments / unshields
      await this.refreshSpentPOIsAllSentCommitmentsAndUnshieldEvents(txidVersion, chain);

      // Auto-generate POIs - Sent commitments / unshields
      const numProofs = await this.generatePOIsAllSentCommitmentsAndUnshieldEvents(
        chain,
        txidVersion,
      );

      (this.isRefreshingPOIs[txidVersion] as boolean[][])[chain.type][chain.id] = false;
      if (numProofs > 0) {
        this.emitPOIProofUpdateEvent(
          POIProofEventStatus.LoadingNextBatch,
          txidVersion,
          chain,
          0, // Progress
          'Loading...',
          'N/A',
          'N/A',
          0,
          0,
          undefined, // errorMsg
        );

        // Retrigger
        await this.refreshPOIsForTXIDVersion(chain, txidVersion);
        return;
      }

      this.emitPOIProofUpdateEvent(
        POIProofEventStatus.AllProofsCompleted,
        txidVersion,
        chain,
        0, // Progress
        'N/A',
        'N/A',
        'N/A',
        0,
        0,
        undefined, // errorMsg
      );
    } catch (cause) {
      (this.isRefreshingPOIs[txidVersion] as boolean[][])[chain.type][chain.id] = false;
      const err = new Error('Failed to refresh POIs', { cause });
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
      EngineDebug.error(err, true /* ignoreInTests */);
      throw err;
    }
  }

  async generatePOIsForRailgunTxid(chain: Chain, txidVersion: TXIDVersion, railgunTxid: string) {
    await this.generatePOIsAllSentCommitmentsAndUnshieldEvents(chain, txidVersion, railgunTxid);

    this.emitPOIProofUpdateEvent(
      POIProofEventStatus.AllProofsCompleted,
      txidVersion,
      chain,
      0, // Progress
      'N/A',
      'N/A',
      'N/A',
      0,
      0,
      undefined, // errorMsg
    );
  }

  /**
   * Searches for creation tree height for given merkletree based on creationBlockNumber.
   * Will return the latest position that is <= creationBlockNumber. May return an index that has blockNumber < creationBlockNumber,
   * but that is okay for purposes of creationTreeHeight. We just need to guarantee we don't return a position that misses some commitments in the creation block.
   * @param merkletree - Merkletree
   * @param latestTree - number
   */
  static async getCreationTreeAndPosition(
    utxoMerkletree: UTXOMerkletree,
    latestTree: number,
    creationBlockNumber: number,
  ): Promise<Optional<{ tree: number; position: number }>> {
    if (!isDefined(creationBlockNumber)) {
      return undefined;
    }

    // Loop through each tree, descending, and search commitments for creation tree height <= block number
    for (let tree = latestTree; tree > -1; tree -= 1) {
      const treeHeight = await utxoMerkletree.getTreeLength(tree);

      const batchSize = 2000;
      const totalBatches = Math.ceil(treeHeight / batchSize);
      let earliestCommitmentIndex: Optional<number>; // Store the earliest commitment index found for this tree with <= creationBlockNumber.
      let creationBlockIndexBlockNumber = 0; // Store the blockNumber of the earliest commitment index found for this tree with <= creationBlockNumber.

      for (let batchIndex = 0; batchIndex < totalBatches; batchIndex += 1) {
        // Start batches at the end of the tree and work backwards
        const batchStart = Math.max(0, treeHeight - (batchIndex + 1) * batchSize);
        const batchEnd = treeHeight - batchIndex * batchSize;

        const leaves = await utxoMerkletree.getCommitmentRange(tree, batchStart, batchEnd - 1);

        if (!isDefined(earliestCommitmentIndex)) {
          // Search through leaves (descending) for first blockNumber before creation.
          // Do this linearly, as we don't expect many commitments in a single block.
          for (let index = batchEnd - 1; index >= batchStart; index -= 1) {
            const commitment = leaves[index - batchStart];
            if (isDefined(commitment?.blockNumber)) {
              if (commitment.blockNumber <= creationBlockNumber) {
                earliestCommitmentIndex = index;
                creationBlockIndexBlockNumber = commitment.blockNumber;
                break;
              }
            }
          }
        }

        if (isDefined(earliestCommitmentIndex)) {
          // Check if any commitments earlier in the leaves array are also equal to creationBlockIndex's blockNumber.
          // This can happen if there are multiple commitments in the same block.
          // If so, return the earliest one.
          for (let index: number = earliestCommitmentIndex - 1; index > -1; index -= 1) {
            if (index < batchStart) {
              // We've gone too far, stop.
              break;
            }

            const commitment = leaves[index];
            if (isDefined(commitment?.blockNumber)) {
              if (commitment.blockNumber === creationBlockIndexBlockNumber) {
                earliestCommitmentIndex = index;
              } else if (commitment.blockNumber < creationBlockIndexBlockNumber) {
                // We've gone too far, stop.
                break;
              }
            }
          }

          if (earliestCommitmentIndex > batchStart) {
            return { tree, position: earliestCommitmentIndex };
          }
        }
      }
    }

    return undefined;
  }

  setCreationBlockNumbers(creationBlockNumbers: Optional<number[][]>): void {
    this.creationBlockNumbers = creationBlockNumbers;
  }

  /**
   * Clears balances decrypted from merkletrees and stored to database.
   * @param chain - chain type/id to clear
   */
  async clearDecryptedBalancesAllTXIDVersions(chain: Chain) {
    const walletDetailsMap = await this.getWalletDetailsMap(chain);

    // Clear wallet namespace, including decrypted TXOs and all details
    const namespace = this.getWalletDBPrefix(chain);
    this.isClearingBalances.set(null, chain, true)
    await this.db.clearNamespace(namespace);
    this.isClearingBalances.set(null, chain, false)

    Object.values(TXIDVersion).forEach((txidVersion) => {
      if (walletDetailsMap[txidVersion]) {
        // @ts-expect-error
        walletDetailsMap[txidVersion].treeScannedHeights = [];
      }
    });
    await this.db.put(this.getWalletDetailsPath(chain), msgpack.encode(walletDetailsMap));

    this.invalidateCommitmentsCache(chain);
  }

  /**
   * Clears stored balances and re-decrypts fully.
   * @param chain - chain type/id to rescan
   */
  async fullRedecryptBalancesAllTXIDVersions(
    chain: Chain,
    progressCallback: Optional<(progress: number) => void>,
  ) {
    await this.clearDecryptedBalancesAllTXIDVersions(chain);

    // eslint-disable-next-line no-restricted-syntax
    for (const txidVersion of Object.values(TXIDVersion)) {
      if (!getChainSupportsV3(chain) && txidVersion === TXIDVersion.V3_PoseidonMerkle) {
        continue;
      }

      await this.decryptBalances(
        txidVersion,
        chain,
        progressCallback,
        false, // deferCompletionEvent
      );
    }
  }

  abstract sign(publicInputs: PublicInputsRailgun, encryptionKey: string): Promise<Signature>;

  static dbPath(id: string): BytesData[] {
    return [fromUTF8String('wallet'), id];
  }

  static async read(
    db: Database,
    id: string,
    encryptionKey: string,
  ): Promise<WalletData | ViewOnlyWalletData> {
    return msgpack.decode(
      fastHexToBytes(await db.getEncrypted(AbstractWallet.dbPath(id), encryptionKey)),
    );
  }

  static async write(
    db: Database,
    id: string,
    encryptionKey: string,
    data: WalletData | ViewOnlyWalletData,
  ): Promise<void> {
    await db.putEncrypted(AbstractWallet.dbPath(id), encryptionKey, msgpack.encode(data));
  }

  static async delete(db: Database, id: string): Promise<void> {
    return db.del(AbstractWallet.dbPath(id));
  }

  /**
   * Loads encrypted wallet data from database.
   * @param db - database
   * @param encryptionKey - encryption key to use with database
   * @param id - wallet id
   */
  static async getEncryptedData(
    db: Database,
    encryptionKey: string,
    id: string,
  ): Promise<WalletData | ViewOnlyWalletData> {
    return msgpack.decode(
      fastHexToBytes(await db.getEncrypted([fromUTF8String('wallet'), id], encryptionKey)),
    );
  }

  static getKeysFromShareableViewingKey(shareableViewingKey: string): {
    viewingPrivateKey: string;
    spendingPublicKey: SpendingPublicKey;
  } {
    try {
      const { vpriv: viewingPrivateKey, spub: spendingPublicKeyString }: ShareableViewingKeyData =
        msgpack.decode(Buffer.from(shareableViewingKey, 'hex')) as ShareableViewingKeyData;

      const spendingPublicKey = unpackPoint(Buffer.from(spendingPublicKeyString, 'hex'));
      return { viewingPrivateKey, spendingPublicKey };
    } catch (cause) {
      throw new Error('Invalid shareable private key.', { cause });
    }
  }

  generateShareableViewingKey(): string {
    const spendingPublicKeyString = packPoint(this.spendingPublicKey).toString('hex');
    const data: ShareableViewingKeyData = {
      vpriv: formatToByteLength(this.viewingKeyPair.privateKey, ByteLength.UINT_256),
      spub: spendingPublicKeyString,
    };
    return msgpack.encode(data).toString('hex');
  }
}

export { AbstractWallet };
