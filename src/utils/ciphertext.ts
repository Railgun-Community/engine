import { Ciphertext, EncryptedData } from '../models/transaction-types';
import { chunk, combine, hexlify } from './bytes';

export const ciphertextToEncryptedRandomData = (ciphertext: Ciphertext): EncryptedData => {
  const ivTag = hexlify(ciphertext.iv, true) + hexlify(ciphertext.tag);
  const data = hexlify(ciphertext.data[0], true);
  return [ivTag, data];
};

export const ciphertextToEncryptedJSONData = (ciphertext: Ciphertext): EncryptedData => {
  const ivTag = hexlify(ciphertext.iv, true) + hexlify(ciphertext.tag);
  const data = combine(ciphertext.data.map((el) => hexlify(el)));
  return [ivTag, data];
};

export const encryptedDataToCiphertext = (encryptedData: EncryptedData): Ciphertext => {
  const hexlified = encryptedData.map((r) => hexlify(r));
  const ciphertext = {
    iv: hexlified[0].substring(0, 32),
    tag: hexlified[0].substring(32),
    data: chunk(hexlified[1]),
  };
  return ciphertext;
};
