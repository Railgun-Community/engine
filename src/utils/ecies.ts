import { EncryptedData } from '../models/formatted-types';
import { toUTF8String, combine, chunk, fromUTF8String } from './bytes';
import { encryptedDataToCiphertext, ciphertextToEncryptedJSONData } from './ciphertext';
import { aes } from './encryption';

export const tryDecryptJSONDataWithSharedKey = (
  encryptedData: EncryptedData,
  sharedKey: Uint8Array,
): object | null => {
  try {
    const ciphertext = encryptedDataToCiphertext(encryptedData);
    const chunkedData = aes.gcm.decrypt(ciphertext, sharedKey);
    const dataString = toUTF8String(combine(chunkedData));
    return JSON.parse(dataString);
  } catch (err) {
    // Data is not addressed to this user.
    return null;
  }
};

export const encryptJSONDataWithSharedKey = (
  data: object,
  sharedKey: Uint8Array,
): EncryptedData => {
  const dataString = JSON.stringify(data);
  const chunkedData = chunk(fromUTF8String(dataString));
  const ciphertext = aes.gcm.encrypt(chunkedData, sharedKey);
  return ciphertextToEncryptedJSONData(ciphertext);
};
