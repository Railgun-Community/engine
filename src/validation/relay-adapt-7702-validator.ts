import { verifyTypedData, getBytes, keccak256, encodeRlp, toBeHex, recoverAddress, Authorization } from 'ethers';
import { TransactionStructV2 } from '../models/transaction-types';
import { RelayAdapt7702 } from '../abi/typechain/RelayAdapt7702';
import {
  RelayAdapt7702ExecutionDetails,
  getExecutePayloadHash,
} from '../transaction/relay-adapt-7702-signature';

export class RelayAdapt7702Validator {
  static validateAuthorization(
    authorization: Authorization,
    expectedContractAddress: string,
    expectedChainId: number
  ): string {
    if (authorization.address.toLowerCase() !== expectedContractAddress.toLowerCase()) {
      throw new Error('Authorization contract address mismatch');
    }
    if (authorization.chainId !== BigInt(expectedChainId)) {
      throw new Error('Authorization chain ID mismatch');
    }

    // Reconstruct payload
    const rlpEncoded = encodeRlp([
      authorization.chainId === 0n ? new Uint8Array(0) : toBeHex(authorization.chainId),
      authorization.address,
      authorization.nonce === 0n ? new Uint8Array(0) : toBeHex(authorization.nonce)
    ]);
    const payload = new Uint8Array([0x05, ...getBytes(rlpEncoded)]);
    const hash = keccak256(payload);

    // Recover address
    return recoverAddress(hash, authorization.signature);
  }

  static validateExecution(
    transactions: TransactionStructV2[],
    actionData: RelayAdapt7702.ActionDataStruct,
    signature: string,
    chainId: number,
    expectedSigner: string,
    executionDetails?: RelayAdapt7702ExecutionDetails,
  ): void {
    const domain = {
      name: 'RelayAdapt7702',
      version: '1',
      chainId,
      verifyingContract: expectedSigner,
    };

    const types = {
      Execute: [{ name: 'payloadHash', type: 'bytes32' }],
    };

    const recoveredAddress = verifyTypedData(domain, types, {
      payloadHash: getExecutePayloadHash(transactions, actionData, executionDetails),
    }, signature);

    if (recoveredAddress.toLowerCase() !== expectedSigner.toLowerCase()) {
      throw new Error('Execution signature signer mismatch');
    }
  }
}
