import { CommitmentPreimage, EncryptedData, TokenType } from '../models/transaction-types';
import { encryption } from '../utils';
import { ByteLength, hexToBigInt, nToHex } from '../utils/bytes';
import { ciphertextToEncryptedRandomData } from '../utils/ciphertext';
import { ZERO_ADDRESS } from '../utils/constants';
import { poseidon } from '../utils/keys-utils';
import { Note } from './note';

export class ERC20Deposit {
  public masterPublicKey: bigint;

  public random: string;

  public value: bigint;

  public token: string;

  public tokenType = TokenType.ERC20;

  constructor(masterPublicKey: bigint, random: string, value: bigint, token: string) {
    Note.assertValidRandom(random);
    Note.assertValidToken(token, this.tokenType);

    this.masterPublicKey = masterPublicKey;
    this.random = random;
    this.token = token;
    this.value = value;
  }

  get tokenData() {
    return {
      tokenAddress: this.token,
      tokenSubID: ZERO_ADDRESS,
      tokenType: this.tokenType,
    };
  }

  get notePublicKey(): bigint {
    return poseidon([this.masterPublicKey, hexToBigInt(this.random)]);
  }

  get valueHex(): string {
    return nToHex(this.value, ByteLength.UINT_128);
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
    preImage: CommitmentPreimage;
    encryptedRandom: EncryptedData;
  } {
    const ciphertext = encryption.aes.gcm.encrypt([this.random], viewingPrivateKey);
    return {
      preImage: {
        npk: nToHex(this.notePublicKey, ByteLength.UINT_256, true),
        token: this.tokenData,
        value: this.value,
      },
      encryptedRandom: ciphertextToEncryptedRandomData(ciphertext),
    };
  }
}
