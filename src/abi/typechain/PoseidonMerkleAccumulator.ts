/* Autogenerated file. Do not edit manually. */
/* tslint:disable */
/* eslint-disable */
import type {
  BaseContract,
  BigNumberish,
  BytesLike,
  FunctionFragment,
  Result,
  Interface,
  EventFragment,
  AddressLike,
  ContractRunner,
  ContractMethod,
  Listener,
} from "ethers";
import type {
  TypedContractEvent,
  TypedDeferredTopicFilter,
  TypedEventLog,
  TypedLogDescription,
  TypedListener,
  TypedContractMethod,
} from "./common";

export type TokenDataStruct = {
  tokenType: BigNumberish;
  tokenAddress: AddressLike;
  tokenSubID: BigNumberish;
};

export type TokenDataStructOutput = [
  tokenType: bigint,
  tokenAddress: string,
  tokenSubID: bigint
] & { tokenType: bigint; tokenAddress: string; tokenSubID: bigint };

export type CommitmentPreimageStruct = {
  npk: BytesLike;
  token: TokenDataStruct;
  value: BigNumberish;
};

export type CommitmentPreimageStructOutput = [
  npk: string,
  token: TokenDataStructOutput,
  value: bigint
] & { npk: string; token: TokenDataStructOutput; value: bigint };

export declare namespace PoseidonMerkleAccumulator {
  export type TransactionConfigurationStruct = {
    nullifiers: BytesLike[];
    commitmentsCount: BigNumberish;
    spendAccumulatorNumber: BigNumberish;
    unshieldPreimage: CommitmentPreimageStruct;
    boundParamsHash: BytesLike;
  };

  export type TransactionConfigurationStructOutput = [
    nullifiers: string[],
    commitmentsCount: bigint,
    spendAccumulatorNumber: bigint,
    unshieldPreimage: CommitmentPreimageStructOutput,
    boundParamsHash: string
  ] & {
    nullifiers: string[];
    commitmentsCount: bigint;
    spendAccumulatorNumber: bigint;
    unshieldPreimage: CommitmentPreimageStructOutput;
    boundParamsHash: string;
  };

  export type ShieldCiphertextStruct = {
    encryptedBundle: [BytesLike, BytesLike, BytesLike];
    shieldKey: BytesLike;
  };

  export type ShieldCiphertextStructOutput = [
    encryptedBundle: [string, string, string],
    shieldKey: string
  ] & { encryptedBundle: [string, string, string]; shieldKey: string };

  export type ShieldConfigurationStruct = {
    from: AddressLike;
    preimage: CommitmentPreimageStruct;
    ciphertext: PoseidonMerkleAccumulator.ShieldCiphertextStruct;
  };

  export type ShieldConfigurationStructOutput = [
    from: string,
    preimage: CommitmentPreimageStructOutput,
    ciphertext: PoseidonMerkleAccumulator.ShieldCiphertextStructOutput
  ] & {
    from: string;
    preimage: CommitmentPreimageStructOutput;
    ciphertext: PoseidonMerkleAccumulator.ShieldCiphertextStructOutput;
  };

  export type CommitmentCiphertextStruct = {
    ciphertext: BytesLike;
    blindedSenderViewingKey: BytesLike;
    blindedReceiverViewingKey: BytesLike;
  };

  export type CommitmentCiphertextStructOutput = [
    ciphertext: string,
    blindedSenderViewingKey: string,
    blindedReceiverViewingKey: string
  ] & {
    ciphertext: string;
    blindedSenderViewingKey: string;
    blindedReceiverViewingKey: string;
  };

  export type TreasuryFeeStruct = { tokenID: BytesLike; fee: BigNumberish };

  export type TreasuryFeeStructOutput = [tokenID: string, fee: bigint] & {
    tokenID: string;
    fee: bigint;
  };

  export type StateUpdateStruct = {
    commitments: BytesLike[];
    transactions: PoseidonMerkleAccumulator.TransactionConfigurationStruct[];
    shields: PoseidonMerkleAccumulator.ShieldConfigurationStruct[];
    commitmentCiphertext: PoseidonMerkleAccumulator.CommitmentCiphertextStruct[];
    treasuryFees: PoseidonMerkleAccumulator.TreasuryFeeStruct[];
    senderCiphertext: BytesLike;
  };

