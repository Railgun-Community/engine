import { HDNodeWallet, Wallet, AbiCoder, keccak256, getBytes } from 'ethers';
import { TransactionStructV2 } from '../models/transaction-types';
import { RelayAdapt7702__factory } from '../abi/typechain/factories/RelayAdapt7702__factory';
import { RelayAdapt7702 } from '../abi/typechain/RelayAdapt7702';

const iface = RelayAdapt7702__factory.createInterface();
// const executeFunc = iface.getFunction('execute');
const executeFunc = iface.getFunction(
  'execute((((uint256,uint256),(uint256[2],uint256[2]),(uint256,uint256)),bytes32,bytes32[],bytes32[],(uint16,uint72,uint8,uint64,address,bytes32,(bytes32[4],bytes32,bytes32,bytes,bytes)[]),(bytes32,(uint8,address,uint256),uint120))[],(bytes31,bool,uint256,(address,bytes,uint256)[]),bytes)',
);
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

/**
 * Signs the execution payload for RelayAdapt7702.
 * Payload: keccak256(abi.encode(chainId, transactions, actionData))
 * Signed as EIP-191 message.
 * @param signer - The ephemeral key signer
 * @param transactions - Railgun transactions
 * @param actionData - Action data
 * @param chainId - Chain ID
 * @returns Signature string
 */
export const signExecutionAuthorization = async (
  signer: HDNodeWallet | Wallet,
  transactions: TransactionStructV2[],
  actionData: RelayAdapt7702.ActionDataStruct,
  chainId: number
): Promise<string> => {
  const abiCoder = AbiCoder.defaultAbiCoder();
  
  const encoded = abiCoder.encode(
    ['uint256', `${TRANSACTION_STRUCT_ABI}[]`, ACTION_DATA_STRUCT_ABI],
    [chainId, transactions, actionData]
  );

  const hash = keccak256(encoded);
  
  // Sign with EIP-191 prefix (signMessage does this automatically)
  // We pass bytes to ensure it's treated as binary hash, not string
  return signer.signMessage(getBytes(hash));
};
