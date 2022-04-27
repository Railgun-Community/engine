import { EncryptedData } from '../models/transaction-types';
import { toUTF8String, combine, chunk, fromUTF8String } from './bytes';
import { encryptedDataToCiphertext, ciphertextToEncryptedData } from './ciphertext';
import { aes } from './encryption';

export const tryDecryptJSONDataWithSharedKey = async (
  encryptedData: EncryptedData,
  sharedKey: Uint8Array,
): Promise<object | null> => {
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

export const encryptJSONDataWithSharedKey = (data: object, sharedKey: string): EncryptedData => {
  const dataString = JSON.stringify(data);
  const chunkedData = chunk(fromUTF8String(dataString));
  const ciphertext = aes.gcm.encrypt(chunkedData, sharedKey);
  return ciphertextToEncryptedData(ciphertext);
};
