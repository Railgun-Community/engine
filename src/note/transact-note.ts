import { poseidon } from 'circomlibjs';
import { AddressData, decodeAddress, encodeAddress } from '../key-derivation/bech32';
import { ViewingKeyPair } from '../key-derivation/wallet-node';
import {
  Ciphertext,
  LegacyNoteSerialized,
  NFTTokenData,
  NoteSerialized,
  OutputType,
  TokenData,
  TokenType,
} from '../models/formatted-types';
import { MEMO_SENDER_RANDOM_NULL } from '../models/transaction-constants';
import { TokenDataGetter } from '../token/token-data-getter';
import {
  ByteLength,
  chunk,
  combine,
  formatToByteLength,
  hexlify,
  hexToBigInt,
  nToBytes,
  nToHex,
  randomHex,
} from '../utils/bytes';
import { ciphertextToEncryptedRandomData, encryptedDataToCiphertext } from '../utils/ciphertext';
import { AES } from '../utils/encryption';
import { unblindNoteKey } from '../utils/keys-utils';
import { unblindNoteKeyLegacy } from '../utils/keys-utils-legacy';
import { LEGACY_MEMO_METADATA_BYTE_CHUNKS, Memo } from './memo';
import {
  assertValidNoteRandom,
  getTokenDataERC20,
  getTokenDataHash,
  ERC721_NOTE_VALUE,
  serializeTokenData,
} from './note-util';
import { isDefined } from '../utils/is-defined';

/**
 *
 * A Note on Encoded MPKs:
 *
 * The presence of senderRandom field, or an encoded/unencoded MPK in a decrypted note,
 * tells us whether or not the sender address was hidden or visible.
 *
 *          MPK               senderRandom                                Sender address
 * - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
 * Value    Unencoded         Random hex (15)                             Hidden
 * - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
 * Value    Encoded           undefined or MEMO_SENDER_RANDOM_NULL        Visible
 * - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
 */

export class TransactNote {
  // address data of recipient
  readonly receiverAddressData: AddressData;

  // address data of sender
  readonly senderAddressData: Optional<AddressData>;

  // 32 byte hash of token data
  readonly tokenHash: string;

  readonly tokenData: TokenData;

  // 16 byte random
  readonly random: string;

  // value to transfer as bigint
  readonly value: bigint;

  readonly notePublicKey: bigint;

  readonly hash: bigint;

  readonly outputType: Optional<OutputType>;

  // This is just the metadata at the start of the memo field.
  readonly annotationData: string;

  readonly memoText: Optional<string>;

  // Only used during serialization/storage of ShieldCommitments.
  readonly shieldFee: Optional<string>;

  readonly blockNumber: Optional<number>;

  /**
   * Create Note object from values
   * @param {BigInt} receiverAddressData - recipient wallet address data
   * @param {string} random - note randomness
   * @param {string} tokenData - note token ID
   * @param {BigInt} value - note value
   */
  private constructor(
    receiverAddressData: AddressData,
    senderAddressData: Optional<AddressData>,
    random: string,
    value: bigint,
    tokenData: TokenData,
    annotationData: string,
    outputType: Optional<OutputType>,
    memoText: Optional<string>,
    shieldFee: Optional<string>,
    blockNumber: Optional<number>,
  ) {
    assertValidNoteRandom(random);

    this.receiverAddressData = receiverAddressData;
    this.senderAddressData = senderAddressData;

    this.random = random;
    this.value = BigInt(value);
    this.tokenData = serializeTokenData(
      tokenData.tokenAddress,
      tokenData.tokenType,
      tokenData.tokenSubID,
    );
    this.tokenHash = getTokenDataHash(tokenData);
    this.notePublicKey = this.getNotePublicKey();
    this.hash = TransactNote.getHash(this.notePublicKey, this.tokenHash, this.value);
    this.annotationData = annotationData;
    this.outputType = outputType;
    this.memoText = memoText;
    this.shieldFee = shieldFee;
    this.blockNumber = blockNumber;
  }

