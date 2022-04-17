// import { poseidon } from 'circomlibjs';
import { CommitmentPreimage, EncryptedRandom } from '../transaction/types';
import { encryption } from '../utils';
import { hexlify, nToHex } from '../utils/bytes';
import { poseidon } from '../utils/hash';

export class Deposit {
  constructor(
    public masterPublicKey: string,
    public random: string,
    public value: bigint,
    public token: string,
  ) {}

  get tokenData() {
    return {
      tokenAddress: this.token,
      tokenSubID: '00',
      tokenType: '00',
    };
  }

  get notePublicKey() {
    return poseidon([this.masterPublicKey, this.random]);
  }

  /**
   * Get note hash
   */
  get hash(): string {
    return poseidon([this.notePublicKey, this.token, nToHex(this.value)]);
  }

  /**
   * Gets JSON serialized version of note
   * @param viewingPrivateKey - viewing private key for decryption
   * @param forContract - if we should 0x prefix the hex strings to make them ethers compatible
   * @returns serialized note
   */
  serialize(viewingPrivateKey: string): {
    preImage: Partial<CommitmentPreimage>;
    encryptedRandom: EncryptedRandom;
  } {
    const encryptedRandom = encryption.aes.gcm.encrypt([this.random], viewingPrivateKey);
    const ivTag = hexlify(encryptedRandom.iv, true) + hexlify(encryptedRandom.tag);
    const data = hexlify(encryptedRandom.data[0], true);
    return {
      preImage: {
        npk: hexlify(this.notePublicKey, true),
        token: this.tokenData,
        value: nToHex(this.value, true),
      },
      encryptedRandom: [ivTag, data],
    };
  }
}