  export type StateUpdateStructOutput = [
    commitments: string[],
    transactions: PoseidonMerkleAccumulator.TransactionConfigurationStructOutput[],
    shields: PoseidonMerkleAccumulator.ShieldConfigurationStructOutput[],
    commitmentCiphertext: PoseidonMerkleAccumulator.CommitmentCiphertextStructOutput[],
    treasuryFees: PoseidonMerkleAccumulator.TreasuryFeeStructOutput[],
    senderCiphertext: string
  ] & {
    commitments: string[];
    transactions: PoseidonMerkleAccumulator.TransactionConfigurationStructOutput[];
    shields: PoseidonMerkleAccumulator.ShieldConfigurationStructOutput[];
    commitmentCiphertext: PoseidonMerkleAccumulator.CommitmentCiphertextStructOutput[];
    treasuryFees: PoseidonMerkleAccumulator.TreasuryFeeStructOutput[];
    senderCiphertext: string;
  };
}

export interface PoseidonMerkleAccumulatorInterface extends Interface {
  getFunction(
    nameOrSignature:
      | "ZERO_VALUE"
      | "accumulatorNumber"
      | "accumulatorRoot"
      | "addVector"
      | "checkSafetyVectors"
      | "getInsertionAccumulatorNumberAndStartingIndex"
      | "initialize"
      | "nextLeafIndex"
      | "nullifiers"
      | "owner"
      | "registry"
      | "removeVector"
      | "renounceOwnership"
      | "rootHistory"
      | "safetyVector"
      | "tokenVault"
      | "transferOwnership"
      | "updateAccumulator"
      | "zeros"
  ): FunctionFragment;

  getEvent(
    nameOrSignatureOrTopic:
      | "AccumulatorStateUpdate"
      | "Initialized"
      | "OwnershipTransferred"
  ): EventFragment;

  encodeFunctionData(
    functionFragment: "ZERO_VALUE",
    values?: undefined
  ): string;
  encodeFunctionData(
    functionFragment: "accumulatorNumber",
    values?: undefined
  ): string;
  encodeFunctionData(
    functionFragment: "accumulatorRoot",
    values?: undefined
  ): string;
  encodeFunctionData(
    functionFragment: "addVector",
    values: [BigNumberish]
  ): string;
  encodeFunctionData(
    functionFragment: "checkSafetyVectors",
    values?: undefined
  ): string;
  encodeFunctionData(
    functionFragment: "getInsertionAccumulatorNumberAndStartingIndex",
    values: [BigNumberish]
  ): string;
  encodeFunctionData(
    functionFragment: "initialize",
    values: [AddressLike, AddressLike, AddressLike]
  ): string;
  encodeFunctionData(
    functionFragment: "nextLeafIndex",
    values?: undefined
  ): string;
  encodeFunctionData(
    functionFragment: "nullifiers",
    values: [BigNumberish, BytesLike]
  ): string;
  encodeFunctionData(functionFragment: "owner", values?: undefined): string;
  encodeFunctionData(functionFragment: "registry", values?: undefined): string;
  encodeFunctionData(
    functionFragment: "removeVector",
    values: [BigNumberish]
  ): string;
  encodeFunctionData(
    functionFragment: "renounceOwnership",
    values?: undefined
  ): string;
  encodeFunctionData(
    functionFragment: "rootHistory",
    values: [BigNumberish, BytesLike]
  ): string;
  encodeFunctionData(
    functionFragment: "safetyVector",
    values: [BigNumberish]
  ): string;
  encodeFunctionData(
    functionFragment: "tokenVault",
    values?: undefined
  ): string;
  encodeFunctionData(
    functionFragment: "transferOwnership",
    values: [AddressLike]
  ): string;
  encodeFunctionData(
    functionFragment: "updateAccumulator",
    values: [PoseidonMerkleAccumulator.StateUpdateStruct]
  ): string;
  encodeFunctionData(functionFragment: "zeros", values: [BigNumberish]): string;