  static createTransfer(
    receiverAddressData: AddressData,
    senderAddressData: Optional<AddressData>,
    value: bigint,
    tokenData: TokenData,
    senderViewingKeys: ViewingKeyPair,
    showSenderAddressToRecipient: boolean,
    outputType: OutputType,
    memoText: Optional<string>,
  ): TransactNote {
    // See note at top of file.
    const shouldCreateSenderRandom = !showSenderAddressToRecipient;
    const senderRandom = shouldCreateSenderRandom
      ? TransactNote.getSenderRandom()
      : MEMO_SENDER_RANDOM_NULL;

    const annotationData = Memo.createEncryptedNoteAnnotationData(
      outputType,
      senderRandom,
      senderViewingKeys.privateKey,
    );

    return new TransactNote(
      receiverAddressData,
      senderAddressData,
      TransactNote.getNoteRandom(),
      value,
      tokenData,
      annotationData,
      outputType,
      memoText,
      undefined, // shieldFee
      undefined, // blockNumber
    );
  }

  static createERC721Transfer(
    receiverAddressData: AddressData,
    senderAddressData: Optional<AddressData>,
    tokenData: NFTTokenData,
    senderViewingKeys: ViewingKeyPair,
    showSenderAddressToRecipient: boolean,
    memoText: Optional<string>,
  ): TransactNote {
    if (tokenData.tokenType !== TokenType.ERC721) {
      throw new Error(`Invalid token type for ERC721 transfer: ${tokenData.tokenType}`);
    }
    return TransactNote.createTransfer(
      receiverAddressData,
      senderAddressData,
      ERC721_NOTE_VALUE,
      tokenData,
      senderViewingKeys,
      showSenderAddressToRecipient,
      OutputType.Transfer,
      memoText,
    );
  }

  static createERC1155Transfer(
    receiverAddressData: AddressData,
    senderAddressData: Optional<AddressData>,
    tokenData: NFTTokenData,
    amount: bigint,
    senderViewingKeys: ViewingKeyPair,
    showSenderAddressToRecipient: boolean,
    memoText: Optional<string>,
  ): TransactNote {
    if (tokenData.tokenType !== TokenType.ERC1155) {
      throw new Error(`Invalid token type for ERC1155 transfer: ${tokenData.tokenType}`);
    }
    return TransactNote.createTransfer(
      receiverAddressData,
      senderAddressData,
      amount,
      tokenData,
      senderViewingKeys,
      showSenderAddressToRecipient,
      OutputType.Transfer,
      memoText,
    );
  }

  static getNoteRandom(): string {
    return randomHex(16);
  }

  static getSenderRandom(): string {
    return randomHex(15);
  }

  private getNotePublicKey(): bigint {
    return poseidon([this.receiverAddressData.masterPublicKey, hexToBigInt(this.random)]);
  }

  getSenderAddress(): Optional<string> {
    if (!this.senderAddressData) {
      return undefined;
    }
    return encodeAddress(this.senderAddressData);
  }

  /**
   * Get note hash
   * @returns {bigint} hash
   */
  static getHash(notePublicKey: bigint, tokenHash: string, value: bigint): bigint {
    return poseidon([notePublicKey, hexToBigInt(tokenHash), value]);
  }

  /**
   * AES-256-GCM encrypts note data
   * @param sharedKey - key to encrypt with
   */
  encrypt(
    sharedKey: Uint8Array,
    senderMasterPublicKey: bigint,
    senderRandom: Optional<string>,
  ): {
    noteCiphertext: Ciphertext;
    noteMemo: string;
    annotationData: string;
  } {
    const prefix = false;
    const { token, value, random } = this.formatFields(prefix);

    const receiverMasterPublicKey = this.receiverAddressData.masterPublicKey;

    // Encode the master public key only if the senderRandom is unset (sender wants address to be visible by receiver).
    const encodedMasterPublicKey = TransactNote.getEncodedMasterPublicKey(
      senderRandom,
      receiverMasterPublicKey,
      senderMasterPublicKey,
    );

    const encodedMemoText = Memo.encodeMemoText(this.memoText);
    const ciphertext = AES.encryptGCM(
      [
        nToHex(encodedMasterPublicKey, ByteLength.UINT_256),
        token,
        `${random}${value}`,
        encodedMemoText,
      ],
      sharedKey,
    );

    return {
      noteCiphertext: {
        ...ciphertext,
        data: ciphertext.data.slice(0, 3), // Remove encrypted memo text.
      },
      noteMemo: ciphertext.data[3],
      annotationData: this.annotationData,
    };
  }

