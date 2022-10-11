import { poseidon } from 'circomlibjs';
import type { PutBatch } from 'abstract-leveldown';
import BN from 'bn.js';
import EventEmitter from 'events';
import msgpack from 'msgpack-lite';
import { Database } from '../database/database';
import EngineDebug from '../debugger/debugger';
import { encodeAddress } from '../key-derivation/bech32';
import { SpendingPublicKey, ViewingKeyPair, WalletNode } from '../key-derivation/wallet-node';
import { MerkleTree } from '../merkletree/merkletree';
import { EngineEvent, ScannedEventData } from '../models/event-types';
import {
  BytesData,
  Commitment,
  EncryptedCommitment,
  NoteSerialized,
  OutputType,
  StoredReceiveCommitment,
  StoredSendCommitment,
} from '../models/formatted-types';
import { SentCommitment, TXO } from '../models/txo-types';
import { Memo } from '../note/memo';
import {
  arrayify,
  ByteLength,
  formatToByteLength,
  fromUTF8String,
  hexlify,
  hexStringToBytes,
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
  ViewOnlyWalletData,
  WalletData,
  WalletDetails,
} from '../models/wallet-types';
import { packPoint, unpackPoint } from '../key-derivation/babyjubjub';
import { Chain } from '../models/engine-types';
import { getChainFullNetworkID } from '../chain/chain';
import { Note } from '../note/note';

type ScannedDBCommitment = PutBatch<string, Buffer>;

abstract class AbstractWallet extends EventEmitter {
  protected readonly db: Database;

  readonly id: string;

  readonly viewingKeyPair: ViewingKeyPair;

  readonly masterPublicKey: bigint;

  private readonly spendingPublicKey: SpendingPublicKey;

  readonly nullifyingKey: bigint;

  readonly merkletrees: MerkleTree[][] = [];

