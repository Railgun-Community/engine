/* globals describe it */
import { bytesToHex, randomBytes, utf8ToBytes } from '@noble/hashes/utils';
import chai, { assert } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { before } from 'mocha';
import { ByteLength, nToHex, randomHex } from '../../src/utils/bytes';
import { poseidon } from '../../src/utils/hash';
import {
  getEphemeralKeys,
  getPublicSpendingKey,
  getPublicViewingKey,
  getRandomScalar,
  getSharedSymmetricKey,
  invertKeySenderBlinding,
  signED25519,
  signEDDSA,
  unblindedEphemeralKey,
  verifyED25519,
  verifyEDDSA,
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
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-assignment
    const message: bigint = poseidon([1n, 2n]);

    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const signature = signEDDSA(privateSpendingKey, message);
    assert.isTrue(verifyEDDSA(message, signature, publicSpendingKey));

    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-assignment
    const fakeMessage: bigint = poseidon([2n, 3n]);
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
  it('Should get shared key from two ephemeral keys', async () => {
    const sender = randomBytes(32);
    const senderPublic = await getPublicViewingKey(sender);

    const receiver = randomBytes(32);
    const receiverPublic = await getPublicViewingKey(receiver);

    const random = bytesToHex(randomBytes(16));
    const senderBlindingKey = undefined;
    const [receiverEK, senderEK] = await getEphemeralKeys(
      senderPublic,
      receiverPublic,
      random,
      senderBlindingKey,
    );

    const k1 = await getSharedSymmetricKey(receiver, receiverEK);
    const k2 = await getSharedSymmetricKey(sender, senderEK);

    expect(k1).to.eql(k2);
  });
  it('Should get shared key from two ephemeral keys, with sender blinding key', async () => {
    const sender = randomBytes(32);
    const senderPublic = await getPublicViewingKey(sender);

    const receiver = randomBytes(32);
    const receiverPublic = await getPublicViewingKey(receiver);

    const random = bytesToHex(randomBytes(16));
    const senderBlindingKey = randomHex(15);
    const [receiverEK, senderEK] = await getEphemeralKeys(
      senderPublic,
      receiverPublic,
      random,
      senderBlindingKey,
    );

    const k1 = await getSharedSymmetricKey(receiver, receiverEK);
    const k2 = await getSharedSymmetricKey(sender, senderEK);

    expect(k1).to.eql(k2);
  });
  it('Should unblind ephemeral keys', async () => {
    const sender = randomBytes(32);
    const senderPublic = await getPublicViewingKey(sender);

    const receiver = randomBytes(32);
    const receiverPublic = await getPublicViewingKey(receiver);

    const random = bytesToHex(randomBytes(16));
    const senderBlindingKey = undefined;
    const [receiverEK, senderEK] = await getEphemeralKeys(
      senderPublic,
      receiverPublic,
      random,
      senderBlindingKey,
    );

    const senderUnblinded = unblindedEphemeralKey(receiverEK, random);
    const receiverUnblinded = unblindedEphemeralKey(senderEK, random);

    expect(senderPublic).to.eql(senderUnblinded);
    expect(receiverPublic).to.eql(receiverUnblinded);
  });
  it('Should unblind only receiver viewing key, with sender blinding key', async () => {
    const sender = randomBytes(32);
    const senderPublic = await getPublicViewingKey(sender);

    const receiver = randomBytes(32);
    const receiverPublic = await getPublicViewingKey(receiver);

    const senderBlindingKey = randomHex(15);
    const random = bytesToHex(randomBytes(16));
    const [receiverEK, senderEK] = await getEphemeralKeys(
      senderPublic,
      receiverPublic,
      random,
      senderBlindingKey,
    );

    const senderUnblindedNoBlindingKey = unblindedEphemeralKey(receiverEK, random);
    const receiverUnblindedNoBlindingKey = unblindedEphemeralKey(senderEK, random);
    const receiverUnblindedWithBlindingKey = invertKeySenderBlinding(
      receiverUnblindedNoBlindingKey,
      senderBlindingKey,
    );

    expect(senderPublic).to.not.eql(senderUnblindedNoBlindingKey);
    expect(receiverPublic).to.not.eql(receiverUnblindedNoBlindingKey);
    expect(receiverPublic).to.eql(receiverUnblindedWithBlindingKey);
  });
});
