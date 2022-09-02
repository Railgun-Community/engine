/* Autogenerated file. Do not edit manually. */
/* tslint:disable */
/* eslint-disable */
import type {
  BaseContract,
  BigNumber,
  BigNumberish,
  BytesLike,
  CallOverrides,
  ContractTransaction,
  Overrides,
  PopulatedTransaction,
  Signer,
  utils,
} from "ethers";
import type {
  FunctionFragment,
  Result,
  EventFragment,
} from "@ethersproject/abi";
import type { Listener, Provider } from "@ethersproject/providers";
import type {
  TypedEventFilter,
  TypedEvent,
  TypedListener,
  OnEvent,
  PromiseOrValue,
} from "../../common";

export interface DelegatorInterface extends utils.Interface {
  functions: {
    "callContract(address,bytes,uint256)": FunctionFragment;
    "checkPermission(address,address,bytes4)": FunctionFragment;
    "owner()": FunctionFragment;
    "permissions(address,address,bytes4)": FunctionFragment;
    "renounceOwnership()": FunctionFragment;
    "setPermission(address,address,bytes4,bool)": FunctionFragment;
    "transferOwnership(address)": FunctionFragment;
  };

  getFunction(
    nameOrSignatureOrTopic:
      | "callContract"
      | "checkPermission"
      | "owner"
      | "permissions"
      | "renounceOwnership"
      | "setPermission"
      | "transferOwnership"
  ): FunctionFragment;

  encodeFunctionData(
    functionFragment: "callContract",
    values: [
      PromiseOrValue<string>,
      PromiseOrValue<BytesLike>,
      PromiseOrValue<BigNumberish>
    ]
  ): string;
  encodeFunctionData(
    functionFragment: "checkPermission",
    values: [
      PromiseOrValue<string>,
      PromiseOrValue<string>,
      PromiseOrValue<BytesLike>
    ]
  ): string;
  encodeFunctionData(functionFragment: "owner", values?: undefined): string;
  encodeFunctionData(
    functionFragment: "permissions",
    values: [
      PromiseOrValue<string>,
      PromiseOrValue<string>,
      PromiseOrValue<BytesLike>
    ]
  ): string;
  encodeFunctionData(
    functionFragment: "renounceOwnership",
    values?: undefined
  ): string;
  encodeFunctionData(
    functionFragment: "setPermission",
    values: [
      PromiseOrValue<string>,
      PromiseOrValue<string>,
      PromiseOrValue<BytesLike>,
      PromiseOrValue<boolean>
    ]
  ): string;
  encodeFunctionData(
    functionFragment: "transferOwnership",
    values: [PromiseOrValue<string>]
  ): string;

  decodeFunctionResult(
    functionFragment: "callContract",
    data: BytesLike
  ): Result;
  decodeFunctionResult(
    functionFragment: "checkPermission",
    data: BytesLike
  ): Result;
  decodeFunctionResult(functionFragment: "owner", data: BytesLike): Result;
  decodeFunctionResult(
    functionFragment: "permissions",
    data: BytesLike
  ): Result;
  decodeFunctionResult(
    functionFragment: "renounceOwnership",
    data: BytesLike
  ): Result;
  decodeFunctionResult(
    functionFragment: "setPermission",
    data: BytesLike
  ): Result;
  decodeFunctionResult(
    functionFragment: "transferOwnership",
    data: BytesLike
  ): Result;

  events: {
    "GrantPermission(address,address,bytes4)": EventFragment;
    "OwnershipTransferred(address,address)": EventFragment;
    "RevokePermission(address,address,bytes4)": EventFragment;
  };

  getEvent(nameOrSignatureOrTopic: "GrantPermission"): EventFragment;
  getEvent(nameOrSignatureOrTopic: "OwnershipTransferred"): EventFragment;
  getEvent(nameOrSignatureOrTopic: "RevokePermission"): EventFragment;
}

export interface GrantPermissionEventObject {
  caller: string;
  contractAddress: string;
  selector: string;
}
export type GrantPermissionEvent = TypedEvent<
  [string, string, string],
  GrantPermissionEventObject
>;

export type GrantPermissionEventFilter = TypedEventFilter<GrantPermissionEvent>;

export interface OwnershipTransferredEventObject {
  previousOwner: string;
  newOwner: string;
}
export type OwnershipTransferredEvent = TypedEvent<
  [string, string],
  OwnershipTransferredEventObject
>;

export type OwnershipTransferredEventFilter =
  TypedEventFilter<OwnershipTransferredEvent>;

export interface RevokePermissionEventObject {
  caller: string;
  contractAddress: string;
  selector: string;
}
export type RevokePermissionEvent = TypedEvent<
  [string, string, string],
  RevokePermissionEventObject
>;

export type RevokePermissionEventFilter =
  TypedEventFilter<RevokePermissionEvent>;

