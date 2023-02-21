import type { BaseContract, BigNumber, BigNumberish, BytesLike } from 'ethers';
import { PromiseOrValue, TypedEvent, TypedEventFilter } from '../../../typechain-types/common';

export type TokenDataStruct_LegacyShield_PreMar23 = {
  tokenType: PromiseOrValue<BigNumberish>;
  tokenAddress: PromiseOrValue<string>;
  tokenSubID: PromiseOrValue<BigNumberish>;
};

export type TokenDataStructOutput_LegacyShield_PreMar23 = [number, string, BigNumber] & {
  tokenType: number;
  tokenAddress: string;
  tokenSubID: BigNumber;
};

export type CommitmentPreimageStruct = {
  npk: PromiseOrValue<BytesLike>;
  token: TokenDataStruct_LegacyShield_PreMar23;
  value: PromiseOrValue<BigNumberish>;
};

export type CommitmentPreimageStructOutput_LegacyShield_PreMar23 = [
  string,
  TokenDataStructOutput_LegacyShield_PreMar23,
  BigNumber,
] & {
  npk: string;
  token: TokenDataStructOutput_LegacyShield_PreMar23;
  value: BigNumber;
};

export type ShieldCiphertextStruct_LegacyShield_PreMar23 = {
  encryptedBundle: [
    PromiseOrValue<BytesLike>,
    PromiseOrValue<BytesLike>,
    PromiseOrValue<BytesLike>,
  ];
  shieldKey: PromiseOrValue<BytesLike>;
};

export type ShieldCiphertextStructOutput_LegacyShield_PreMar23 = [
  [string, string, string],
  string,
] & {
  encryptedBundle: [string, string, string];
  shieldKey: string;
};

export interface ShieldEventObject {
  treeNumber: BigNumber;
  startPosition: BigNumber;
  commitments: CommitmentPreimageStructOutput_LegacyShield_PreMar23[];
  shieldCiphertext: ShieldCiphertextStructOutput_LegacyShield_PreMar23[];
}
export type ShieldEvent = TypedEvent<
  [
    BigNumber,
    BigNumber,
    CommitmentPreimageStructOutput_LegacyShield_PreMar23[],
    ShieldCiphertextStructOutput_LegacyShield_PreMar23[],
  ],
  ShieldEventObject
>;

export type ShieldEventFilter = TypedEventFilter<ShieldEvent>;

export interface RailgunSmartWallet_LegacyShield_PreMar23 extends BaseContract {
  queryFilter<TEvent extends TypedEvent>(
    event: TypedEventFilter<TEvent>,
    fromBlockOrBlockhash?: string | number | undefined,
    toBlock?: string | number | undefined,
  ): Promise<Array<TEvent>>;

  filters: {
    Shield(
      treeNumber?: null,
      startPosition?: null,
      commitments?: null,
      shieldCiphertext?: null,
    ): ShieldEventFilter;
  };
}
