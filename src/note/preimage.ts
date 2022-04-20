import { EncryptedRandom, TokenData } from '../transaction/types';
import { hash } from '../utils';
import { nToHex } from '../utils/bytes';

export const emptyCommitmentPreimage = {
  npk: '00',
  token: {
    tokenType: '00',
    tokenAddress: '0x0000000000000000000000000000000000000000',
    tokenSubID: '00',
  },
  value: '0',
  encryptedRandom: ['00', '00'] as EncryptedRandom,
};

export class WithdrawNote {
  /**
   * Create Note object
   *
   * @param {bigint} withdrawAddress - address to withdraw to
   * @param {bigint} value - note value
   * @param {TokenData} token - note token
   */
  constructor(private withdrawAddress: string, private value: bigint, private token: TokenData) {}

  get notePublicKey() {
    return this.withdrawAddress;
  }

  /**
   * Get note hash
   *
   * @returns {string} hash
   */
  get hash(): string {
    return hash.poseidon([this.withdrawAddress, this.token.tokenAddress, nToHex(this.value)]);
  }

  serialize(encryptedRandom: EncryptedRandom = ['00', '00']) {
    return {
      npk: this.withdrawAddress,
      token: this.token,
      hash: this.hash,
      value: this.value.toString(16),
      encryptedRandom,
    };
  }

  /*
  format(): CommitmentPreimage {
    return {
      npk: this.withdrawAddress,
      token: {
        tokenType: 0n,
        tokenAddress: `0x${hexlify(this.token.tokenAddress).padStart(40, '0')}`,
        tokenSubID: 0n,
      },
      value: this.value,
    };
  }
  */
}
