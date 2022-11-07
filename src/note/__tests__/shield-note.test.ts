import { poseidon } from 'circomlibjs';
import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { randomBytes } from '@noble/hashes/utils';
import { formatToByteLength, hexlify, hexToBigInt, hexToBytes, randomHex } from '../../utils/bytes';
import { ZERO_ADDRESS } from '../../utils/constants';
import { getPublicViewingKey, getRandomScalar } from '../../utils/keys-utils';
import { config } from '../../test/config.test';
import { TokenType } from '../../models/formatted-types';
import { ShieldNote } from '../shield-note';

chai.use(chaiAsPromised);
const { expect } = chai;

const TOKEN: string = formatToByteLength(config.contracts.rail, 20, true);

let mpk: bigint;
let vpk: Uint8Array;
let shield: ShieldNote;

describe('Note/ShieldNote', () => {
  it('Should get expected signature message for shieldPrivateKey', () => {
    expect(ShieldNote.getShieldPrivateKeySignatureMessage()).to.equal('RAILGUN_SHIELD');
  });

  it('Should create shield note', () => {
    mpk = getRandomScalar();
    const rand = randomHex(16);
    shield = new ShieldNote(mpk, rand, 1000n, TOKEN);
    const { tokenAddress, tokenType, tokenSubID } = shield.tokenData;
    expect(tokenAddress).to.equal(TOKEN);
    expect(tokenType).to.equal(TokenType.ERC20);
    expect(tokenSubID).to.equal(ZERO_ADDRESS);
    const npk: bigint = poseidon([mpk, hexToBigInt(rand)]);
    expect(shield.notePublicKey).to.equal(npk);
    expect(shield.value).to.equal(1000n);
  });

  it('Should validate length of random parameter', () => {
    const msg = /Random must be length 32.*/;
    mpk = getRandomScalar();
    expect(() => new ShieldNote(mpk, randomHex(15), 1000n, TOKEN)).to.throw(msg);
    expect(() => new ShieldNote(mpk, randomHex(17), 1000n, TOKEN)).to.throw(msg);
    expect(new ShieldNote(mpk, randomHex(16), 1000n, TOKEN)).to.be.an.instanceOf(ShieldNote);
  });

  it('Should serialize ShieldNote to preimage and ciphertext', async () => {
    mpk = getRandomScalar();
    vpk = randomBytes(32);
    const viewingPublicKey = await getPublicViewingKey(vpk);
    const rand = randomHex(16);
    shield = new ShieldNote(mpk, rand, 1000n, TOKEN);
    const shieldPrivateKey = hexToBytes(randomHex(32));
    const { preimage, ciphertext } = await shield.serialize(shieldPrivateKey, viewingPublicKey);
    expect(hexlify(await preimage.npk)).length(64);
    expect(preimage.token.tokenAddress).to.equal(TOKEN);
    expect(preimage.value).to.equal(1000n);
    expect(ciphertext.encryptedBundle).length(3);
  });
});
