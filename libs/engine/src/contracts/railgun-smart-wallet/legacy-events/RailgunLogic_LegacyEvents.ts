import type { BaseContract, BigNumber, BigNumberish } from 'ethers';
import { PromiseOrValue, TypedEvent, TypedEventFilter } from '../../../typechain-types/common';

export type LegacyCommitmentCiphertextStruct = {
  ciphertext: [
    PromiseOrValue<BigNumberish>,
    PromiseOrValue<BigNumberish>,
    PromiseOrValue<BigNumberish>,
    PromiseOrValue<BigNumberish>,
  ];
  ephemeralKeys: [PromiseOrValue<BigNumberish>, PromiseOrValue<BigNumberish>];
  memo: PromiseOrValue<BigNumberish>[];
};

export type LegacyCommitmentCiphertextStructOutput = [
  [BigNumber, BigNumber, BigNumber, BigNumber],
  [BigNumber, BigNumber],
  BigNumber[],
] & {
  ciphertext: [BigNumber, BigNumber, BigNumber, BigNumber];
  ephemeralKeys: [BigNumber, BigNumber];
  memo: BigNumber[];
};

export type LegacyTokenDataStruct = {
  tokenType: PromiseOrValue<BigNumberish>;
  tokenAddress: PromiseOrValue<string>;
  tokenSubID: PromiseOrValue<BigNumberish>;
};

export type LegacyTokenDataStructOutput = [number, string, BigNumber] & {
  tokenType: number;
  tokenAddress: string;
  tokenSubID: BigNumber;
};

export type LegacyCommitmentPreimageStruct = {
  npk: PromiseOrValue<BigNumberish>;
  token: LegacyTokenDataStruct;
  value: PromiseOrValue<BigNumberish>;
};

export type LegacyCommitmentPreimageStructOutput = [
  BigNumber,
  LegacyTokenDataStructOutput,
  BigNumber,
] & {
  npk: BigNumber;
  token: LegacyTokenDataStructOutput;
  value: BigNumber;
};

export interface LegacyCommitmentBatchEventObject {
  treeNumber: BigNumber;
  startPosition: BigNumber;
  hash: BigNumber[];
  ciphertext: LegacyCommitmentCiphertextStructOutput[];
}
export type LegacyCommitmentBatchEvent = TypedEvent<
  [BigNumber, BigNumber, BigNumber[], LegacyCommitmentCiphertextStructOutput[]],
  LegacyCommitmentBatchEventObject
>;

export type LegacyCommitmentBatchEventFilter = TypedEventFilter<LegacyCommitmentBatchEvent>;

export interface LegacyGeneratedCommitmentBatchEventObject {
  treeNumber: BigNumber;
  startPosition: BigNumber;
  commitments: LegacyCommitmentPreimageStructOutput[];
  encryptedRandom: [BigNumber, BigNumber][];
}
export type LegacyGeneratedCommitmentBatchEvent = TypedEvent<
  [BigNumber, BigNumber, LegacyCommitmentPreimageStructOutput[], [BigNumber, BigNumber][]],
  LegacyGeneratedCommitmentBatchEventObject
>;

export type LegacyGeneratedCommitmentBatchEventFilter =
  TypedEventFilter<LegacyGeneratedCommitmentBatchEvent>;

export interface LegacyNullifiersEventObject {
  treeNumber: BigNumber;
  nullifier: BigNumber[];
}
export type LegacyNullifiersEvent = TypedEvent<
  [BigNumber, BigNumber[]],
  LegacyNullifiersEventObject
>;

export type LegacyNullifiersEventFilter = TypedEventFilter<LegacyNullifiersEvent>;

export interface LegacyRailgunLogic extends BaseContract {
  queryFilter<TEvent extends TypedEvent>(
    event: TypedEventFilter<TEvent>,
    fromBlockOrBlockhash?: string | Optional<number>,
    toBlock?: string | Optional<number>,
  ): Promise<Array<TEvent>>;

  filters: {
    CommitmentBatch(
      treeNumber?: null,
      startPosition?: null,
      hash?: null,
      ciphertext?: null,
    ): LegacyCommitmentBatchEventFilter;

    GeneratedCommitmentBatch(
      treeNumber?: null,
      startPosition?: null,
      commitments?: null,
      encryptedRandom?: null,
    ): LegacyGeneratedCommitmentBatchEventFilter;

    Nullifiers(treeNumber?: null, nullifier?: null): LegacyNullifiersEventFilter;
  };
}
