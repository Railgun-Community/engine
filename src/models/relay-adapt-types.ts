import { Authorization } from 'ethers';
import { TransactionStructV2 } from './transaction-types';
import { RelayAdapt7702 } from '../abi/typechain/RelayAdapt7702';

export interface RelayAdapt7702Request {
  transactions: TransactionStructV2[];
  actionData: RelayAdapt7702.ActionDataStruct;
  authorization: Authorization;
  executionSignature: string;
  ephemeralAddress: string;
}
