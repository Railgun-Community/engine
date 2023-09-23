import {
  CTRCiphertext,
  EncryptedNoteAnnotationData,
  NoteAnnotationData,
  OutputType,
} from '../models/formatted-types';
import { MEMO_SENDER_RANDOM_NULL } from '../models/transaction-constants';
import { arrayify, ByteLength, hexlify, nToHex } from '../utils/bytes';
import { AES } from '../utils/encryption';
import { isDefined } from '../utils/is-defined';
import { isReactNative } from '../utils/runtime';
import WalletInfo from '../wallet/wallet-info';

// TextEncoder/TextDecoder (used in this file) needs to shimmed in React Native
if (isReactNative) {
  // eslint-disable-next-line global-require
  require('fast-text-encoding');
}

// Annotation Data used to be stored as the leading bytes in Memo field.
export const LEGACY_MEMO_METADATA_BYTE_CHUNKS = 2;

export class Memo {
  static decryptNoteAnnotationData(
    annotationData: string,
    viewingPrivateKey: Uint8Array,
  ): Optional<NoteAnnotationData> {
    if (!annotationData || !annotationData.length) {
      return undefined;
    }

    try {
      // Remove 0x prefix.
      const hexlified = hexlify(annotationData);

      const hasTwoBytes = hexlified.length > 64;

      const metadataCiphertext = {
        iv: hexlified.substring(0, 32),
        data: hasTwoBytes
          ? [hexlified.substring(32, 64), hexlified.substring(64, 96), hexlified.substring(96, 128)]
          : [hexlified.substring(32, 64)],
      };
      const decrypted = AES.decryptCTR(metadataCiphertext, viewingPrivateKey);

      const walletSource: Optional<string> = hasTwoBytes
        ? this.decodeWalletSource(decrypted[2])
        : undefined;

      const noteAnnotationData: NoteAnnotationData = {
        outputType: parseInt(decrypted[0].substring(0, 2), 16),
        senderRandom: decrypted[0].substring(2, 32),
        walletSource,
      };
      return noteAnnotationData;
    } catch (err) {
      return undefined;
    }
  }

  static decryptSenderRandom = (annotationData: string, viewingPrivateKey: Uint8Array): string => {
    const noteAnnotationData = Memo.decryptNoteAnnotationData(annotationData, viewingPrivateKey);
    return noteAnnotationData ? noteAnnotationData.senderRandom : MEMO_SENDER_RANDOM_NULL;
  };

  private static decodeWalletSource(decryptedBytes: string): Optional<string> {
    try {
      const decoded = WalletInfo.decodeWalletSource(decryptedBytes);
      return decoded;
    } catch (err) {
      return undefined;
    }
  }

  static createEncryptedNoteAnnotationData(
    outputType: OutputType,
    senderRandom: string,
    viewingPrivateKey: Uint8Array,
  ): EncryptedNoteAnnotationData {
    const outputTypeFormatted = nToHex(BigInt(outputType), ByteLength.UINT_8); // 1 byte
    const senderRandomFormatted = senderRandom; // 15 bytes
    const metadataField0: string = `${outputTypeFormatted}${senderRandomFormatted}`;
    if (metadataField0.length !== 32) {
      throw new Error('Metadata field 0 must be 16 bytes.');
    }

    const metadataField1 = new Array<string>(30).fill('0').join(''); // 32 zeroes

    let metadataField2 = WalletInfo.getEncodedWalletSource();
    while (metadataField2.length < 30) {
      metadataField2 = `0${metadataField2}`;
    }

    const toEncrypt = [metadataField0, metadataField1, metadataField2];

    const metadataCiphertext: CTRCiphertext = AES.encryptCTR(toEncrypt, viewingPrivateKey);

    return (
      metadataCiphertext.iv + // ciphertext IV
      metadataCiphertext.data[0] + // outputType/senderRandom
      metadataCiphertext.data[1] + // 32 zeroes
      metadataCiphertext.data[2] // Wallet source, prepended with 0s
    );
  }

  static encodeMemoText(memoText: Optional<string>): string {
    if (!isDefined(memoText)) {
      return '';
    }
    const encoded = hexlify(new TextEncoder().encode(memoText));
    return encoded;
  }

  static decodeMemoText(encoded: string): Optional<string> {
    if (!encoded.length) {
      return undefined;
    }
    return new TextDecoder().decode(Buffer.from(arrayify(encoded)));
  }
}