  private static unblindViewingPublicKey(
    random: string,
    blindedViewingPublicKey: Optional<Uint8Array>,
    senderRandom: Optional<string>,
    isLegacyDecryption: boolean,
  ): Uint8Array {
    if (blindedViewingPublicKey && isDefined(senderRandom)) {
      const unblinded = isLegacyDecryption
        ? unblindNoteKeyLegacy(blindedViewingPublicKey, random, senderRandom)
        : unblindNoteKey(blindedViewingPublicKey, random, senderRandom);
      if (unblinded) {
        return unblinded;
      }
    }
    return new Uint8Array(); // dummy
  }

  /**
   * AES-256-GCM decrypts note data
   */
  static async decrypt(
    currentWalletAddressData: AddressData,
    noteCiphertext: Ciphertext,
    sharedKey: Uint8Array,
    memo: string,
    annotationData: string,
    blindedReceiverViewingKey: Optional<Uint8Array>,
    blindedSenderViewingKey: Optional<Uint8Array>,
    senderRandom: Optional<string>,
    isSentNote: boolean,
    isLegacyDecryption: boolean,
    tokenDataGetter: TokenDataGetter,
    blockNumber: Optional<number>,
  ): Promise<TransactNote> {
    const ciphertextDataWithMemoText = [...noteCiphertext.data, memo];
    const fullCiphertext: Ciphertext = {
      ...noteCiphertext,
      data: ciphertextDataWithMemoText,
    };

    // Decrypt values
    const decryptedValues = AES.decryptGCM(fullCiphertext, sharedKey).map((value) =>
      hexlify(value),
    );

    return this.noteFromDecryptedValues(
      currentWalletAddressData,
      decryptedValues,
      annotationData,
      blindedReceiverViewingKey,
      blindedSenderViewingKey,
      senderRandom,
      isSentNote,
      isLegacyDecryption,
      tokenDataGetter,
      blockNumber,
    );
  }

  static getDecodedMasterPublicKey(
    currentWalletMasterPublicKey: bigint,
    encodedMasterPublicKey: bigint,
    senderRandom: Optional<string>,
    isLegacyDecryption: boolean,
  ): bigint {
    if (
      isLegacyDecryption ||
      (isDefined(senderRandom) && senderRandom !== MEMO_SENDER_RANDOM_NULL)
    ) {
      return encodedMasterPublicKey; // Unencoded
    }
    return encodedMasterPublicKey ^ currentWalletMasterPublicKey;
  }

  static getEncodedMasterPublicKey(
    senderRandom: Optional<string>,
    receiverMasterPublicKey: bigint,
    senderMasterPublicKey: bigint,
  ): bigint {
    return isDefined(senderRandom) && senderRandom !== MEMO_SENDER_RANDOM_NULL
      ? receiverMasterPublicKey // Unencoded
      : receiverMasterPublicKey ^ senderMasterPublicKey;
  }