export interface Delegator extends BaseContract {
  connect(signerOrProvider: Signer | Provider | string): this;
  attach(addressOrName: string): this;
  deployed(): Promise<this>;

  interface: DelegatorInterface;

  queryFilter<TEvent extends TypedEvent>(
    event: TypedEventFilter<TEvent>,
    fromBlockOrBlockhash?: string | number | undefined,
    toBlock?: string | number | undefined
  ): Promise<Array<TEvent>>;

  listeners<TEvent extends TypedEvent>(
    eventFilter?: TypedEventFilter<TEvent>
  ): Array<TypedListener<TEvent>>;
  listeners(eventName?: string): Array<Listener>;
  removeAllListeners<TEvent extends TypedEvent>(
    eventFilter: TypedEventFilter<TEvent>
  ): this;
  removeAllListeners(eventName?: string): this;
  off: OnEvent<this>;
  on: OnEvent<this>;
  once: OnEvent<this>;
  removeListener: OnEvent<this>;

  functions: {
    callContract(
      _contract: PromiseOrValue<string>,
      _data: PromiseOrValue<BytesLike>,
      _value: PromiseOrValue<BigNumberish>,
      overrides?: Overrides & { from?: PromiseOrValue<string> }
    ): Promise<ContractTransaction>;

    checkPermission(
      _caller: PromiseOrValue<string>,
      _contract: PromiseOrValue<string>,
      _selector: PromiseOrValue<BytesLike>,
      overrides?: CallOverrides
    ): Promise<[boolean]>;

    owner(overrides?: CallOverrides): Promise<[string]>;

    permissions(
      arg0: PromiseOrValue<string>,
      arg1: PromiseOrValue<string>,
      arg2: PromiseOrValue<BytesLike>,
      overrides?: CallOverrides
    ): Promise<[boolean]>;

    renounceOwnership(
      overrides?: Overrides & { from?: PromiseOrValue<string> }
    ): Promise<ContractTransaction>;

    setPermission(
      _caller: PromiseOrValue<string>,
      _contract: PromiseOrValue<string>,
      _selector: PromiseOrValue<BytesLike>,
      _permission: PromiseOrValue<boolean>,
      overrides?: Overrides & { from?: PromiseOrValue<string> }
    ): Promise<ContractTransaction>;

    transferOwnership(
      newOwner: PromiseOrValue<string>,
      overrides?: Overrides & { from?: PromiseOrValue<string> }
    ): Promise<ContractTransaction>;
  };

  callContract(
    _contract: PromiseOrValue<string>,
    _data: PromiseOrValue<BytesLike>,
    _value: PromiseOrValue<BigNumberish>,
    overrides?: Overrides & { from?: PromiseOrValue<string> }
  ): Promise<ContractTransaction>;

  checkPermission(
    _caller: PromiseOrValue<string>,
    _contract: PromiseOrValue<string>,
    _selector: PromiseOrValue<BytesLike>,
    overrides?: CallOverrides
  ): Promise<boolean>;

  owner(overrides?: CallOverrides): Promise<string>;

  permissions(
    arg0: PromiseOrValue<string>,
    arg1: PromiseOrValue<string>,
    arg2: PromiseOrValue<BytesLike>,
    overrides?: CallOverrides
  ): Promise<boolean>;

  renounceOwnership(
    overrides?: Overrides & { from?: PromiseOrValue<string> }
  ): Promise<ContractTransaction>;

  setPermission(
    _caller: PromiseOrValue<string>,
    _contract: PromiseOrValue<string>,
    _selector: PromiseOrValue<BytesLike>,
    _permission: PromiseOrValue<boolean>,
    overrides?: Overrides & { from?: PromiseOrValue<string> }
  ): Promise<ContractTransaction>;

  transferOwnership(
    newOwner: PromiseOrValue<string>,
    overrides?: Overrides & { from?: PromiseOrValue<string> }
  ): Promise<ContractTransaction>;

  callStatic: {
    callContract(
      _contract: PromiseOrValue<string>,
      _data: PromiseOrValue<BytesLike>,
      _value: PromiseOrValue<BigNumberish>,
      overrides?: CallOverrides
    ): Promise<[boolean, string] & { success: boolean; returnData: string }>;

    checkPermission(
      _caller: PromiseOrValue<string>,
      _contract: PromiseOrValue<string>,
      _selector: PromiseOrValue<BytesLike>,
      overrides?: CallOverrides
    ): Promise<boolean>;

    owner(overrides?: CallOverrides): Promise<string>;

    permissions(
      arg0: PromiseOrValue<string>,
      arg1: PromiseOrValue<string>,
      arg2: PromiseOrValue<BytesLike>,
      overrides?: CallOverrides
    ): Promise<boolean>;

    renounceOwnership(overrides?: CallOverrides): Promise<void>;

    setPermission(
      _caller: PromiseOrValue<string>,
      _contract: PromiseOrValue<string>,
      _selector: PromiseOrValue<BytesLike>,
      _permission: PromiseOrValue<boolean>,
      overrides?: CallOverrides
    ): Promise<void>;

    transferOwnership(
      newOwner: PromiseOrValue<string>,
      overrides?: CallOverrides
    ): Promise<void>;
  };

