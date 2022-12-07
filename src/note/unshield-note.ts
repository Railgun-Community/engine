import { TokenData, TokenType } from '../models/formatted-types';
import { CommitmentPreimageStruct } from '../typechain-types/contracts/logic/RailgunSmartWallet';
import { ByteLength, nToHex } from '../utils/bytes';
import { ZERO_ADDRESS } from '../utils/constants';
import { TransactNote } from './transact-note';
import { getNoteHash, serializePreImage, serializeTokenData } from './note-util';

export class UnshieldNote {
  readonly unshieldAddress: string;

  readonly value: bigint;

  readonly tokenAddress: string;

  readonly tokenType: TokenType;

  readonly tokenSubID: string;

  readonly hash: bigint;

  /**
   * Create Note object
   *
   * @param {string} unshieldAddress - address to unshield to
   * @param {bigint} value - note value
   * @param {string} tokenAddress - note token
   * @param {TokenType} tokenType - note token type
   */
  constructor(
    unshieldAddress: string,
    value: bigint,
    tokenAddress: string,
    tokenType: TokenType,
    tokenSubID?: string,
  ) {
    TransactNote.assertValidToken(tokenAddress, tokenType, tokenSubID, value);

    this.unshieldAddress = unshieldAddress;
    this.value = value;
    this.tokenAddress = tokenAddress;
    this.tokenType = tokenType;
    this.tokenSubID = tokenSubID || ZERO_ADDRESS;
    this.hash = getNoteHash(unshieldAddress, tokenAddress, value);
  }

  get token(): TokenData {
    return serializeTokenData(this.tokenAddress, this.tokenType, this.tokenSubID);
  }

  get npk(): string {
    return this.unshieldAddress;
  }

  get notePublicKey() {
    return BigInt(this.npk);
  }

  get hashHex(): string {
    return nToHex(this.hash, ByteLength.UINT_256);
  }

  serialize(prefix: boolean = false) {
    return serializePreImage(this.unshieldAddress, this.token, this.value, prefix);
  }

  get preImage(): CommitmentPreimageStruct {
    const { npk, token, value } = this;
    return { npk, token, value };
  }

  static empty() {
    return new UnshieldNote(ZERO_ADDRESS, BigInt(0), ZERO_ADDRESS, TokenType.ERC20);
  }
}
