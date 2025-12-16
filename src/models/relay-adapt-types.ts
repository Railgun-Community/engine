import { TransactionStructV2 } from './transaction-types';
import { RelayAdapt } from '../abi/typechain/RelayAdapt';

export interface EIP7702Authorization {
  chainId: string;
  address: string;
  nonce: number;
  yParity: 0 | 1;
  r: string;
  s: string;
}

export interface RelayAdapt7702Request {
  transactions: TransactionStructV2[];
  actionData: RelayAdapt.ActionDataStruct;
  authorization: EIP7702Authorization;
  executionSignature: string;
  ephemeralAddress: string;
}