  filters: {
    "GrantPermission(address,address,bytes4)"(
      caller?: PromiseOrValue<string> | null,
      contractAddress?: PromiseOrValue<string> | null,
      selector?: PromiseOrValue<BytesLike> | null
    ): GrantPermissionEventFilter;
    GrantPermission(
      caller?: PromiseOrValue<string> | null,
      contractAddress?: PromiseOrValue<string> | null,
      selector?: PromiseOrValue<BytesLike> | null
    ): GrantPermissionEventFilter;

    "OwnershipTransferred(address,address)"(
      previousOwner?: PromiseOrValue<string> | null,
      newOwner?: PromiseOrValue<string> | null
    ): OwnershipTransferredEventFilter;
    OwnershipTransferred(
      previousOwner?: PromiseOrValue<string> | null,
      newOwner?: PromiseOrValue<string> | null
    ): OwnershipTransferredEventFilter;

    "RevokePermission(address,address,bytes4)"(
      caller?: PromiseOrValue<string> | null,
      contractAddress?: PromiseOrValue<string> | null,
      selector?: PromiseOrValue<BytesLike> | null
    ): RevokePermissionEventFilter;
    RevokePermission(
      caller?: PromiseOrValue<string> | null,
      contractAddress?: PromiseOrValue<string> | null,
      selector?: PromiseOrValue<BytesLike> | null
    ): RevokePermissionEventFilter;
  };

  estimateGas: {
    callContract(
      _contract: PromiseOrValue<string>,
      _data: PromiseOrValue<BytesLike>,
      _value: PromiseOrValue<BigNumberish>,
      overrides?: Overrides & { from?: PromiseOrValue<string> }
    ): Promise<BigNumber>;

    checkPermission(
      _caller: PromiseOrValue<string>,
      _contract: PromiseOrValue<string>,
      _selector: PromiseOrValue<BytesLike>,
      overrides?: CallOverrides
    ): Promise<BigNumber>;

    owner(overrides?: CallOverrides): Promise<BigNumber>;

    permissions(
      arg0: PromiseOrValue<string>,
      arg1: PromiseOrValue<string>,
      arg2: PromiseOrValue<BytesLike>,
      overrides?: CallOverrides
    ): Promise<BigNumber>;

    renounceOwnership(
      overrides?: Overrides & { from?: PromiseOrValue<string> }
    ): Promise<BigNumber>;

    setPermission(
      _caller: PromiseOrValue<string>,
      _contract: PromiseOrValue<string>,
      _selector: PromiseOrValue<BytesLike>,
      _permission: PromiseOrValue<boolean>,
      overrides?: Overrides & { from?: PromiseOrValue<string> }
    ): Promise<BigNumber>;

    transferOwnership(
      newOwner: PromiseOrValue<string>,
      overrides?: Overrides & { from?: PromiseOrValue<string> }
    ): Promise<BigNumber>;
  };

  populateTransaction: {
    callContract(
      _contract: PromiseOrValue<string>,
      _data: PromiseOrValue<BytesLike>,
      _value: PromiseOrValue<BigNumberish>,
      overrides?: Overrides & { from?: PromiseOrValue<string> }
    ): Promise<PopulatedTransaction>;

    checkPermission(
      _caller: PromiseOrValue<string>,
      _contract: PromiseOrValue<string>,
      _selector: PromiseOrValue<BytesLike>,
      overrides?: CallOverrides
    ): Promise<PopulatedTransaction>;

    owner(overrides?: CallOverrides): Promise<PopulatedTransaction>;

    permissions(
      arg0: PromiseOrValue<string>,
      arg1: PromiseOrValue<string>,
      arg2: PromiseOrValue<BytesLike>,
      overrides?: CallOverrides
    ): Promise<PopulatedTransaction>;

    renounceOwnership(
      overrides?: Overrides & { from?: PromiseOrValue<string> }
    ): Promise<PopulatedTransaction>;

    setPermission(
      _caller: PromiseOrValue<string>,
      _contract: PromiseOrValue<string>,
      _selector: PromiseOrValue<BytesLike>,
      _permission: PromiseOrValue<boolean>,
      overrides?: Overrides & { from?: PromiseOrValue<string> }
    ): Promise<PopulatedTransaction>;

    transferOwnership(
      newOwner: PromiseOrValue<string>,
      overrides?: Overrides & { from?: PromiseOrValue<string> }
    ): Promise<PopulatedTransaction>;
  };
}