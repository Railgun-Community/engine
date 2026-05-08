import { HDNodeWallet, Wallet, AbiCoder, keccak256 } from 'ethers';
import { TransactionStructV2, TransactionStructV3 } from '../models/transaction-types';
import { RelayAdapt7702__factory } from '../abi/typechain/factories/RelayAdapt7702__factory';
import { RelayAdapt7702 } from '../abi/typechain/RelayAdapt7702';

const iface = RelayAdapt7702__factory.createInterface();
const executeFunc = iface.getFunction('execute');
if (!executeFunc) {
  throw new Error('RelayAdapt7702: execute function not found in ABI');
}

// inputs[0] is Transaction[]
const transactionArrayType = executeFunc.inputs[0];
if (transactionArrayType.type !== 'tuple[]' || !transactionArrayType.arrayChildren) {
  throw new Error('RelayAdapt7702: execute input[0] is not Transaction[]');
}
export const TRANSACTION_STRUCT_ABI = transactionArrayType.arrayChildren.format('full');

// inputs[1] is ActionData
const actionDataType = executeFunc.inputs[1];
if (actionDataType.type !== 'tuple') {
  throw new Error('RelayAdapt7702: execute input[1] is not ActionData');
}
export const ACTION_DATA_STRUCT_ABI = actionDataType.format('full');

export const ZERO_7702_ADAPT_PARAMS = '0x0000000000000000000000000000000000000000000000000000000000000000';

export const getExecutePayloadHash = (
  transactions: (TransactionStructV2 | TransactionStructV3)[],
  actionData: RelayAdapt7702.ActionDataStruct,
): string => {
  const abiCoder = AbiCoder.defaultAbiCoder();
  const encoded = abiCoder.encode(
    [`${TRANSACTION_STRUCT_ABI}[]`, ACTION_DATA_STRUCT_ABI],
    [transactions, actionData],
  );

  return keccak256(encoded);
};

/**
 * Signs the execution payload for RelayAdapt7702.
 * Payload: keccak256(abi.encode(transactions, actionData))
 * Signed as EIP-712 typed data using the ephemeral address as verifyingContract.
 * @param signer - The ephemeral key signer
 * @param transactions - Railgun transactions
 * @param actionData - Action data
 * @param chainId - Chain ID
 * @returns Signature string
 */
export const signExecutionAuthorization = async (
  signer: HDNodeWallet | Wallet,
  transactions: (TransactionStructV2 | TransactionStructV3)[],
  actionData: RelayAdapt7702.ActionDataStruct,
  chainId: number
): Promise<string> => {
  const domain = {
    name: 'RelayAdapt7702',
    version: '1',
    chainId,
    verifyingContract: signer.address,
  };

  const types = {
    Execute: [{ name: 'payloadHash', type: 'bytes32' }],
  };

  return signer.signTypedData(domain, types, {
    payloadHash: getExecutePayloadHash(transactions, actionData),
  });
};