  private static async noteFromDecryptedValues(
    currentWalletAddressData: AddressData,
    decryptedValues: string[],
    annotationData: string,
    blindedReceiverViewingKey: Optional<Uint8Array>,
    blindedSenderViewingKey: Optional<Uint8Array>,
    senderRandom: Optional<string>,
    isSentNote: boolean,
    isLegacyDecryption: boolean,
    tokenDataGetter: TokenDataGetter,
    blockNumber: Optional<number>,
  ) {
    // Decrypted Values:
    // 0: Master Public Key (Encoded)
    // 1: Token Address
    // 2: Value
    // 3 (+ more array values for legacy): Optional Memo string

    const random = decryptedValues[2].substring(0, 32);
    const value = hexToBigInt(decryptedValues[2].substring(32, 64));
    const tokenHash = decryptedValues[1];
    const memoText = Memo.decodeMemoText(combine(decryptedValues.slice(3)));

    const tokenData = await tokenDataGetter.getTokenDataFromHash(tokenHash);

    const encodedMasterPublicKey = hexToBigInt(decryptedValues[0]);

    if (isSentNote) {
      // SENT note.
      const receiverAddressData: AddressData = {
        masterPublicKey: TransactNote.getDecodedMasterPublicKey(
          currentWalletAddressData.masterPublicKey,
          encodedMasterPublicKey,
          senderRandom,
          isLegacyDecryption,
        ),
        viewingPublicKey: TransactNote.unblindViewingPublicKey(
          random,
          blindedReceiverViewingKey,
          senderRandom,
          isLegacyDecryption,
        ),
      };
      return new TransactNote(
        receiverAddressData,
        currentWalletAddressData,
        random,
        value,
        tokenData,
        annotationData,
        undefined, // outputType
        memoText,
        undefined, // shieldFee
        blockNumber,
      );
    }

    // RECEIVE note.
    // Master public key will be encoded (different) if the sender wants address to be visible by receiver.

    const senderAddressVisible =
      encodedMasterPublicKey !== currentWalletAddressData.masterPublicKey;

    const senderAddressData: Optional<AddressData> = senderAddressVisible
      ? {
          masterPublicKey: TransactNote.getDecodedMasterPublicKey(
            currentWalletAddressData.masterPublicKey,
            encodedMasterPublicKey,
            undefined, // Sender is not blinded, null senderRandom.
            isLegacyDecryption,
          ),
          viewingPublicKey: TransactNote.unblindViewingPublicKey(
            random,
            blindedSenderViewingKey,
            MEMO_SENDER_RANDOM_NULL, // Sender is not blinded, null senderRandom.
            isLegacyDecryption,
          ),
        }
      : undefined;
    return new TransactNote(
      currentWalletAddressData,
      senderAddressData,
      random,
      value,
      tokenData,
      annotationData,
      undefined, // outputType
      memoText,
      undefined, // shieldFee
      blockNumber,
    );
  }

  private formatFields(prefix: boolean = false) {
    return {
      npk: nToHex(this.notePublicKey, ByteLength.UINT_256, prefix),
      token: formatToByteLength(this.tokenHash, ByteLength.UINT_256, prefix),
      value: nToHex(BigInt(this.value), ByteLength.UINT_128, prefix),
      random: formatToByteLength(this.random, ByteLength.UINT_128, prefix),
      annotationData: this.annotationData,
      outputType: this.outputType ?? undefined,
      shieldFee: this.shieldFee ?? undefined,
    };
  }

  /**
   * Gets JSON serialized version of note
   * @returns serialized note
   */
  serialize(prefix?: boolean): NoteSerialized {
    const { npk, token, value, random, annotationData, outputType, shieldFee } =
      this.formatFields(prefix);
    return {
      npk,
      token,
      value,
      random,
      annotationData,
      outputType,
      recipientAddress: encodeAddress(this.receiverAddressData),
      senderAddress: this.senderAddressData ? encodeAddress(this.senderAddressData) : undefined,
      memoText: this.memoText,
      shieldFee,
      blockNumber: this.blockNumber,
    };
  }

  serializeLegacy(viewingPrivateKey: Uint8Array, prefix?: boolean): LegacyNoteSerialized {
    const { npk, token, value, random } = this.formatFields(prefix);
    const memoField: string[] = chunk(this.annotationData).map((el) =>
      formatToByteLength(el, ByteLength.UINT_256, prefix),
    );
    const randomCiphertext = AES.encryptGCM([random], viewingPrivateKey);
    const [ivTag, data] = ciphertextToEncryptedRandomData(randomCiphertext);

    return {
      npk,
      token,
      value,
      encryptedRandom: [ivTag, data].map((v) => hexlify(v, prefix)) as [string, string],
      memoField,
      recipientAddress: encodeAddress(this.receiverAddressData),
      memoText: this.memoText,
      blockNumber: this.blockNumber,
    };
  }

  static isLegacyTransactNote(noteData: NoteSerialized | LegacyNoteSerialized): boolean {
    return 'encryptedRandom' in noteData;
  }

