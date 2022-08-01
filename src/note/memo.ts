import { BytesData, CTRCiphertext, NoteExtraData } from '../models/formatted-types';
import { encryption } from '../utils';
import { ByteLength, nToHex } from '../utils/bytes';

export class Memo {
  static decryptNoteExtraData(
    memoField: string[],
    viewingPrivateKey: Uint8Array,
  ): NoteExtraData | undefined {
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
      };
      return noteExtraData;
    } catch (err) {
      return undefined;
    }
  }

  private static encryptNoteExtraData(
    noteExtraData: NoteExtraData,
    viewingPrivateKey: Uint8Array,
  ): string {
    const outputTypeFormatted: BytesData = nToHex(
      BigInt(noteExtraData.outputType),
      ByteLength.UINT_8,
    );
    let metadataField: string = outputTypeFormatted;
    while (metadataField.length < 32) {
      // Length must be 32 (16 bytes).
      metadataField += '00';
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
