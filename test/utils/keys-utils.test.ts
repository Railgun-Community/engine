/* globals describe it */
import { randomBytes, utf8ToBytes } from '@noble/hashes/utils';
import chai, { assert } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { before } from 'mocha';
import { poseidon } from "../../src/utils/hash";
import { ByteLength, nToHex } from '../../src/utils/bytes';
import {
  getPublicSpendingKey,
  getPublicViewingKey,
  getRandomScalar,
  signED25519,
  signEDDSA,
  verifyED25519,
  verifyEDDSA
} from '../../src/utils/keys-utils';


chai.use(chaiAsPromised);
const { expect } = chai;

let privateSpendingKey: Uint8Array;
let publicSpendingKey: [bigint, bigint];
let privateViewingKey: Uint8Array;
let publicViewingKey: Uint8Array;

describe('Test keys-utils', () => {
  before(async () => {
    privateSpendingKey = randomBytes(32);
    publicSpendingKey = getPublicSpendingKey(privateSpendingKey);
    privateViewingKey = randomBytes(32);
    publicViewingKey = await getPublicViewingKey(privateViewingKey);
  });

  it('Should return a random scalar', () => {
    const randomScalar = getRandomScalar();
    expect(randomScalar).to.be.a('bigint');
    expect(nToHex(randomScalar, ByteLength.UINT_256).length).to.equal(64);
  });

  it('Should create and verify EDDSA signatures', () => {
    const message = poseidon([1n, 2n]);

    const signature = signEDDSA(privateSpendingKey, message);
    assert.isTrue(verifyEDDSA(message, signature, publicSpendingKey));

    const fakeMessage = poseidon([2n, 3n]);
    assert.isFalse(verifyEDDSA(fakeMessage, signature, publicSpendingKey));
    assert.isFalse(verifyEDDSA(message, signature, [0n, 1n]));
  });

  it('Should create and verify ED25519 signatures', async () => {
    const message = utf8ToBytes(JSON.stringify({ data: 'value', more: { data: 'another_value' } }));

    const signature = await signED25519(message, privateViewingKey);
    assert.isTrue(await verifyED25519(message, signature, publicViewingKey));

    const fakeMessage = utf8ToBytes('123');
    assert.isFalse(await verifyED25519(fakeMessage, signature, publicViewingKey));
    // eslint-disable-next-line no-unused-expressions
    expect(verifyED25519(message, signature, randomBytes(32))).to.eventually.be.rejected;
  });
});
