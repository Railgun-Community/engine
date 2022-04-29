import { CommitmentPreimage, TokenData, TokenType } from '../models/transaction-types';
import { ByteLength, formatToByteLength, hexToBigInt, nToHex } from '../utils/bytes';
import { ZERO_ADDRESS } from '../utils/constants';
import { poseidon } from '../utils/keys-utils';
import { Note } from './note';

export class ERC20WithdrawNote {
  public withdrawAddress: string;

  public value: bigint;

  public tokenAddress: string;

  public tokenType = TokenType.ERC20;

  /**
   * Create Note object
   *
   * @param {string} withdrawAddress - address to withdraw to
   * @param {bigint} value - note value
   * @param {string} tokenAddress - note token
   * @param {TokenType} tokenType - note token type
   */
  constructor(withdrawAddress: string, value: bigint, tokenAddress: string) {
    Note.assertValidToken(tokenAddress, this.tokenType);

    this.withdrawAddress = withdrawAddress;
    this.value = value;
    this.tokenAddress = tokenAddress;
  }

  get token(): TokenData {
    return {
      tokenAddress: formatToByteLength(this.tokenAddress, 20, true),
      tokenType: this.tokenType,
      tokenSubID: ZERO_ADDRESS,
    };
  }

  get npk(): string {
    return this.withdrawAddress;
  }

  get notePublicKey() {
    return BigInt(this.npk);
  }

  get valueHex() {
    return nToHex(this.value, ByteLength.UINT_128);
  }

  /**
   * Get note hash
   *
   * @returns {bigint} hash
   */
  get hash(): bigint {
    return poseidon([
      hexToBigInt(this.withdrawAddress),
      hexToBigInt(this.token.tokenAddress),
      this.value,
    ]);
  }

  get hashHex(): string {
    return nToHex(this.hash, ByteLength.UINT_256);
  }

  serialize(prefix: boolean = false) {
    return {
      npk: formatToByteLength(this.withdrawAddress, 32, prefix),
      token: this.token,
      value: this.valueHex,
    };
  }

  get preImage(): CommitmentPreimage {
    const { npk, token, value } = this;
    return { npk, token, value };
  }

  static empty() {
    return new ERC20WithdrawNote(ZERO_ADDRESS, BigInt(0), ZERO_ADDRESS);
  }
}