  decodeFunctionResult(functionFragment: "ZERO_VALUE", data: BytesLike): Result;
  decodeFunctionResult(
    functionFragment: "accumulatorNumber",
    data: BytesLike
  ): Result;
  decodeFunctionResult(
    functionFragment: "accumulatorRoot",
    data: BytesLike
  ): Result;
  decodeFunctionResult(functionFragment: "addVector", data: BytesLike): Result;
  decodeFunctionResult(
    functionFragment: "checkSafetyVectors",
    data: BytesLike
  ): Result;
  decodeFunctionResult(
    functionFragment: "getInsertionAccumulatorNumberAndStartingIndex",
    data: BytesLike
  ): Result;
  decodeFunctionResult(functionFragment: "initialize", data: BytesLike): Result;
  decodeFunctionResult(
    functionFragment: "nextLeafIndex",
    data: BytesLike
  ): Result;
  decodeFunctionResult(functionFragment: "nullifiers", data: BytesLike): Result;
  decodeFunctionResult(functionFragment: "owner", data: BytesLike): Result;
  decodeFunctionResult(functionFragment: "registry", data: BytesLike): Result;
  decodeFunctionResult(
    functionFragment: "removeVector",
    data: BytesLike
  ): Result;
  decodeFunctionResult(
    functionFragment: "renounceOwnership",
    data: BytesLike
  ): Result;
  decodeFunctionResult(
    functionFragment: "rootHistory",
    data: BytesLike
  ): Result;
  decodeFunctionResult(
    functionFragment: "safetyVector",
    data: BytesLike
  ): Result;
  decodeFunctionResult(functionFragment: "tokenVault", data: BytesLike): Result;
  decodeFunctionResult(
    functionFragment: "transferOwnership",
    data: BytesLike
  ): Result;
  decodeFunctionResult(
    functionFragment: "updateAccumulator",
    data: BytesLike
  ): Result;
  decodeFunctionResult(functionFragment: "zeros", data: BytesLike): Result;
}

export namespace AccumulatorStateUpdateEvent {
  export type InputTuple = [
    update: PoseidonMerkleAccumulator.StateUpdateStruct,
    accumulatorNumber: BigNumberish,
    startPosition: BigNumberish
  ];
  export type OutputTuple = [
    update: PoseidonMerkleAccumulator.StateUpdateStructOutput,
    accumulatorNumber: bigint,
    startPosition: bigint
  ];
  export interface OutputObject {
    update: PoseidonMerkleAccumulator.StateUpdateStructOutput;
    accumulatorNumber: bigint;
    startPosition: bigint;
  }
  export type Event = TypedContractEvent<InputTuple, OutputTuple, OutputObject>;
  export type Filter = TypedDeferredTopicFilter<Event>;
  export type Log = TypedEventLog<Event>;
  export type LogDescription = TypedLogDescription<Event>;
}

export namespace InitializedEvent {
  export type InputTuple = [version: BigNumberish];
  export type OutputTuple = [version: bigint];
  export interface OutputObject {
    version: bigint;
  }
  export type Event = TypedContractEvent<InputTuple, OutputTuple, OutputObject>;
  export type Filter = TypedDeferredTopicFilter<Event>;
  export type Log = TypedEventLog<Event>;
  export type LogDescription = TypedLogDescription<Event>;
}

export namespace OwnershipTransferredEvent {
  export type InputTuple = [previousOwner: AddressLike, newOwner: AddressLike];
  export type OutputTuple = [previousOwner: string, newOwner: string];
  export interface OutputObject {
    previousOwner: string;
    newOwner: string;
  }
  export type Event = TypedContractEvent<InputTuple, OutputTuple, OutputObject>;
  export type Filter = TypedDeferredTopicFilter<Event>;
  export type Log = TypedEventLog<Event>;
  export type LogDescription = TypedLogDescription<Event>;
}

export interface PoseidonMerkleAccumulator extends BaseContract {
  connect(runner?: ContractRunner | null): BaseContract;
  attach(addressOrName: AddressLike): this;
  deployed(): Promise<this>;

  interface: PoseidonMerkleAccumulatorInterface;

  queryFilter<TCEvent extends TypedContractEvent>(
    event: TCEvent,
    fromBlockOrBlockhash?: string | number | undefined,
    toBlock?: string | number | undefined
  ): Promise<Array<TypedEventLog<TCEvent>>>;
  queryFilter<TCEvent extends TypedContractEvent>(
    filter: TypedDeferredTopicFilter<TCEvent>,
    fromBlockOrBlockhash?: string | number | undefined,
    toBlock?: string | number | undefined
  ): Promise<Array<TypedEventLog<TCEvent>>>;

