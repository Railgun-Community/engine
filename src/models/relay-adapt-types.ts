import { Authorization } from 'ethers';
import { TransactionStructV2 } from './transaction-types';
import { RelayAdapt } from '../abi/typechain/RelayAdapt';

export interface RelayAdapt7702Request {
  transactions: TransactionStructV2[];
  actionData: RelayAdapt.ActionDataStruct;
  authorization: Authorization;
  executionSignature: string;
  ephemeralAddress: string;
}
