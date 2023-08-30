/* eslint-disable no-await-in-loop */
import { Signature, poseidon } from 'circomlibjs';
import type { PutBatch } from 'abstract-leveldown';
import BN from 'bn.js';
import EventEmitter from 'events';
import msgpack from 'msgpack-lite';
import { Database } from '../database/database';
import EngineDebug from '../debugger/debugger';
import { encodeAddress } from '../key-derivation/bech32';
import { SpendingPublicKey, ViewingKeyPair, WalletNode } from '../key-derivation/wallet-node';
import { MerkleTree } from '../merkletree/merkletree';
import { EngineEvent, UnshieldStoredEvent, WalletScannedEventData } from '../models/event-types';
import {
  BytesData,
  Ciphertext,
  Commitment,
  CommitmentType,
  LegacyEncryptedCommitment,
  LegacyGeneratedCommitment,
  LegacyNoteSerialized,
  NoteAnnotationData,
  NoteSerialized,
  OutputType,
  ShieldCommitment,
  StoredReceiveCommitment,
  StoredSendCommitment,
  TransactCommitment,
} from '../models/formatted-types';
import { SentCommitment, TXO } from '../models/txo-types';
import { Memo, LEGACY_MEMO_METADATA_BYTE_CHUNKS } from '../note/memo';
import {
  arrayify,
  ByteLength,
  combine,
  formatToByteLength,
  fromUTF8String,
  hexlify,
  hexStringToBytes,
  hexToBytes,
  nToHex,
  numberify,
  padToLength,
} from '../utils/bytes';
import { getSharedSymmetricKey, signED25519 } from '../utils/keys-utils';
import {
  AddressKeys,
  Balances,
  BalancesByTree,
  ShareableViewingKeyData,
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
} from '../models/wallet-types';
import { packPoint, unpackPoint } from '../key-derivation/babyjubjub';
import { Chain } from '../models/engine-types';
import { getChainFullNetworkID } from '../chain/chain';
import { TransactNote } from '../note/transact-note';
import { binarySearchForUpperBoundIndex } from '../utils/search';
import { getSharedSymmetricKeyLegacy } from '../utils/keys-utils-legacy';
import { ShieldNote } from '../note';
import { getTokenDataHash, serializeTokenData } from '../note/note-util';
import { TokenDataGetter } from '../token/token-data-getter';
import { isDefined } from '../utils/is-defined';
import { PublicInputs } from '../models/prover-types';

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

abstract class AbstractWallet extends EventEmitter {
  protected readonly db: Database;

  readonly id: string;

  readonly viewingKeyPair: ViewingKeyPair;

  readonly masterPublicKey: bigint;

  private readonly spendingPublicKey: SpendingPublicKey;

  readonly nullifyingKey: bigint;

  readonly merkletrees: MerkleTree[][] = [];

  private creationBlockNumbers: Optional<number[][]>;

  // [type: [id: CachedStoredReceiveCommitment[]]]
  private cachedReceiveCommitments: CachedStoredReceiveCommitment[][][] = [];