  on<TCEvent extends TypedContractEvent>(
    event: TCEvent,
    listener: TypedListener<TCEvent>
  ): Promise<this>;
  on<TCEvent extends TypedContractEvent>(
    filter: TypedDeferredTopicFilter<TCEvent>,
    listener: TypedListener<TCEvent>
  ): Promise<this>;

  once<TCEvent extends TypedContractEvent>(
    event: TCEvent,
    listener: TypedListener<TCEvent>
  ): Promise<this>;
  once<TCEvent extends TypedContractEvent>(
    filter: TypedDeferredTopicFilter<TCEvent>,
    listener: TypedListener<TCEvent>
  ): Promise<this>;

  listeners<TCEvent extends TypedContractEvent>(
    event: TCEvent
  ): Promise<Array<TypedListener<TCEvent>>>;
  listeners(eventName?: string): Promise<Array<Listener>>;
  removeAllListeners<TCEvent extends TypedContractEvent>(
    event?: TCEvent
  ): Promise<this>;

  ZERO_VALUE: TypedContractMethod<[], [string], "view">;

  accumulatorNumber: TypedContractMethod<[], [bigint], "view">;

  accumulatorRoot: TypedContractMethod<[], [string], "view">;

  addVector: TypedContractMethod<[vector: BigNumberish], [void], "nonpayable">;

  checkSafetyVectors: TypedContractMethod<[], [void], "nonpayable">;

  getInsertionAccumulatorNumberAndStartingIndex: TypedContractMethod<
    [_newCommitments: BigNumberish],
    [[bigint, bigint]],
    "view"
  >;

  initialize: TypedContractMethod<
    [
      _verifierRegistry: AddressLike,
      _tokenVault: AddressLike,
      _owner: AddressLike
    ],
    [void],
    "nonpayable"
  >;

  nextLeafIndex: TypedContractMethod<[], [bigint], "view">;

  nullifiers: TypedContractMethod<
    [arg0: BigNumberish, arg1: BytesLike],
    [boolean],
    "view"
  >;

  owner: TypedContractMethod<[], [string], "view">;

  registry: TypedContractMethod<[], [string], "view">;

  removeVector: TypedContractMethod<
    [vector: BigNumberish],
    [void],
    "nonpayable"
  >;

  renounceOwnership: TypedContractMethod<[], [void], "nonpayable">;

  rootHistory: TypedContractMethod<
    [arg0: BigNumberish, arg1: BytesLike],
    [boolean],
    "view"
  >;

  safetyVector: TypedContractMethod<[arg0: BigNumberish], [boolean], "view">;

  tokenVault: TypedContractMethod<[], [string], "view">;

  transferOwnership: TypedContractMethod<
    [newOwner: AddressLike],
    [void],
    "nonpayable"
  >;

  updateAccumulator: TypedContractMethod<
    [_update: PoseidonMerkleAccumulator.StateUpdateStruct],
    [void],
    "nonpayable"
  >;

  zeros: TypedContractMethod<[arg0: BigNumberish], [string], "view">;

  getFunction<T extends ContractMethod = ContractMethod>(
    key: string | FunctionFragment
  ): T;

