/* globals describe it */
import { randomBytes } from '@noble/hashes/utils';
import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { ERC20Deposit } from '../../src/note';
import { formatToByteLength, hexlify, hexToBigInt, random } from '../../src/utils/bytes';
import { ZERO_ADDRESS } from '../../src/utils/constants';
import { getRandomScalar } from '../../src/utils/keys-utils';
import { config } from '../config.test';
import { TokenType } from '../../src/models/formatted-types';
import { poseidon } from '../../src/utils/hash';

chai.use(chaiAsPromised);
const { expect } = chai;

const TOKEN: string = formatToByteLength(config.contracts.rail, 20, true);

let mpk: bigint;
let vpk: Uint8Array;
let deposit: ERC20Deposit;

describe('Note/ERC20/Deposit', () => {
  it('Should create deposit note', () => {
    mpk = getRandomScalar();
    const rand = random(16);
    deposit = new ERC20Deposit(mpk, rand, 1000n, TOKEN);
    const { tokenAddress, tokenType, tokenSubID } = deposit.tokenData;
    expect(tokenAddress).to.equal(TOKEN);
    expect(tokenType).to.equal(TokenType.ERC20);
    expect(tokenSubID).to.equal(ZERO_ADDRESS);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-assignment
    const npk: bigint = poseidon([mpk, hexToBigInt(rand)]);
    expect(deposit.notePublicKey).to.equal(npk);
    expect(deposit.valueHex).length(32);
  });

  it('Should validate length of random parameter', () => {
    const msg = /Random must be length 32.*/;
    mpk = getRandomScalar();
    expect(() => new ERC20Deposit(mpk, random(15), 1000n, TOKEN)).to.throw(msg);
    expect(() => new ERC20Deposit(mpk, random(17), 1000n, TOKEN)).to.throw(msg);
    expect(new ERC20Deposit(mpk, random(16), 1000n, TOKEN)).to.be.an.instanceOf(ERC20Deposit);
  });

  it('Should serialize to preImage and encryptedRandom', () => {
    mpk = getRandomScalar();
    vpk = randomBytes(32);
    const rand = random(16);
    deposit = new ERC20Deposit(mpk, rand, 1000n, TOKEN);
    const { preImage, encryptedRandom } = deposit.serialize(vpk);
    expect(hexlify(preImage.npk)).length(64);
    expect(preImage.token.tokenAddress).to.equal(TOKEN);
    expect(preImage.value).to.equal(1000n);

    expect(encryptedRandom).length(2);
  });
});
