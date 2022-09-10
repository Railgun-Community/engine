import { CTRCiphertext, NoteExtraData } from '../models/formatted-types';
import { MEMO_SENDER_BLINDING_KEY_NULL } from '../transaction/constants';
import { encryption } from '../utils';
import { ByteLength, nToHex } from '../utils/bytes';

export class Memo {
  static decryptNoteExtraData(
    memoField: string[],
    viewingPrivateKey: Uint8Array,
  ): Optional<NoteExtraData> {
    if (!memoField || !memoField.length) {
      return undefined;
    }

    try {
      const metadataField: string = memoField[0];
      const metadataCiphertext = {
        iv: metadataField.substring(0, 32),
        data: [metadataField.substring(32, 64)],
      };
      const decryptedMetadata: string = encryption.aes.ctr.decrypt(
        metadataCiphertext,
        viewingPrivateKey,
      )[0];

      const noteExtraData: NoteExtraData = {
        outputType: parseInt(decryptedMetadata.substring(0, 2), 16),
        senderBlindingKey: decryptedMetadata.substring(2, 32),
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

  private static encryptNoteExtraData(
    noteExtraData: NoteExtraData,
    viewingPrivateKey: Uint8Array,
  ): string {
    const outputTypeFormatted = nToHex(BigInt(noteExtraData.outputType), ByteLength.UINT_8); // 1 byte
    const senderBlindingKeyFormatted = noteExtraData.senderBlindingKey; // 15 bytes
    const metadataField: string = `${outputTypeFormatted}${senderBlindingKeyFormatted}`;
    if (metadataField.length !== 32) {
      throw new Error('Metadata field must be 16 bytes.');
    }

    const metadataCiphertext: CTRCiphertext = encryption.aes.ctr.encrypt(
      [metadataField],
      viewingPrivateKey,
    );

    return `${metadataCiphertext.iv}${metadataCiphertext.data.join('')}`;
  }

  static createMemoField(noteExtraData: NoteExtraData, viewingPrivateKey: Uint8Array): string[] {
    const metadataField: string = this.encryptNoteExtraData(noteExtraData, viewingPrivateKey);
    return [metadataField];
  }
}
