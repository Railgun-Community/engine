/* Autogenerated file. Do not edit manually. */
/* tslint:disable */
/* eslint-disable */
import { Signer, utils, Contract, ContractFactory, Overrides } from "ethers";
import type { Provider, TransactionRequest } from "@ethersproject/providers";
import type { PromiseOrValue } from "../../../common";
import type {
  Distributor,
  DistributorInterface,
} from "../../../contracts/token/Distributor";

const _abi = [
  {
    inputs: [
      {
        internalType: "address",
        name: "_admin",
        type: "address",
      },
      {
        internalType: "address",
        name: "_staking",
        type: "address",
      },
      {
        internalType: "address",
        name: "_vestLockImplementation",
        type: "address",
      },
    ],
    stateMutability: "nonpayable",
    type: "constructor",
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "address",
        name: "previousOwner",
        type: "address",
      },
      {
        indexed: true,
        internalType: "address",
        name: "newOwner",
        type: "address",
      },
    ],
    name: "OwnershipTransferred",
    type: "event",
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "_beneficiary",
        type: "address",
      },
      {
        internalType: "uint256",
        name: "_releaseTime",
        type: "uint256",
      },
    ],
    name: "createVestLock",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [],
    name: "owner",
    outputs: [
      {
        internalType: "address",
        name: "",
        type: "address",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "renounceOwnership",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [],
    name: "staking",
    outputs: [
      {
        internalType: "contract Staking",
        name: "",
        type: "address",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "newOwner",
        type: "address",
      },
    ],
    name: "transferOwnership",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [],
    name: "vestLockImplementation",
    outputs: [
      {
        internalType: "address",
        name: "",
        type: "address",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "",
        type: "address",
      },
    ],
    name: "vestLocks",
    outputs: [
      {
        internalType: "contract VestLock",
        name: "",
        type: "address",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
];

const _bytecode =
  "0x608060405234801561001057600080fd5b5060405161071138038061071183398101604081905261002f916101c3565b6100383361007d565b61004b836100cd60201b6102511760201c565b600280546001600160a01b039384166001600160a01b0319918216179091556001805492909316911617905550610206565b600080546001600160a01b038381166001600160a01b0319831681178455604051919092169283917f8be0079c531659141344cd1fd0a4f28419497f9722a3daafe3b4186f6b6457e09190a35050565b6100d561014b565b6001600160a01b03811661013f5760405162461bcd60e51b815260206004820152602660248201527f4f776e61626c653a206e6577206f776e657220697320746865207a65726f206160448201526564647265737360d01b60648201526084015b60405180910390fd5b6101488161007d565b50565b6000546001600160a01b031633146101a55760405162461bcd60e51b815260206004820181905260248201527f4f776e61626c653a2063616c6c6572206973206e6f7420746865206f776e65726044820152606401610136565b565b80516001600160a01b03811681146101be57600080fd5b919050565b6000806000606084860312156101d857600080fd5b6101e1846101a7565b92506101ef602085016101a7565b91506101fd604085016101a7565b90509250925092565b6104fc806102156000396000f3fe608060405234801561001057600080fd5b506004361061007d5760003560e01c8063715018a61161005b578063715018a6146100ed5780638276be78146100f75780638da5cb5b1461010a578063f2fde38b1461011b57600080fd5b8063030b1435146100825780634801012a146100b15780634cf088d9146100da575b600080fd5b600154610095906001600160a01b031681565b6040516001600160a01b03909116815260200160405180910390f35b6100956100bf36600461047a565b6003602052600090815260409020546001600160a01b031681565b600254610095906001600160a01b031681565b6100f561012e565b005b6100f561010536600461049c565b610142565b6000546001600160a01b0316610095565b6100f561012936600461047a565b610251565b6101366102e6565b6101406000610340565b565b61014a6102e6565b600154600090610162906001600160a01b03166103a8565b6001600160a01b03808516600090815260036020526040902080549183167fffffffffffffffffffffffff00000000000000000000000000000000000000009092168217905590915063cf756fdf6101c26000546001600160a01b031690565b60025460405160e084901b7fffffffff000000000000000000000000000000000000000000000000000000001681526001600160a01b03928316600482015282881660248201529116604482015260648101859052608401600060405180830381600087803b15801561023457600080fd5b505af1158015610248573d6000803e3d6000fd5b50505050505050565b6102596102e6565b6001600160a01b0381166102da5760405162461bcd60e51b815260206004820152602660248201527f4f776e61626c653a206e6577206f776e657220697320746865207a65726f206160448201527f646472657373000000000000000000000000000000000000000000000000000060648201526084015b60405180910390fd5b6102e381610340565b50565b6000546001600160a01b031633146101405760405162461bcd60e51b815260206004820181905260248201527f4f776e61626c653a2063616c6c6572206973206e6f7420746865206f776e657260448201526064016102d1565b600080546001600160a01b038381167fffffffffffffffffffffffff0000000000000000000000000000000000000000831681178455604051919092169283917f8be0079c531659141344cd1fd0a4f28419497f9722a3daafe3b4186f6b6457e09190a35050565b60006040517f3d602d80600a3d3981f3363d3d373d3d3d363d7300000000000000000000000081528260601b60148201527f5af43d82803e903d91602b57fd5bf3000000000000000000000000000000000060288201526037816000f09150506001600160a01b03811661045e5760405162461bcd60e51b815260206004820152601660248201527f455243313136373a20637265617465206661696c65640000000000000000000060448201526064016102d1565b919050565b80356001600160a01b038116811461045e57600080fd5b60006020828403121561048c57600080fd5b61049582610463565b9392505050565b600080604083850312156104af57600080fd5b6104b883610463565b94602093909301359350505056fea2646970667358221220791758dc3a76bd099a1ed89fce5ff33c1aabafc9c313f6d0def3884b7b52b8cc64736f6c634300080c0033";

type DistributorConstructorParams =
  | [signer?: Signer]
  | ConstructorParameters<typeof ContractFactory>;

const isSuperArgs = (
  xs: DistributorConstructorParams
): xs is ConstructorParameters<typeof ContractFactory> => xs.length > 1;

export class Distributor__factory extends ContractFactory {
  constructor(...args: DistributorConstructorParams) {
    if (isSuperArgs(args)) {
      super(...args);
    } else {
      super(_abi, _bytecode, args[0]);
    }
  }

  override deploy(
    _admin: PromiseOrValue<string>,
    _staking: PromiseOrValue<string>,
    _vestLockImplementation: PromiseOrValue<string>,
    overrides?: Overrides & { from?: PromiseOrValue<string> }
  ): Promise<Distributor> {
    return super.deploy(
      _admin,
      _staking,
      _vestLockImplementation,
      overrides || {}
    ) as Promise<Distributor>;
  }
  override getDeployTransaction(
    _admin: PromiseOrValue<string>,
    _staking: PromiseOrValue<string>,
    _vestLockImplementation: PromiseOrValue<string>,
    overrides?: Overrides & { from?: PromiseOrValue<string> }
  ): TransactionRequest {
    return super.getDeployTransaction(
      _admin,
      _staking,
      _vestLockImplementation,
      overrides || {}
    );
  }
  override attach(address: string): Distributor {
    return super.attach(address) as Distributor;
  }
  override connect(signer: Signer): Distributor__factory {
    return super.connect(signer) as Distributor__factory;
  }

  static readonly bytecode = _bytecode;
  static readonly abi = _abi;
  static createInterface(): DistributorInterface {
    return new utils.Interface(_abi) as DistributorInterface;
  }
  static connect(
    address: string,
    signerOrProvider: Signer | Provider
  ): Distributor {
    return new Contract(address, _abi, signerOrProvider) as Distributor;
  }
}