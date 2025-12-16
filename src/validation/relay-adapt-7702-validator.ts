import { verifyMessage, getBytes, keccak256, AbiCoder, encodeRlp, toBeHex, recoverAddress } from 'ethers';
import { TransactionStructV2 } from '../models/transaction-types';
import { RelayAdapt7702 } from '../abi/typechain/RelayAdapt7702';
import { EIP7702Authorization } from '../models/relay-adapt-types';
import { ACTION_DATA_STRUCT_ABI, TRANSACTION_STRUCT_ABI } from '../transaction/relay-adapt-7702-signature';

export class RelayAdapt7702Validator {
  static validateAuthorization(
    authorization: EIP7702Authorization,
    expectedContractAddress: string,
    expectedChainId: number
  ): string {
    if (authorization.address.toLowerCase() !== expectedContractAddress.toLowerCase()) {
      throw new Error('Authorization contract address mismatch');
    }
    if (BigInt(authorization.chainId) !== BigInt(expectedChainId)) {
      throw new Error('Authorization chain ID mismatch');
    }

    // Reconstruct payload
    const rlpEncoded = encodeRlp([
      authorization.chainId === '0' ? new Uint8Array(0) : toBeHex(BigInt(authorization.chainId)),
      authorization.address,
      authorization.nonce === 0 ? new Uint8Array(0) : toBeHex(authorization.nonce)
    ]);
    const payload = new Uint8Array([0x05, ...getBytes(rlpEncoded)]);
    const hash = keccak256(payload);

    // Recover address
    return recoverAddress(hash, {
      r: authorization.r,
      s: authorization.s,
      yParity: authorization.yParity
    });
  }

  static validateExecution(
    transactions: TransactionStructV2[],
    actionData: RelayAdapt7702.ActionDataStruct,
    signature: string,
    chainId: number,
    expectedSigner: string
  ): void {
    // Reconstruct hash
    const abiCoder = AbiCoder.defaultAbiCoder();
    const encoded = abiCoder.encode(
      ['uint256', `${TRANSACTION_STRUCT_ABI}[]`, ACTION_DATA_STRUCT_ABI],
      [chainId, transactions, actionData]
    );
    const hash = keccak256(encoded);

    // Recover signer
    const recoveredAddress = verifyMessage(getBytes(hash), signature);

    if (recoveredAddress.toLowerCase() !== expectedSigner.toLowerCase()) {
      throw new Error('Execution signature signer mismatch');
    }
  }
}
