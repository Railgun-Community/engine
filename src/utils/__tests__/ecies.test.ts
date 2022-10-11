import * as curve25519 from '@noble/ed25519';
import { randomBytes } from '@noble/hashes/utils';
import chai, { assert } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { hexlify, randomHex } from '../bytes';
import { getSharedSymmetricKey } from '../keys-utils';
import { encryptJSONDataWithSharedKey, tryDecryptJSONDataWithSharedKey } from '../ecies';

chai.use(chaiAsPromised);
const { expect } = chai;

describe('ecies', () => {
  it('Should encrypt and decrypt data using shared keys', async () => {
    const privateKey1 = randomBytes(32);
    const publicKey1 = await curve25519.getPublicKey(privateKey1);
    const privateKey2 = randomBytes(32);
    const publicKey2 = await curve25519.getPublicKey(privateKey2);

    const data: object = {
      text: '468abc',
      value: 2839094,
      hex: hexlify(randomHex(), true),
    };

    const sharedKey = await getSharedSymmetricKey(privateKey2, publicKey1);
    assert(sharedKey != null);
    const encryptedData = encryptJSONDataWithSharedKey(data, sharedKey);

    const sharedKeyAlternate = await getSharedSymmetricKey(privateKey1, publicKey2);
    expect(sharedKeyAlternate).to.deep.equal(sharedKey);
    assert(sharedKeyAlternate != null);

    const decrypted = await tryDecryptJSONDataWithSharedKey(encryptedData, sharedKeyAlternate);
    expect(decrypted).to.deep.equal(data);
  });
});
