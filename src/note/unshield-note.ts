import { UnshieldData } from '../models';
import { TokenData } from '../models/formatted-types';
import { CommitmentPreimageStruct } from '../typechain-types/contracts/logic/RailgunSmartWallet';
import { ByteLength, nToHex } from '../utils/bytes';
import {
  assertValidNoteToken,
  getNoteHash,
  getTokenDataHash,
  serializePreImage,
} from './note-util';

export abstract class UnshieldNote {
  readonly toAddress: string;

  readonly value: bigint;

  readonly tokenData: TokenData;

  readonly tokenHash: string;

  readonly hash: bigint;

  readonly allowOverride: boolean;

  /**
   * Create Note object
   *
   * @param toAddress - address to unshield to
   * @param value - note value
   * @param tokenData
   */
  constructor(toAddress: string, value: bigint, tokenData: TokenData, allowOverride: boolean) {
    assertValidNoteToken(tokenData, value);

    this.toAddress = toAddress;
    this.value = value;
    this.tokenData = tokenData;
    this.tokenHash = getTokenDataHash(tokenData);
    this.allowOverride = allowOverride;
    this.hash = getNoteHash(toAddress, tokenData, value);
  }

  get unshieldData(): UnshieldData {
    return {
      toAddress: this.toAddress,
      value: this.value,
      tokenData: this.tokenData,
      tokenHash: this.tokenHash,
      allowOverride: this.allowOverride,
    };
  }

  get npk(): string {
    return this.toAddress;
  }

  get notePublicKey() {
    return BigInt(this.npk);
  }

  get hashHex(): string {
    return nToHex(this.hash, ByteLength.UINT_256);
  }

  serialize(prefix: boolean = false) {
    return serializePreImage(this.toAddress, this.tokenData, this.value, prefix);
  }

  get preImage(): CommitmentPreimageStruct {
    const { npk, tokenData, value } = this;
    return { npk, token: tokenData, value };
  }
}