  /**
   * Creates note from serialized note JSON
   * @param noteData - serialized note data
   * @param viewingPrivateKey - viewing private key for decryption
   * @returns TransactNote
   */
  static async deserialize(
    noteData: NoteSerialized | LegacyNoteSerialized,
    viewingPrivateKey: Uint8Array,
    tokenDataGetter: TokenDataGetter,
  ): Promise<TransactNote> {
    if ('encryptedRandom' in noteData) {
      // LegacyNoteSerialized type.
      return TransactNote.deserializeLegacy(noteData, viewingPrivateKey);
    }

    const tokenHash = noteData.token;
    const tokenData = await tokenDataGetter.getTokenDataFromHash(tokenHash);

    // NoteSerialized type.
    return new TransactNote(
      decodeAddress(noteData.recipientAddress),
      isDefined(noteData.senderAddress) ? decodeAddress(noteData.senderAddress) : undefined,
      noteData.random,
      hexToBigInt(noteData.value),
      tokenData,
      noteData.annotationData,
      noteData.outputType ?? undefined,
      noteData.memoText ?? undefined,
      noteData.shieldFee ?? undefined,
      noteData.blockNumber ?? undefined,
    );
  }

  /**
   * Creates note from serialized note JSON
   * @param noteData - serialized note data
   * @param viewingPrivateKey - viewing private key for decryption
   * @returns TransactNote
   */
  private static deserializeLegacy(
    noteData: LegacyNoteSerialized,
    viewingPrivateKey: Uint8Array,
  ): TransactNote {
    const randomCiphertext = encryptedDataToCiphertext(noteData.encryptedRandom);
    const decryptedRandom = AES.decryptGCM(randomCiphertext, viewingPrivateKey);

    const annotationDataChunked = isDefined(noteData.memoField)
      ? noteData.memoField.slice(0, LEGACY_MEMO_METADATA_BYTE_CHUNKS)
      : [];
    const annotationData: string = combine(annotationDataChunked);

    // Legacy can only be erc20.
    const tokenHash = noteData.token;
    const tokenData = getTokenDataERC20(tokenHash);

    return new TransactNote(
      decodeAddress(noteData.recipientAddress),
      undefined, // senderAddress
      combine(decryptedRandom),
      hexToBigInt(noteData.value),
      tokenData,
      annotationData,
      undefined, // outputType
      noteData.memoText ?? undefined,
      undefined, // shieldFee
      noteData.blockNumber ?? undefined,
    );
  }

  /**
   * Calculates nullifier for a given note
   * @param nullifyingKey - nullifying key
   * @param leafIndex - Index of note's commitment in the Merkle tree
   * @returns nullifier (hex string)
   */
  static getNullifier(nullifyingKey: bigint, leafIndex: number): bigint {
    return poseidon([nullifyingKey, BigInt(leafIndex)]);
  }

  newProcessingNoteWithValue(value: bigint): TransactNote {
    return new TransactNote(
      this.receiverAddressData,
      this.senderAddressData,
      TransactNote.getNoteRandom(),
      value,
      this.tokenData,
      this.annotationData,
      this.outputType,
      this.memoText,
      this.shieldFee,
      undefined, // blockNumber
    );
  }

  static calculateTotalNoteValues = (notes: TransactNote[]): bigint =>
    notes.reduce((left, right) => left + right.value, BigInt(0));

  /**
   * TransactNote with tokenData and value, for a mimic Unshield Note during solution processing.
   * All other fields are placeholders.
   */
  static createNullUnshieldNote(tokenData: TokenData, value: bigint): TransactNote {
    const nullAddressData: AddressData = {
      masterPublicKey: 0n,
      viewingPublicKey: nToBytes(0n, ByteLength.UINT_256),
    };
    return new TransactNote(
      nullAddressData,
      undefined, // senderAddressData
      TransactNote.getNoteRandom(),
      value,
      tokenData,
      '', // annotationData
      undefined, // outputType
      undefined, // memoText
      undefined, // shieldFee
      undefined, // blockNumber
    );
  }
}
