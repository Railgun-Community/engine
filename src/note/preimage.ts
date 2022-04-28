import { EncryptedData } from '../models/transaction-types';
import { ByteLength, formatToByteLength, hexToBigInt, nToHex } from '../utils/bytes';
import { ZERO_ADDRESS } from '../utils/constants';
import { poseidon } from '../utils/keys-utils';

export const emptyCommitmentPreimage = {
  npk: '00',
  token: {
    tokenType: '00',
    tokenAddress: '0x0000000000000000000000000000000000000000',
    tokenSubID: '00',
  },
  value: '0',
  encryptedRandom: ['00', '00'] as EncryptedData,
};

export class WithdrawNote {
  /**
   * Create Note object
   *
   * @param {string} withdrawAddress - address to withdraw to
   * @param {bigint} value - note value
   * @param {string} token - note token
   */
  constructor(public withdrawAddress: string, public value: bigint, public tokenAddress: string) {}

  get token() {
    return {
      tokenAddress: formatToByteLength(this.tokenAddress, 20, true),
      tokenType: ZERO_ADDRESS,
      tokenSubID: ZERO_ADDRESS,
    };
  }

  get npk() {
    return BigInt(this.withdrawAddress);
  }

  get notePublicKey() {
    return BigInt(this.withdrawAddress);
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

  serialize(prefix: boolean = false) {
    return {
      npk: formatToByteLength(this.withdrawAddress, 32, prefix),
      token: this.token,
      value: this.valueHex,
    };
  }

  get preImage() {
    const { npk, token, value } = this;
    return { npk, token, value };
  }

  static empty() {
    return new WithdrawNote(ZERO_ADDRESS, BigInt(0), ZERO_ADDRESS);
  }
}
