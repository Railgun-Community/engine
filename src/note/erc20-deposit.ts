import { DepositInput, TokenType } from '../models/formatted-types';
import { encryption } from '../utils';
import { ByteLength, hexToBigInt, nToHex } from '../utils/bytes';
import { ciphertextToEncryptedRandomData } from '../utils/ciphertext';
import { ZERO_ADDRESS } from '../utils/constants';
import { poseidon } from '../utils/hash';
import { Note } from './note';

export class ERC20Deposit {
  readonly masterPublicKey: bigint;

  readonly random: string;

  readonly value: bigint;

  readonly token: string;

  readonly tokenType = TokenType.ERC20;

  readonly notePublicKey: bigint;

  readonly hash: bigint;

  constructor(masterPublicKey: bigint, random: string, value: bigint, token: string) {
    Note.assertValidRandom(random);
    Note.assertValidToken(token, this.tokenType);

    this.masterPublicKey = masterPublicKey;
    this.random = random;
    this.token = token;
    this.value = value;
    this.notePublicKey = this.getNotePublicKey();
    this.hash = this.getHash();
  }

  get tokenData() {
    return {
      tokenAddress: this.token,
      tokenSubID: ZERO_ADDRESS,
      tokenType: this.tokenType,
    };
  }

  private getNotePublicKey(): bigint {
    return poseidon([this.masterPublicKey, hexToBigInt(this.random)]);
  }

  get valueHex(): string {
    return nToHex(this.value, ByteLength.UINT_128);
  }

  /**
   * Get note hash
   */
  private getHash(): bigint {
    return poseidon([this.notePublicKey, hexToBigInt(this.token), this.value]);
  }

  /**
   * Gets JSON serialized version of note
   * @param viewingPrivateKey - viewing private key for decryption
   * @param forContract - if we should 0x prefix the hex strings to make them ethers compatible
   * @returns serialized note
   */
  serialize(viewingPrivateKey: Uint8Array): DepositInput {
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