  private creationBlockNumbers: Optional<number[][]>;

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
    this.masterPublicKey = WalletNode.getMasterPublicKey(
      spendingPublicKey,
      this.getNullifyingKey(),
    );
    this.creationBlockNumbers = creationBlockNumbers;
  }

  /**
   * Loads merkle tree into wallet
   * @param merkletree - merkletree to load
   */
  loadTree(merkletree: MerkleTree) {
    if (!this.merkletrees[merkletree.chain.type]) {
      this.merkletrees[merkletree.chain.type] = [];
    }
    this.merkletrees[merkletree.chain.type][merkletree.chain.id] = merkletree;
  }

  /**
   * Unload merkle tree by chain
   * @param chain - chain type/id of tree to unload
   */
  unloadTree(chain: Chain) {
    delete this.merkletrees[chain.type][chain.id];
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
    if (tree != null) path.push(hexlify(padToLength(new BN(tree), 32)));
    if (position != null) path.push(hexlify(padToLength(new BN(position), 32)));
    return path;
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
    ].map((element) => element.padStart(64, '0'));
    if (tree != null) path.push(hexlify(padToLength(new BN(tree), 32)));
    if (position != null) path.push(hexlify(padToLength(new BN(position), 32)));
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
        creationTreeHeight: undefined,
      };
    }

    return walletDetails;
  }

  private static decryptLeaf(
    leaf: EncryptedCommitment,
    sharedKey: Uint8Array,
    ephemeralKeySender: Optional<Uint8Array>,
    senderBlindingKey: Optional<string>,
  ) {
    try {
      return Note.decrypt(
        leaf.ciphertext.ciphertext,
        sharedKey,
        leaf.ciphertext.memo || [],
        ephemeralKeySender,
        senderBlindingKey,
      );
    } catch (err) {
      // Expect error if leaf not addressed to us.
      return undefined;
    }
  }

  private async createScannedDBCommitments(
    leaf: Commitment,
    viewingPrivateKey: Uint8Array,
    tree: number,
    chain: Chain,
    position: number,
    totalLeaves: number,
  ): Promise<ScannedDBCommitment[]> {
    let noteReceive: Optional<Note>;
    let noteSend: Optional<Note>;

    EngineDebug.log(`Trying to decrypt commitment. Current index ${position}/${totalLeaves - 1}.`);

    const walletAddress = this.getAddress();

    if ('ciphertext' in leaf) {
      const ephemeralKeyReceiver = hexStringToBytes(leaf.ciphertext.ephemeralKeys[0]);
      const ephemeralKeySender = hexStringToBytes(leaf.ciphertext.ephemeralKeys[1]);
      const [sharedKeyReceiver, sharedKeySender] = await Promise.all([
        getSharedSymmetricKey(viewingPrivateKey, ephemeralKeyReceiver),
        getSharedSymmetricKey(viewingPrivateKey, ephemeralKeySender),
      ]);
      if (sharedKeyReceiver) {
        noteReceive = AbstractWallet.decryptLeaf(
          leaf,
          sharedKeyReceiver,
          undefined, // ephemeralKeySender - not used
          undefined, // senderBlindingKey - not used
        );
      }
      if (sharedKeySender) {
        const senderBlindingKey = Memo.decryptSenderBlindingKey(
          leaf.ciphertext.memo,
          viewingPrivateKey,
        );
        noteSend = AbstractWallet.decryptLeaf(
          leaf,
          sharedKeySender,
          ephemeralKeySender,
          senderBlindingKey,
        );
      }
    } else {
      // preImage
      // Deserialize
      const serialized: NoteSerialized = {
        npk: leaf.preImage.npk,
        encryptedRandom: leaf.encryptedRandom,
        token: leaf.preImage.token.tokenAddress,
        value: leaf.preImage.value,
        memoField: [], // Empty for non-private txs.
        recipientAddress: walletAddress,
        memoText: undefined,
      };
      try {
        noteReceive = Note.deserialize(serialized, viewingPrivateKey);
      } catch (err) {
        // Expect error if leaf not addressed to us.
      }
    }

    const scannedCommitments: ScannedDBCommitment[] = [];

    if (noteReceive) {
      const nullifier = Note.getNullifier(this.nullifyingKey, position);
      const storedCommitment: StoredReceiveCommitment = {
        spendtxid: false,
        txid: hexlify(leaf.txid),
        nullifier: nToHex(nullifier, ByteLength.UINT_256),
        decrypted: noteReceive.serialize(viewingPrivateKey),
      };
      EngineDebug.log(`Adding RECEIVE commitment at ${position}.`);
      scannedCommitments.push({
        type: 'put',
        key: this.getWalletDBPrefix(chain, tree, position).join(':'),
        value: msgpack.encode(storedCommitment),
      });
    }

    if (noteSend) {
      const storedCommitment: StoredSendCommitment = {
        txid: hexlify(leaf.txid),
        decrypted: noteSend.serialize(viewingPrivateKey),
        noteExtraData: Memo.decryptNoteExtraData(noteSend.memoField, viewingPrivateKey),
        recipientAddress: encodeAddress(noteSend.addressData),
      };
      EngineDebug.log(`Adding SPEND commitment at ${position}.`);
      scannedCommitments.push({
        type: 'put',
        key: this.getWalletSentCommitmentDBPrefix(chain, tree, position).join(':'),
        value: msgpack.encode(storedCommitment),
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
   * @param {number} scannedHeight - starting position
   */
  async scanLeaves(
    leaves: Optional<Commitment>[],
    tree: number,
    chain: Chain,
    scannedHeight: number,
    treeHeight: number,
  ): Promise<void> {
    EngineDebug.log(
      `wallet:scanLeaves tree:${tree} chain:${chain} leaves:${leaves.length}, scannedHeight:${scannedHeight}`,
    );
    const vpk = this.getViewingKeyPair().privateKey;

    const leafSyncPromises: Promise<ScannedDBCommitment[]>[] = [];

    for (let position = scannedHeight; position < treeHeight; position += 1) {
      const leaf = leaves[position];
      if (leaf == null) {
        continue;
      }
      leafSyncPromises.push(
        this.createScannedDBCommitments(leaf, vpk, tree, chain, position, leaves.length),
      );
    }

    const writeBatch: ScannedDBCommitment[] = (await Promise.all(leafSyncPromises)).flat();

    // Write to DB
    await this.db.batch(writeBatch);
  }

  private async streamKeys(namespace: string[]): Promise<string[]> {
    return new Promise((resolve) => {
      const keyList: string[] = [];

      // Stream list of keys and resolve on end
      this.db
        .streamNamespace(namespace)
        .on('data', (key: string) => {
          keyList.push(key);
        })
        .on('end', () => {
          resolve(keyList);
        });
    });
  }

  /**
   * Get TXOs list of a chain
   * @param chain - chain type/id to get UTXOs for
   * @returns UTXOs list
   */
  async TXOs(chain: Chain): Promise<TXO[]> {
    const recipientAddress = encodeAddress(this.addressKeys);
    const vpk = this.getViewingKeyPair().privateKey;

    const namespace = this.getWalletDBPrefix(chain);
    const keys: string[] = await this.streamKeys(namespace);
    const keySplits = keys.map((key) => key.split(':')).filter((keySplit) => keySplit.length === 5);

    const merkletree = this.merkletrees[chain.type][chain.id];

    // Calculate UTXOs
    return Promise.all(
      keySplits.map(async (keySplit) => {
        // Decode UTXO
        const data = (await this.db.get(keySplit)) as BytesData;
        const txo: StoredReceiveCommitment = msgpack.decode(
          arrayify(data),
        ) as StoredReceiveCommitment;

        // If this UTXO hasn't already been marked as spent, check if it has
        if (!txo.spendtxid) {
          // Get nullifier
          const storedNullifier = await merkletree.getStoredNullifier(txo.nullifier);

          // If it's nullified write spend txid to wallet storage
          if (storedNullifier) {
            txo.spendtxid = storedNullifier;

            // Write nullifier spend txid to db
            await this.db.put(keySplit, msgpack.encode(txo));
          }
        }

        const tree = numberify(keySplit[3]).toNumber();
        const position = numberify(keySplit[4]).toNumber();

        const note = Note.deserialize(
          {
            ...txo.decrypted,
            recipientAddress,
          },
          vpk,
        );

        return {
          tree,
          position,
          txid: txo.txid,
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
  async getSentCommitments(chain: Chain): Promise<SentCommitment[]> {
    const vpk = this.getViewingKeyPair().privateKey;

    const namespace = this.getWalletSentCommitmentDBPrefix(chain);
    const keys: string[] = await this.streamKeys(namespace);
    const keySplits = keys.map((key) => key.split(':')).filter((keySplit) => keySplit.length === 5);

    // Calculate spent commitments
    return Promise.all(
      keySplits.map(async (keySplit) => {
        const data = (await this.db.get(keySplit)) as BytesData;
        const sentCommitment = msgpack.decode(arrayify(data)) as StoredSendCommitment;

        const tree = numberify(keySplit[3]).toNumber();
        const position = numberify(keySplit[4]).toNumber();

        const note = Note.deserialize(sentCommitment.decrypted, vpk);

        return {
          tree,
          position,
          txid: sentCommitment.txid,
          note,
          noteExtraData: sentCommitment.noteExtraData,
        };
      }),
    );
  }

  /**
   * Gets transactions history
   * @param chain - chain type/id to get transaction history for
   * @returns history
   */
  async getTransactionHistory(chain: Chain): Promise<TransactionHistoryEntry[]> {
    const receiveHistory = await this.getTransactionReceiveHistory(chain);
    const sendHistory = await this.getTransactionSpendHistory(chain);

    const history: TransactionHistoryEntry[] = sendHistory.map((sendItem) => ({
      ...sendItem,
      receiveTokenAmounts: [],
    }));

    // Merge "sent" history with "receive" history items.
    // We have to remove all "receive" items that are change outputs.
    receiveHistory.forEach((receiveItem) => {
      let alreadyExistsInHistory = false;

      history.forEach((existingHistoryItem) => {
        if (receiveItem.txid === existingHistoryItem.txid) {
          alreadyExistsInHistory = true;
          const { changeTokenAmounts } = existingHistoryItem;
          receiveItem.receiveTokenAmounts.forEach((receiveTokenAmount) => {
            const matchingChangeOutput = changeTokenAmounts.find(
              (ta) =>
                ta.token === receiveTokenAmount.token && ta.amount === receiveTokenAmount.amount,
            );
            if (!matchingChangeOutput) {
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
          version: TransactionHistoryItemVersion.Unknown,
        });
      }
    });

    return history;
  }

  /**
   * Gets transactions history for "received" transactions
   * @param chain - chain type/id to get balances for
   * @returns history
   */
  async getTransactionReceiveHistory(chain: Chain): Promise<TransactionHistoryEntryReceived[]> {
    const TXOs = await this.TXOs(chain);
    const txidTransactionMap: { [txid: string]: TransactionHistoryEntryReceived } = {};

    TXOs.forEach(({ txid, note }) => {
      if (note.value === 0n) {
        return;
      }
      if (!txidTransactionMap[txid]) {
        txidTransactionMap[txid] = {
          txid,
          receiveTokenAmounts: [],
        };
      }
      const token = formatToByteLength(note.token, 32, false);
      txidTransactionMap[txid].receiveTokenAmounts.push({
        token,
        amount: note.value,
        memoText: note.memoText,
      });
    });

    const history: TransactionHistoryEntryReceived[] = Object.values(txidTransactionMap);
    return history;
  }

  async getTransactionSpendHistory(chain: Chain): Promise<TransactionHistoryEntrySpent[]> {
    const sentCommitments = await this.getSentCommitments(chain);
    const txidTransactionMap: { [txid: string]: TransactionHistoryEntryPreprocessSpent } = {};

    sentCommitments.forEach(({ txid, note, noteExtraData }) => {
      if (note.value === 0n) {
        return;
      }
      if (!txidTransactionMap[txid]) {
        txidTransactionMap[txid] = {
          txid,
          tokenAmounts: [],
          version:
            noteExtraData == null
              ? TransactionHistoryItemVersion.Legacy
              : TransactionHistoryItemVersion.UpdatedAug2022,
        };
      }
      const token = formatToByteLength(note.token, 32, false);
      const tokenAmount: TransactionHistoryTokenAmount | TransactionHistoryTransferTokenAmount = {
        token,
        amount: note.value,
        noteExtraData,
        memoText: note.memoText,
      };
      const isTransfer = !noteExtraData || noteExtraData.outputType === OutputType.Transfer;
      if (isTransfer) {
        (tokenAmount as TransactionHistoryTransferTokenAmount).recipientAddress = encodeAddress(
          note.addressData,
        );
      }
      txidTransactionMap[txid].tokenAmounts.push(tokenAmount);
    });

    const preProcessHistory: TransactionHistoryEntryPreprocessSpent[] =
      Object.values(txidTransactionMap);

    const history: TransactionHistoryEntrySpent[] = preProcessHistory.map(
      ({ txid, tokenAmounts, version }) => {
        const transferTokenAmounts: TransactionHistoryTransferTokenAmount[] = [];
        let relayerFeeTokenAmount: Optional<TransactionHistoryTokenAmount>;
        const changeTokenAmounts: TransactionHistoryTokenAmount[] = [];

        tokenAmounts.forEach((tokenAmount) => {
          if (!tokenAmount.noteExtraData) {
            // Legacy notes without extra data, consider as a simple "transfer".
            transferTokenAmounts.push(tokenAmount as TransactionHistoryTransferTokenAmount);
            return;
          }
          switch (tokenAmount.noteExtraData.outputType) {
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

        const historyEntry: TransactionHistoryEntrySpent = {
          txid,
          transferTokenAmounts,
          relayerFeeTokenAmount,
          changeTokenAmounts,
          version,
        };
        return historyEntry;
      },
    );

    return history;
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
    TXOs.forEach((txOutput) => {
      const token = formatToByteLength(txOutput.note.token, 32, false);
      // If we don't have an entry for this token yet, create one
      if (!balances[token]) {
        balances[token] = {
          balance: BigInt(0),
          utxos: [],
        };
      }

      // If txOutput is unspent process it
      if (!txOutput.spendtxid) {
        // Store utxo
        balances[token].utxos.push(txOutput);

        // Increment balance
        balances[token].balance += txOutput.note.value;
      }
    });

    return balances;
  }

  async getBalance(chain: Chain, tokenAddress: string): Promise<Optional<bigint>> {
    const balances = await this.balances(chain);
    const balanceForToken = balances[formatToByteLength(tokenAddress, 32, false)];
    return balanceForToken ? balanceForToken.balance : undefined;
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

      // Loop through each UTXO and sort by tree
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
   * @param chain - chain data to scan
   */
  async scanBalances(chain: Chain) {
    EngineDebug.log(`scan wallet balances: chain ${chain.type}:${chain.id}`);

    const merkletree = this.merkletrees[chain.type][chain.id];

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
        this.creationBlockNumbers[chain.type][chain.id] != null
      ) {
        const creationBlockNumber = this.creationBlockNumbers[chain.type][chain.id];
        if (creationBlockNumber != null && walletDetails.creationTreeHeight == null) {
          const creationTreeHeight = await AbstractWallet.getCreationTreeHeight(
            merkletree,
            latestTree,
            creationBlockNumber,
          );
          if (creationTreeHeight != null) {
            walletDetails.creationTreeHeight = creationTreeHeight;
          }
        }
      }

      // Loop through each tree and scan
      for (let tree = 0; tree <= latestTree; tree += 1) {
        // Get scanned height
        let startScanHeight = walletDetails.treeScannedHeights[tree];

        // If creationTreeHeight exists, check if it is higher than default startScanHeight and start there if needed
        if (walletDetails.creationTreeHeight) {
          startScanHeight = Math.max(walletDetails.creationTreeHeight, startScanHeight);
        }

        // Create sparse array of tree
        // eslint-disable-next-line no-await-in-loop
        const treeHeight = await merkletree.getTreeLength(tree);
        const fetcher = new Array<Promise<Optional<Commitment>>>(treeHeight);

        // Fetch each leaf we need to scan
        for (let index = startScanHeight; index < treeHeight; index += 1) {
          fetcher[index] = merkletree.getCommitment(tree, index);
        }

        // Wait until all leaves are fetched
        // eslint-disable-next-line no-await-in-loop
        const leaves = await Promise.all(fetcher);

        // Start scanning primary and change
        // eslint-disable-next-line no-await-in-loop
        await this.scanLeaves(leaves, tree, chain, startScanHeight, treeHeight);

        // Commit new scanned height
        walletDetails.treeScannedHeights[tree] = leaves.length;

        // Write new wallet details to db
        // eslint-disable-next-line no-await-in-loop
        await this.db.put(this.getWalletDetailsPath(chain), msgpack.encode(walletDetails));
      }

      // Emit scanned event for this chain
      EngineDebug.log(`wallet: scanned ${chain}`);
      this.emit(EngineEvent.WalletScanComplete, { chain } as ScannedEventData);
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
  static async getCreationTreeHeight(
    merkletree: MerkleTree,
    latestTree: number,
    creationBlockNumber: number,
  ): Promise<Optional<number>> {
    if (creationBlockNumber == null) {
      return undefined;
    }

    // Loop through each tree and search commitments for creation tree height that matches block number
    for (let tree = 0; tree <= latestTree; tree += 1) {
      // Create sparse array of tree
      // eslint-disable-next-line no-await-in-loop
      const treeHeight = await merkletree.getTreeLength(tree);
      const fetcher = new Array<Promise<Optional<Commitment>>>(treeHeight);

      // Fetch each leaf we need to search
      for (let index = 0; index < treeHeight; index += 1) {
        fetcher[index] = merkletree.getCommitment(tree, index);
      }

      // Wait until all leaves are fetched
      // eslint-disable-next-line no-await-in-loop
      const leaves = await Promise.all(fetcher);

      // TODO: Binary search all commitments until we find the closest index >= creationBlockNumber
      // Search through leaves for matching blockNumber
      if (leaves) {
        const creationBlockIndex = leaves.findIndex(
          (commitment) =>
            commitment &&
            commitment.blockNumber !== undefined &&
            commitment.blockNumber >= creationBlockNumber,
        );

        if (creationBlockIndex > -1) {
          return creationBlockIndex;
        }
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
    // Clear namespace and then resave the walletDetails
    const namespace = this.getWalletDetailsPath(chain);
    await this.db.clearNamespace(namespace);
    // eslint-disable-next-line no-await-in-loop
    await this.db.put(this.getWalletDetailsPath(chain), msgpack.encode(walletDetails));
  }

  /**
   * Clears stored balances and re-scans fully.
   * @param chain - chain type/id to rescan
   */
  async fullRescanBalances(chain: Chain) {
    await this.clearScannedBalances(chain);
    return this.scanBalances(chain);
  }

  static dbPath(id: string): BytesData[] {
    return [fromUTF8String('wallet'), id];
  }

  static async read(
    db: Database,
    id: string,
    encryptionKey: BytesData,
  ): Promise<WalletData | ViewOnlyWalletData> {
    return msgpack.decode(
      arrayify(await db.getEncrypted(AbstractWallet.dbPath(id), encryptionKey)),
    );
  }

  static async write(
    db: Database,
    id: string,
    encryptionKey: BytesData,
    data: WalletData | ViewOnlyWalletData,
  ): Promise<void> {
    await db.putEncrypted(AbstractWallet.dbPath(id), encryptionKey, msgpack.encode(data));
  }

  /**
   * Loads encrypted wallet data from database.
   * @param db - database
   * @param encryptionKey - encryption key to use with database
   * @param id - wallet id
   */
  static async getEncryptedData(
    db: Database,
    encryptionKey: BytesData,
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

  async generateShareableViewingKey(): Promise<string> {
    const spendingPublicKeyString = packPoint(this.spendingPublicKey).toString('hex');
    const data: ShareableViewingKeyData = {
      vpriv: formatToByteLength(this.viewingKeyPair.privateKey, ByteLength.UINT_256),
      spub: spendingPublicKeyString,
    };
    return msgpack.encode(data).toString('hex');
  }
}

export { AbstractWallet };
