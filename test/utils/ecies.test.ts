/* globals describe it */
import * as curve25519 from '@noble/ed25519';
import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { bytes } from '../../src/utils';
import { hexlify } from '../../src/utils/bytes';
import {
  encryptJSONDataWithSharedKey,
  tryDecryptJSONDataWithSharedKey,
} from '../../src/utils/ecies';

chai.use(chaiAsPromised);
const { expect } = chai;

describe('ecies', () => {
  it('Should encrypt and decrypt data using shared keys', async () => {
    const privateKey1 = bytes.random(32);
    const publicKey1 = await curve25519.getPublicKey(privateKey1);
    const privateKey2 = bytes.random(32);
    const publicKey2 = await curve25519.getPublicKey(privateKey2);

    const data: object = {
      text: '468abc',
      value: 2839094,
      hex: hexlify(bytes.random(), true),
    };

    const sharedKey = await curve25519.getSharedSecret(privateKey2, publicKey1);
    const encryptedData = encryptJSONDataWithSharedKey(data, hexlify(sharedKey));

    const sharedKeyAlternate = await curve25519.getSharedSecret(privateKey1, publicKey2);
    expect(sharedKeyAlternate).to.deep.equal(sharedKey);

    const decrypted = await tryDecryptJSONDataWithSharedKey(encryptedData, sharedKeyAlternate);
    expect(decrypted).to.deep.equal(data);
  });
});