  getFunction(
    nameOrSignature: "ZERO_VALUE"
  ): TypedContractMethod<[], [string], "view">;
  getFunction(
    nameOrSignature: "accumulatorNumber"
  ): TypedContractMethod<[], [bigint], "view">;
  getFunction(
    nameOrSignature: "accumulatorRoot"
  ): TypedContractMethod<[], [string], "view">;
  getFunction(
    nameOrSignature: "addVector"
  ): TypedContractMethod<[vector: BigNumberish], [void], "nonpayable">;
  getFunction(
    nameOrSignature: "checkSafetyVectors"
  ): TypedContractMethod<[], [void], "nonpayable">;
  getFunction(
    nameOrSignature: "getInsertionAccumulatorNumberAndStartingIndex"
  ): TypedContractMethod<
    [_newCommitments: BigNumberish],
    [[bigint, bigint]],
    "view"
  >;
  getFunction(
    nameOrSignature: "initialize"
  ): TypedContractMethod<
    [
      _verifierRegistry: AddressLike,
      _tokenVault: AddressLike,
      _owner: AddressLike
    ],
    [void],
    "nonpayable"
  >;
  getFunction(
    nameOrSignature: "nextLeafIndex"
  ): TypedContractMethod<[], [bigint], "view">;
  getFunction(
    nameOrSignature: "nullifiers"
  ): TypedContractMethod<
    [arg0: BigNumberish, arg1: BytesLike],
    [boolean],
    "view"
  >;
  getFunction(
    nameOrSignature: "owner"
  ): TypedContractMethod<[], [string], "view">;
  getFunction(
    nameOrSignature: "registry"
  ): TypedContractMethod<[], [string], "view">;
  getFunction(
    nameOrSignature: "removeVector"
  ): TypedContractMethod<[vector: BigNumberish], [void], "nonpayable">;
  getFunction(
    nameOrSignature: "renounceOwnership"
  ): TypedContractMethod<[], [void], "nonpayable">;
  getFunction(
    nameOrSignature: "rootHistory"
  ): TypedContractMethod<
    [arg0: BigNumberish, arg1: BytesLike],
    [boolean],
    "view"
  >;
  getFunction(
    nameOrSignature: "safetyVector"
  ): TypedContractMethod<[arg0: BigNumberish], [boolean], "view">;
  getFunction(
    nameOrSignature: "tokenVault"
  ): TypedContractMethod<[], [string], "view">;
  getFunction(
    nameOrSignature: "transferOwnership"
  ): TypedContractMethod<[newOwner: AddressLike], [void], "nonpayable">;
  getFunction(
    nameOrSignature: "updateAccumulator"
  ): TypedContractMethod<
    [_update: PoseidonMerkleAccumulator.StateUpdateStruct],
    [void],
    "nonpayable"
  >;
  getFunction(
    nameOrSignature: "zeros"
  ): TypedContractMethod<[arg0: BigNumberish], [string], "view">;

  getEvent(
    key: "AccumulatorStateUpdate"
  ): TypedContractEvent<
    AccumulatorStateUpdateEvent.InputTuple,
    AccumulatorStateUpdateEvent.OutputTuple,
    AccumulatorStateUpdateEvent.OutputObject
  >;
  getEvent(
    key: "Initialized"
  ): TypedContractEvent<
    InitializedEvent.InputTuple,
    InitializedEvent.OutputTuple,
    InitializedEvent.OutputObject
  >;
  getEvent(
    key: "OwnershipTransferred"
  ): TypedContractEvent<
    OwnershipTransferredEvent.InputTuple,
    OwnershipTransferredEvent.OutputTuple,
    OwnershipTransferredEvent.OutputObject
  >;

  filters: {
    "AccumulatorStateUpdate(tuple,uint32,uint224)": TypedContractEvent<
      AccumulatorStateUpdateEvent.InputTuple,
      AccumulatorStateUpdateEvent.OutputTuple,
      AccumulatorStateUpdateEvent.OutputObject
    >;
    AccumulatorStateUpdate: TypedContractEvent<
      AccumulatorStateUpdateEvent.InputTuple,
      AccumulatorStateUpdateEvent.OutputTuple,
      AccumulatorStateUpdateEvent.OutputObject
    >;

    "Initialized(uint8)": TypedContractEvent<
      InitializedEvent.InputTuple,
      InitializedEvent.OutputTuple,
      InitializedEvent.OutputObject
    >;
    Initialized: TypedContractEvent<
      InitializedEvent.InputTuple,
      InitializedEvent.OutputTuple,
      InitializedEvent.OutputObject
    >;

    "OwnershipTransferred(address,address)": TypedContractEvent<
      OwnershipTransferredEvent.InputTuple,
      OwnershipTransferredEvent.OutputTuple,
      OwnershipTransferredEvent.OutputObject
    >;
    OwnershipTransferred: TypedContractEvent<
      OwnershipTransferredEvent.InputTuple,
      OwnershipTransferredEvent.OutputTuple,
      OwnershipTransferredEvent.OutputObject
    >;
  };
}