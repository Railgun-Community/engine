// import { poseidon } from 'circomlibjs';
import { CommitmentPreimage, EncryptedRandom } from '../transaction/types';
import { encryption } from '../utils';
import { hexlify, hexToBigInt, nToHex } from '../utils/bytes';
import { ZERO_ADDRESS } from '../utils/constants';
import { poseidon } from '../utils/keys-utils';

export class Deposit {
  constructor(
    public masterPublicKey: bigint,
    public random: string,
    public value: bigint,
    public token: string,
  ) {}

  get tokenData() {
    return {
      tokenAddress: this.token,
      tokenSubID: ZERO_ADDRESS,
      tokenType: ZERO_ADDRESS,
    };
  }

  get notePublicKey(): bigint {
    return poseidon([this.masterPublicKey, hexToBigInt(this.random)]);
  }

  /**
   * Get note hash
   */
  get hash(): bigint {
    return poseidon([this.notePublicKey, hexToBigInt(this.token), this.value]);
  }

  /**
   * Gets JSON serialized version of note
   * @param viewingPrivateKey - viewing private key for decryption
   * @param forContract - if we should 0x prefix the hex strings to make them ethers compatible
   * @returns serialized note
   */
  serialize(viewingPrivateKey: Uint8Array): {
    preImage: Partial<CommitmentPreimage>;
    encryptedRandom: EncryptedRandom;
  } {
    const encryptedRandom = encryption.aes.gcm.encrypt([this.random], viewingPrivateKey);
    const ivTag = hexlify(encryptedRandom.iv, true) + hexlify(encryptedRandom.tag);
    const data = hexlify(encryptedRandom.data[0], true);
    return {
      preImage: {
        npk: nToHex(this.notePublicKey, true),
        token: this.tokenData,
        value: this.value,
      },
      encryptedRandom: [ivTag, data],
    };
  }
}