  // [type: [id: CachedStoredSendCommitment[]]]
  private cachedSendCommitments: CachedStoredSendCommitment[][][] = [];

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
  ) {
    super();

    this.id = hexlify(id);
    this.db = db;
    this.viewingKeyPair = viewingKeyPair;
    this.spendingPublicKey = spendingPublicKey;
    this.nullifyingKey = poseidon([BigInt(hexlify(this.viewingKeyPair.privateKey, true))]);
    this.masterPublicKey = WalletNode.getMasterPublicKey(spendingPublicKey, this.nullifyingKey);
    this.creationBlockNumbers = creationBlockNumbers;
  }

  /**
   * Loads merkle tree into wallet
   * @param merkletree - merkletree to load
   */
  loadMerkletree(merkletree: MerkleTree) {
    this.merkletrees[merkletree.chain.type] ??= [];
    this.merkletrees[merkletree.chain.type][merkletree.chain.id] = merkletree;
  }

  /**
   * Unload merkle tree by chain
   * @param chain - chain type/id of tree to unload
   */
  unloadMerkletree(chain: Chain) {
    delete this.merkletrees[chain.type]?.[chain.id];
  }

  private createTokenDataGetter(chain: Chain): TokenDataGetter {
    return new TokenDataGetter(this.db, chain);
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
    return this.getWalletDBPrefix(chain);
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

  /**
   * Get encrypted wallet details for this wallet
   * @param chain - chain type/id
   * @returns walletDetails - including treeScannedHeight
   */
  async getWalletDetails(chain: Chain): Promise<WalletDetails> {
    let walletDetails: WalletDetails;

    try {
      // Try fetching from database
      const walletDetailsEncoded = (await this.db.get(
        this.getWalletDetailsPath(chain),
      )) as BytesData;
      walletDetails = msgpack.decode(arrayify(walletDetailsEncoded)) as WalletDetails;
      if (walletDetails.creationTreeHeight == null) {
        walletDetails.creationTreeHeight = undefined;
      }
    } catch {
      // If details don't exist yet, return defaults
      walletDetails = {
        treeScannedHeights: [],
        creationTree: undefined,
        creationTreeHeight: undefined,
      };
    }

    return walletDetails;
  }

  private async decryptLeaf(
    ciphertext: Ciphertext,
    memo: string,
    annotationData: string,
    sharedKey: Uint8Array,
    blindedReceiverViewingKey: Optional<Uint8Array>,
    blindedSenderViewingKey: Optional<Uint8Array>,
    senderRandom: Optional<string>,
    isSentNote: boolean,
    isLegacyDecryption: boolean,
    tokenDataGetter: TokenDataGetter,
    blockNumber: number,
  ): Promise<Optional<TransactNote>> {
    try {
      const decrypted = await TransactNote.decrypt(
        this.addressKeys,
        ciphertext,
        sharedKey,
        memo,
        annotationData,
        blindedReceiverViewingKey,
        blindedSenderViewingKey,
        senderRandom,
        isSentNote,
        isLegacyDecryption,
        tokenDataGetter,
        blockNumber,
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

    EngineDebug.log(`Trying to decrypt commitment. Current index ${position}/${totalLeaves - 1}.`);

    const walletAddress = this.getAddress();
    const commitmentType: CommitmentType = AbstractWallet.getCommitmentType(leaf);

    const tokenDataGetter = this.createTokenDataGetter(chain);

    switch (commitmentType) {
      case CommitmentType.TransactCommitment: {
        const commitment = leaf as TransactCommitment;
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
            commitment.ciphertext.ciphertext,
            commitment.ciphertext.memo,
            commitment.ciphertext.annotationData,
            sharedKeyReceiver,
            blindedReceiverViewingKey,
            blindedSenderViewingKey,
            undefined, // senderRandom - not used
            false, // isSentNote
            false, // isLegacyDecryption
            tokenDataGetter,
            leaf.blockNumber,
          );
          serializedNoteReceive = noteReceive ? noteReceive.serialize() : undefined;
        }
        if (sharedKeySender) {
          const senderRandom = Memo.decryptSenderRandom(
            commitment.ciphertext.annotationData,
            viewingPrivateKey,
          );
          noteSend = await this.decryptLeaf(
            commitment.ciphertext.ciphertext,
            commitment.ciphertext.memo,
            commitment.ciphertext.annotationData,
            sharedKeySender,
            blindedReceiverViewingKey,
            blindedSenderViewingKey,
            senderRandom,
            true, // isSentNote
            false, // isLegacyDecryption
            tokenDataGetter,
            leaf.blockNumber,
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
            token: getTokenDataHash(commitment.preImage.token),
            value: commitment.preImage.value,
            annotationData: '', // Empty for non-private txs.
            recipientAddress: walletAddress,
            outputType: OutputType.Transfer,
            senderAddress: undefined,
            memoText: undefined,
            shieldFee: commitment.fee,
            blockNumber: leaf.blockNumber,
          };

          noteReceive = await TransactNote.deserialize(
            serialized,
            viewingPrivateKey,
            tokenDataGetter,
          );
          serializedNoteReceive = serialized;
        } catch (err) {
          // Expect error if leaf not addressed to this wallet.
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
            commitment.ciphertext.ciphertext,
            memo,
            annotationData,
            sharedKeyReceiver,
            blindedReceiverViewingKey,
            blindedSenderViewingKey,
            undefined, // senderRandom - not used
            false, // isSentNote
            true, // isLegacyDecryption
            tokenDataGetter,
            leaf.blockNumber,
          );
          serializedNoteReceive = noteReceive
            ? noteReceive.serializeLegacy(viewingPrivateKey)
            : undefined;
        }
        if (sharedKeySender) {
          const senderRandom = Memo.decryptSenderRandom(annotationData, viewingPrivateKey);
          noteSend = await this.decryptLeaf(
            commitment.ciphertext.ciphertext,
            memo,
            annotationData,
            sharedKeySender,
            blindedReceiverViewingKey,
            blindedSenderViewingKey,
            senderRandom,
            true, // isSentNote
            true, // isLegacyDecryption
            tokenDataGetter,
            leaf.blockNumber,
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
          token: commitment.preImage.token.tokenAddress,
          value: commitment.preImage.value,
          recipientAddress: walletAddress,
          memoField: [],
          memoText: undefined,
          blockNumber: leaf.blockNumber,
        };
        try {
          noteReceive = await TransactNote.deserialize(
            serialized,
            viewingPrivateKey,
            tokenDataGetter,
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
        spendtxid: false,
        txid: leaf.txid,
        timestamp: leaf.timestamp,
        nullifier: nToHex(nullifier, ByteLength.UINT_256),
        decrypted: noteReceive.serialize(),
        senderAddress: noteReceive.senderAddressData
          ? encodeAddress(noteReceive.senderAddressData)
          : undefined,
      };
      EngineDebug.log(`Adding RECEIVE commitment at ${position} (Wallet ${this.id}).`);
      scannedCommitments.push({
        type: 'put',
        key: this.getWalletReceiveCommitmentDBPrefix(chain, tree, position).join(':'),
        value: msgpack.encode(storedReceiveCommitment),
      });
      AbstractWallet.addCachedStoredCommitment(chain, this.cachedReceiveCommitments, {
        storedReceiveCommitment,
        tree,
        position,
      });
    }

    if (noteSend && serializedNoteSend) {
      const storedSendCommitment: StoredSendCommitment = {
        txid: leaf.txid,
        timestamp: leaf.timestamp,
        decrypted: serializedNoteSend,
        noteExtraData: Memo.decryptNoteAnnotationData(noteSend.annotationData, viewingPrivateKey),
        recipientAddress: encodeAddress(noteSend.receiverAddressData),
      };
      EngineDebug.log(`Adding SPEND commitment at ${position} (Wallet ${this.id}).`);
      scannedCommitments.push({
        type: 'put',
        key: this.getWalletSentCommitmentDBPrefix(chain, tree, position).join(':'),
        value: msgpack.encode(storedSendCommitment),
      });
      AbstractWallet.addCachedStoredCommitment(chain, this.cachedSendCommitments, {
        storedSendCommitment,
        tree,
        position,
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
    leaves: Optional<Commitment>[],
    tree: number,
    chain: Chain,
    startScanHeight: number,
    treeHeight: number,
    scanTicker: () => void,
  ): Promise<void> {
    EngineDebug.log(
      `wallet:scanLeaves tree:${tree} chain:${chain.type}:${chain.id} leaves:${leaves.length}, startScanHeight:${startScanHeight}`,
    );
    const vpk = this.getViewingKeyPair().privateKey;

    const leafSyncPromises: Promise<ScannedDBCommitment[]>[] = [];

    for (let position = startScanHeight; position < treeHeight; position += 1) {
      const leaf = leaves[position];
      if (leaf == null) {
        scanTicker();
        continue;
      }
      const scanPromiseWithTicker = async () => {
        const scanned = await this.createScannedDBCommitments(
          leaf,
          vpk,
          tree,
          chain,
          position,
          leaves.length,
        );
        scanTicker();
        return scanned;
      };
      leafSyncPromises.push(scanPromiseWithTicker());
    }

    const writeBatch: ScannedDBCommitment[] = (await Promise.all(leafSyncPromises)).flat();

    // Write to DB
    await this.db.batch(writeBatch);
  }

  private async keySplits(namespace: string[], fieldCount: number): Promise<string[][]> {
    const keys: string[] = await this.db.getNamespaceKeys(namespace);
    const keySplits = keys
      .map((key) => key.split(':'))
      .filter((keySplit) => keySplit.length === fieldCount);
    return keySplits;
  }

  private async queryAllStoredReceiveCommitments(
    chain: Chain,
  ): Promise<CachedStoredReceiveCommitment[]> {
    if (
      isDefined(this.cachedReceiveCommitments[chain.type]) &&
      isDefined(this.cachedReceiveCommitments[chain.type][chain.id])
    ) {
      return this.cachedReceiveCommitments[chain.type][chain.id];
    }

    const namespace = this.getWalletDBPrefix(chain);
    const keySplits = await this.keySplits(namespace, 5);

    const dbStoredReceiveCommitments: CachedStoredReceiveCommitment[] = await Promise.all(
      keySplits.map(async (keySplit) => {
        const data = (await this.db.get(keySplit)) as BytesData;
        const storedReceiveCommitment = msgpack.decode(arrayify(data)) as StoredReceiveCommitment;

        const tree = numberify(keySplit[3]).toNumber();
        const position = numberify(keySplit[4]).toNumber();

        return { storedReceiveCommitment, tree, position };
      }),
    );

    if (!isDefined(this.cachedReceiveCommitments[chain.type])) {
      this.cachedReceiveCommitments[chain.type] = [];
    }
    this.cachedReceiveCommitments[chain.type][chain.id] = dbStoredReceiveCommitments;
    return dbStoredReceiveCommitments;
  }

  private async queryAllStoredSendCommitments(chain: Chain): Promise<CachedStoredSendCommitment[]> {
    if (
      isDefined(this.cachedSendCommitments[chain.type]) &&
      isDefined(this.cachedSendCommitments[chain.type][chain.id])
    ) {
      return this.cachedSendCommitments[chain.type][chain.id];
    }

    const namespace = this.getWalletSentCommitmentDBPrefix(chain);
    const keySplits = await this.keySplits(namespace, 5);

    const dbStoredSendCommitments: CachedStoredSendCommitment[] = await Promise.all(
      keySplits.map(async (keySplit) => {
        const data = (await this.db.get(keySplit)) as BytesData;
        const storedSendCommitment = msgpack.decode(arrayify(data)) as StoredSendCommitment;

        const tree = numberify(keySplit[3]).toNumber();
        const position = numberify(keySplit[4]).toNumber();

        return { storedSendCommitment, tree, position };
      }),
    );

    if (!isDefined(this.cachedSendCommitments[chain.type])) {
      this.cachedSendCommitments[chain.type] = [];
    }
    this.cachedSendCommitments[chain.type][chain.id] = dbStoredSendCommitments;
    return dbStoredSendCommitments;
  }

  private static addCachedStoredCommitment<Cache extends { tree: number; position: number }[][][]>(
    chain: Chain,
    commitmentCache: Cache,
    cachedCommitment: CachedStoredReceiveCommitment | CachedStoredSendCommitment,
  ) {
    if (
      !isDefined(commitmentCache[chain.type]) ||
      !isDefined(commitmentCache[chain.type][chain.id])
    ) {
      return;
    }
    const cacheForChain = commitmentCache[chain.type][chain.id];
    const found = cacheForChain.find((stored) => {
      return stored.tree === cachedCommitment.tree && stored.position === cachedCommitment.position;
    });
    if (found) {
      return;
    }
    cacheForChain.push(cachedCommitment);
  }

  /**
   * Get TXOs list of a chain
   * @param chain - chain type/id to get UTXOs for
   * @returns UTXOs list
   */
  async TXOs(chain: Chain): Promise<TXO[]> {
    const recipientAddress = encodeAddress(this.addressKeys);
    const vpk = this.getViewingKeyPair().privateKey;
    const merkletree = this.getMerkletreeForChain(chain);
    const tokenDataGetter = this.createTokenDataGetter(chain);

    const storedReceiveCommitments = await this.queryAllStoredReceiveCommitments(chain);

    return Promise.all(
      storedReceiveCommitments.map(async ({ storedReceiveCommitment, tree, position }) => {
        const txo = storedReceiveCommitment;

        // Check if TXO has been spent.
        if (txo.spendtxid === false) {
          const storedNullifier = await merkletree.getStoredNullifierTxid(txo.nullifier);
          if (isDefined(storedNullifier)) {
            txo.spendtxid = storedNullifier;
            // Write nullifier spend txid to db.
            await this.db.put(
              this.getWalletReceiveCommitmentDBPrefix(chain, tree, position),
              msgpack.encode(txo),
            );
          }
        }

        const note = await TransactNote.deserialize(
          {
            ...txo.decrypted,
            recipientAddress,
          },
          vpk,
          tokenDataGetter,
        );

        return {
          tree,
          position,
          txid: txo.txid,
          timestamp: txo.timestamp,
          spendtxid: txo.spendtxid,
          note,
        };
      }),
    );
  }

  /**
   * Get spent commitments of a chain
   * @param chain - chain type/id to get spent commitments for
   * @returns SentCommitment list
   */
  async getSentCommitments(
    chain: Chain,
    startingBlock: Optional<number>,
  ): Promise<SentCommitment[]> {
    const vpk = this.getViewingKeyPair().privateKey;

    const tokenDataGetter = this.createTokenDataGetter(chain);

    const sentCommitments: SentCommitment[] = [];

    const storedSendCommitments = await this.queryAllStoredSendCommitments(chain);

    await Promise.all(
      storedSendCommitments.map(async ({ storedSendCommitment, tree, position }) => {
        const sentCommitment = storedSendCommitment;

        const note = await TransactNote.deserialize(sentCommitment.decrypted, vpk, tokenDataGetter);

        if (!isDefined(note.blockNumber)) {
          return;
        }
        if (startingBlock != null && note.blockNumber < startingBlock) {
          return;
        }

        sentCommitments.push({
          tree,
          position,
          txid: sentCommitment.txid,
          timestamp: sentCommitment.timestamp,
          note,
          noteAnnotationData: sentCommitment.noteExtraData,
          isLegacyTransactNote: TransactNote.isLegacyTransactNote(sentCommitment.decrypted),
        });
      }),
    );

    return sentCommitments;
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
    const TXOs = await this.TXOs(chain);
    const filteredTXOs = AbstractWallet.filterTXOsByBlockNumber(TXOs, startingBlock);

    const [receiveHistory, spendHistory] = await Promise.all([
      AbstractWallet.getTransactionReceiveHistory(filteredTXOs),
      this.getTransactionSpendHistory(chain, filteredTXOs, startingBlock),
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

  /**
   * Gets transactions history for "received" transactions
   * @param chain - chain type/id to get balances for
   * @returns history
   */
  static getTransactionReceiveHistory(filteredTXOs: TXO[]): TransactionHistoryEntryReceived[] {
    const txidTransactionMap: { [txid: string]: TransactionHistoryEntryReceived } = {};

    filteredTXOs.forEach(({ txid, timestamp, note }) => {
      if (note.value === 0n) {
        return;
      }
      if (!isDefined(txidTransactionMap[txid])) {
        txidTransactionMap[txid] = {
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
      });
    });

    const history: TransactionHistoryEntryReceived[] = Object.values(txidTransactionMap);
    return history;
  }

  private static getTransactionHistoryItemVersion(
    noteAnnotationData: Optional<NoteAnnotationData>,
    isLegacyTransactNote: boolean,
  ) {
    if (!noteAnnotationData) {
      return TransactionHistoryItemVersion.Legacy;
    }
    if (isLegacyTransactNote) {
      return TransactionHistoryItemVersion.UpdatedAug2022;
    }
    return TransactionHistoryItemVersion.UpdatedNov2022;
  }

  async getAllUnshieldEventsFromSpentNullifiers(
    chain: Chain,
    filteredTXOs: TXO[],
  ): Promise<UnshieldStoredEvent[]> {
    const merkletree = this.getMerkletreeForChain(chain);
    const unshieldEvents: UnshieldStoredEvent[] = [];

    const seenSpentTxids: string[] = [];

    await Promise.all(
      filteredTXOs.map(async ({ spendtxid, note }) => {
        if (note.value === 0n) {
          return;
        }
        if (spendtxid === false) {
          return;
        }
        if (seenSpentTxids.includes(spendtxid)) {
          return;
        }
        seenSpentTxids.push(spendtxid);

        // Nullifier exists. Find unshield events from txid.
        const unshieldEventsForNullifier = await merkletree.getUnshieldEvents(spendtxid);
        const filteredEventsForNullifier = unshieldEventsForNullifier.filter(
          (event) =>
            unshieldEvents.find((existingUnshieldEvent) =>
              AbstractWallet.compareUnshieldEvents(existingUnshieldEvent, event),
            ) == null,
        );
        unshieldEvents.push(...filteredEventsForNullifier);
      }),
    );

    return unshieldEvents;
  }

  private static compareUnshieldEvents(a: UnshieldStoredEvent, b: UnshieldStoredEvent): boolean {
    return a.txid === b.txid && a.eventLogIndex === b.eventLogIndex;
  }

  async getTransactionSpendHistory(
    chain: Chain,
    filteredTXOs: TXO[],
    startingBlock: Optional<number>,
  ): Promise<TransactionHistoryEntrySpent[]> {
    const [allUnshieldEvents, sentCommitments] = await Promise.all([
      this.getAllUnshieldEventsFromSpentNullifiers(chain, filteredTXOs),
      this.getSentCommitments(chain, startingBlock),
    ]);

    const txidTransactionMap: { [txid: string]: TransactionHistoryEntryPreprocessSpent } = {};

    sentCommitments.forEach(
      ({ txid, timestamp, note, isLegacyTransactNote, noteAnnotationData }) => {
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
              noteAnnotationData,
              isLegacyTransactNote,
            ),
          };
        }

        const tokenHash = formatToByteLength(note.tokenHash, ByteLength.UINT_256, false);
        const tokenAmount: TransactionHistoryTokenAmount | TransactionHistoryTransferTokenAmount = {
          tokenHash,
          tokenData: note.tokenData,
          amount: note.value,
          noteAnnotationData,
          memoText: note.memoText,
        };
        const isNonLegacyTransfer =
          !isLegacyTransactNote &&
          isDefined(noteAnnotationData) &&
          noteAnnotationData.outputType === OutputType.Transfer;
        if (isNonLegacyTransfer) {
          (tokenAmount as TransactionHistoryTransferTokenAmount).recipientAddress = encodeAddress(
            note.receiverAddressData,
          );
        }
        txidTransactionMap[txid].tokenAmounts.push(tokenAmount);
      },
    );

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
          if (!tokenAmount.noteAnnotationData) {
            // Legacy notes without extra data, consider as a simple "transfer".
            transferTokenAmounts.push(tokenAmount as TransactionHistoryTransferTokenAmount);
            return;
          }
          switch (tokenAmount.noteAnnotationData.outputType) {
            case OutputType.Transfer:
              transferTokenAmounts.push(tokenAmount as TransactionHistoryTransferTokenAmount);
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
            };
          },
        );

        const historyEntry: TransactionHistoryEntrySpent = {
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

  private getMerkletreeForChain(chain: Chain): MerkleTree {
    const merkletree = this.merkletrees[chain.type][chain.id];
    if (!isDefined(merkletree)) {
      throw new Error(`No merkletree for chain ${chain.type}:${chain.id}`);
    }
    return merkletree;
  }

  /**
   * Gets wallet balances
   * @param chain - chain type/id to get balances for
   * @returns balances
   */
  async balances(chain: Chain): Promise<Balances> {
    const TXOs = await this.TXOs(chain);
    const balances: Balances = {};

    // Loop through each TXO and add to balances if unspent
    TXOs.forEach((txo) => {
      const tokenHash = formatToByteLength(txo.note.tokenHash, ByteLength.UINT_256, false);
      // If we don't have an entry for this token yet, create one
      if (!isDefined(balances[tokenHash])) {
        balances[tokenHash] = {
          balance: BigInt(0),
          utxos: [],
          tokenData: txo.note.tokenData,
        };
      }

      // If utxo is unspent process it
      if (txo.spendtxid === false) {
        // Store utxo
        balances[tokenHash].utxos.push(txo);
        // Increment balance
        balances[tokenHash].balance += txo.note.value;
      }
    });

    return balances;
  }

  async getBalance(chain: Chain, tokenAddress: string): Promise<Optional<bigint>> {
    const balances = await this.balances(chain);
    const balanceForToken = balances[formatToByteLength(tokenAddress, 32, false)];
    return isDefined(balanceForToken) ? balanceForToken.balance : undefined;
  }

  /**
   * Sort token balances by tree
   * @param chain - chain type/id of token
   * @returns balances by tree
   */
  async balancesByTree(chain: Chain): Promise<BalancesByTree> {
    // Fetch balances
    const balances = await this.balances(chain);

    // Sort token balances by tree
    const balancesByTree: BalancesByTree = {};

    // Loop through each token
    Object.keys(balances).forEach((token) => {
      // Create balances tree array
      balancesByTree[token] = [];

      // Loop through each TXO and sort by tree
      balances[token].utxos.forEach((utxo) => {
        if (!isDefined(balancesByTree[token][utxo.tree])) {
          balancesByTree[token][utxo.tree] = {
            balance: utxo.note.value,
            utxos: [utxo],
            tokenData: utxo.note.tokenData,
          };
        } else {
          balancesByTree[token][utxo.tree].balance += utxo.note.value;
          balancesByTree[token][utxo.tree].utxos.push(utxo);
        }
      });
    });

    return balancesByTree;
  }

  async balancesByTreeForToken(chain: Chain, tokenHash: string): Promise<TreeBalance[]> {
    const balances = await this.balancesByTree(chain);
    const treeSortedBalances = balances[tokenHash] ?? [];
    return treeSortedBalances;
  }

  static tokenBalanceAcrossAllTrees(treeSortedBalances: TreeBalance[]): bigint {
    const tokenBalance: bigint = treeSortedBalances.reduce(
      (left, right) => left + right.balance,
      BigInt(0),
    );
    return tokenBalance;
  }

  /**
   * Scans for new balances
   * @param chain - chain data to scan
   */
  async scanBalances(chain: Chain, progressCallback: Optional<(progress: number) => void>) {
    EngineDebug.log(`scan wallet balances: chain ${chain.type}:${chain.id}`);

    const merkletree = this.getMerkletreeForChain(chain);

    try {
      // Fetch wallet details and latest tree.
      const [walletDetails, latestTree] = await Promise.all([
        this.getWalletDetails(chain),
        merkletree.latestTree(),
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
        const creationTreeInfo = await AbstractWallet.getTreeAndPositionBeforeBlock(
          merkletree,
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
        const treeHeight = await merkletree.getTreeLength(treeIndex);
        const fetcher = new Array<Promise<Optional<Commitment>>>(treeHeight);

        // Fetch each leaf we need to scan
        for (let index = startScanHeight; index < treeHeight; index += 1) {
          fetcher[index] = merkletree.getCommitment(treeIndex, index);
        }

        // Wait until all leaves are fetched
        const leaves = await Promise.all(fetcher);

        const leavesToScan = treeHeight - startScanHeight;
        let finishedLeafCount = 0;
        let timeSinceLastProgressCallback = Date.now() - 500;

        // Start scanning primary and change
        await this.scanLeaves(leaves, treeIndex, chain, startScanHeight, treeHeight, () => {
          // Scan ticker. Triggers every time leaf is scanned successfully or skipped.
          if (progressCallback) {
            // Throttle progressCallback, at most every 500ms.
            if (Date.now() - timeSinceLastProgressCallback >= 500) {
              // 100ms since last progressCallback call.
              timeSinceLastProgressCallback = Date.now();
              const finishedTreeCount = treeIndex - startScanTree;
              const finishedTreesProgress = finishedTreeCount / treesToScan;
              finishedLeafCount += 1;
              const newTreeProgress = finishedLeafCount / leavesToScan / treesToScan;
              progressCallback(finishedTreesProgress + newTreeProgress);
            }
          }
        });

        // Commit new scanned height
        walletDetails.treeScannedHeights[treeIndex] = leaves.length;

        // Write new wallet details to db
        await this.db.put(this.getWalletDetailsPath(chain), msgpack.encode(walletDetails));
      }

      // Emit scanned event for this chain
      EngineDebug.log(`wallet: scanned ${chain.type}:${chain.id}`);
      this.emit(EngineEvent.WalletScanComplete, { chain } as WalletScannedEventData);
    } catch (err) {
      if (err instanceof Error) {
        EngineDebug.log(`wallet.scan error: ${err.message}`);
        EngineDebug.error(err);
      }
    }
  }

  /**
   * Searches for creation tree height for given merkletree.
   * @param merkletree - MerkleTree
   * @param latestTree - number
   */
  static async getTreeAndPositionBeforeBlock(
    merkletree: MerkleTree,
    latestTree: number,
    creationBlockNumber: number,
  ): Promise<Optional<{ tree: number; position: number }>> {
    if (creationBlockNumber == null) {
      return undefined;
    }

    // Loop through each tree, descending, and search commitments for creation tree height <= block number
    for (let tree = latestTree; tree > -1; tree -= 1) {
      const treeHeight = await merkletree.getTreeLength(tree);
      const fetcher = new Array<Promise<Optional<Commitment>>>(treeHeight);

      // Build reverse list.
      for (let index = 0; index < treeHeight; index += 1) {
        fetcher[index] = merkletree.getCommitment(tree, index);
      }

      const leaves = await Promise.all(fetcher);
      if (!leaves.length) {
        return undefined;
      }

      // Search through leaves (descending) for first blockNumber before creation.
      const creationBlockIndex = binarySearchForUpperBoundIndex(
        leaves,
        (commitment) =>
          commitment != null &&
          commitment.blockNumber != null &&
          commitment.blockNumber <= creationBlockNumber,
      );

      if (creationBlockIndex > -1) {
        return { tree, position: creationBlockIndex };
      }
    }

    return undefined;
  }

  setCreationBlockNumbers(creationBlockNumbers: Optional<number[][]>): void {
    this.creationBlockNumbers = creationBlockNumbers;
  }

  /**
   * Clears balances scanned from merkletrees and stored to database.
   * @param chain - chain type/id to clear
   */
  async clearScannedBalances(chain: Chain) {
    const walletDetails = await this.getWalletDetails(chain);
    walletDetails.treeScannedHeights = [];
    this.cachedReceiveCommitments = [];
    // Clear namespace and then resave the walletDetails
    const namespace = this.getWalletDetailsPath(chain);
    await this.db.clearNamespace(namespace);
    await this.db.put(this.getWalletDetailsPath(chain), msgpack.encode(walletDetails));
  }

  /**
   * Clears stored balances and re-scans fully.
   * @param chain - chain type/id to rescan
   */
  async fullRescanBalances(chain: Chain, progressCallback: Optional<(progress: number) => void>) {
    await this.clearScannedBalances(chain);
    return this.scanBalances(chain, progressCallback);
  }

  abstract sign(publicInputs: PublicInputs, encryptionKey: string): Promise<Signature>;

  static dbPath(id: string): BytesData[] {
    return [fromUTF8String('wallet'), id];
  }

  static async read(
    db: Database,
    id: string,
    encryptionKey: string,
  ): Promise<WalletData | ViewOnlyWalletData> {
    return msgpack.decode(
      arrayify(await db.getEncrypted(AbstractWallet.dbPath(id), encryptionKey)),
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
      arrayify(await db.getEncrypted([fromUTF8String('wallet'), id], encryptionKey)),
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
    } catch (err) {
      throw new Error('Invalid shareable private key.');
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
