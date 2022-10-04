import {
  CTRCiphertext,
  EncryptedNoteExtraData,
  NoteExtraData,
  OutputType,
} from '../models/formatted-types';
import { MEMO_SENDER_BLINDING_KEY_NULL } from '../models/transaction-constants';
import { arrayify, ByteLength, chunk, combine, hexlify, nToHex, padToLength } from '../utils/bytes';
import { aes } from '../utils/encryption';
import WalletInfo from '../wallet/wallet-info';

export const MEMO_METADATA_BYTE_CHUNKS = 2;

export class Memo {
  static decryptNoteExtraData(
    memoField: string[],
    viewingPrivateKey: Uint8Array,
  ): Optional<NoteExtraData> {
    if (!memoField || !memoField.length) {
      return undefined;
    }

    try {
      const hasTwoBytes = memoField.length > 1;

      const metadataCiphertext = {
        iv: memoField[0].substring(0, 32),
        data: hasTwoBytes
          ? [
              memoField[0].substring(32, 64),
              memoField[1].substring(0, 32),
              memoField[1].substring(32, 64),
            ]
          : [memoField[0].substring(32, 64)],
      };
      const decrypted = aes.ctr.decrypt(metadataCiphertext, viewingPrivateKey);

      const walletSource: Optional<string> = hasTwoBytes
        ? this.decodeWalletSource(decrypted[2])
        : undefined;

      const noteExtraData: NoteExtraData = {
        outputType: parseInt(decrypted[0].substring(0, 2), 16),
        senderBlindingKey: decrypted[0].substring(2, 32),
        walletSource,
      };
      return noteExtraData;
    } catch (err) {
      return undefined;
    }
  }

  static decryptSenderBlindingKey = (
    memoField: string[],
    viewingPrivateKey: Uint8Array,
  ): string => {
    const noteExtraData = Memo.decryptNoteExtraData(memoField, viewingPrivateKey);
    return noteExtraData ? noteExtraData.senderBlindingKey : MEMO_SENDER_BLINDING_KEY_NULL;
  };

  private static decodeWalletSource(decryptedBytes: string): Optional<string> {
    try {
      const decoded = WalletInfo.decodeWalletSource(decryptedBytes);
      return decoded;
    } catch (err) {
      return undefined;
    }
  }

  private static createEncryptedNoteExtraData(
    outputType: OutputType,
    senderBlindingKey: string,
    viewingPrivateKey: Uint8Array,
  ): string[] {
    const outputTypeFormatted = nToHex(BigInt(outputType), ByteLength.UINT_8); // 1 byte
    const senderBlindingKeyFormatted = senderBlindingKey; // 15 bytes
    const metadataField0: string = `${outputTypeFormatted}${senderBlindingKeyFormatted}`;
    if (metadataField0.length !== 32) {
      throw new Error('Metadata field 0 must be 16 bytes.');
    }

    const metadataField1 = new Array<string>(32).fill('0').join(''); // 32 zeroes

    let metadataField2 = WalletInfo.getEncodedWalletSource();
    while (metadataField2.length < 32) {
      metadataField2 = `0${metadataField2}`;
    }

    const toEncrypt = [metadataField0, metadataField1, metadataField2];

    const metadataCiphertext: CTRCiphertext = aes.ctr.encrypt(toEncrypt, viewingPrivateKey);

    return [
      `${metadataCiphertext.iv}${metadataCiphertext.data[0]}`,
      `${metadataCiphertext.data[1]}${metadataCiphertext.data[2]}`,
    ];
  }

  static encryptNoteExtraData(
    outputType: OutputType,
    senderBlindingKey: string,
    viewingPrivateKey: Uint8Array,
  ): EncryptedNoteExtraData {
    const metadataField: string[] = this.createEncryptedNoteExtraData(
      outputType,
      senderBlindingKey,
      viewingPrivateKey,
    );
    return metadataField;
  }

  static encodeSplitMemoText(memoText: Optional<string>): string[] {
    if (!memoText) {
      return [];
    }
    const encoded = hexlify(new TextEncoder().encode(memoText));
    const chunked = chunk(encoded);

    const lastChunk = chunked[chunked.length - 1];
    const paddedLastChunk = padToLength(lastChunk, ByteLength.UINT_256, 'right') as string;

    return [...chunked.slice(0, -1), paddedLastChunk];
  }

  static decodeMemoText(encoded: string[]): Optional<string> {
    if (!encoded.length) {
      return undefined;
    }

    const combined = combine(encoded);
    return new TextDecoder().decode(
      Buffer.from(arrayify(combined).filter((arrayValue) => arrayValue !== 0)),
    );
  }
}
