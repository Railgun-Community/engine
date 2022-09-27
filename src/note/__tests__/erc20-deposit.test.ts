import { poseidon } from 'circomlibjs';
import { randomBytes } from '@noble/hashes/utils';
import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { formatToByteLength, hexlify, hexToBigInt, randomHex } from '../../utils/bytes';
import { ZERO_ADDRESS } from '../../utils/constants';
import { getRandomScalar } from '../../utils/keys-utils';
import { config } from '../../test/config.test';
import { TokenType } from '../../models/formatted-types';
import { ERC20Deposit } from '../erc20-deposit';

chai.use(chaiAsPromised);
const { expect } = chai;

const TOKEN: string = formatToByteLength(config.contracts.rail, 20, true);

let mpk: bigint;
let vpk: Uint8Array;
let deposit: ERC20Deposit;

describe('Note/ERC20/Deposit', () => {
  it('Should create deposit note', () => {
    mpk = getRandomScalar();
    const rand = randomHex(16);
    deposit = new ERC20Deposit(mpk, rand, 1000n, TOKEN);
    const { tokenAddress, tokenType, tokenSubID } = deposit.tokenData;
    expect(tokenAddress).to.equal(TOKEN);
    expect(tokenType).to.equal(TokenType.ERC20);
    expect(tokenSubID).to.equal(ZERO_ADDRESS);
    const npk: bigint = poseidon([mpk, hexToBigInt(rand)]);
    expect(deposit.notePublicKey).to.equal(npk);
    expect(deposit.value).to.equal(1000n);
  });

  it('Should validate length of random parameter', () => {
    const msg = /Random must be length 32.*/;
    mpk = getRandomScalar();
    expect(() => new ERC20Deposit(mpk, randomHex(15), 1000n, TOKEN)).to.throw(msg);
    expect(() => new ERC20Deposit(mpk, randomHex(17), 1000n, TOKEN)).to.throw(msg);
    expect(new ERC20Deposit(mpk, randomHex(16), 1000n, TOKEN)).to.be.an.instanceOf(ERC20Deposit);
  });

  it('Should serialize to preImage and encryptedRandom', () => {
    mpk = getRandomScalar();
    vpk = randomBytes(32);
    const rand = randomHex(16);
    deposit = new ERC20Deposit(mpk, rand, 1000n, TOKEN);
    const { preImage, encryptedRandom } = deposit.serialize(vpk);
    expect(hexlify(preImage.npk)).length(64);
    expect(preImage.token.tokenAddress).to.equal(TOKEN);
    expect(preImage.value).to.equal(1000n);

    expect(encryptedRandom).length(2);
  });
});
