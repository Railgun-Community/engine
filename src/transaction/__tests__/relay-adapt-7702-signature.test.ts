import { expect } from 'chai';
import { AbiCoder, Wallet, keccak256, verifyTypedData } from 'ethers';
import {
  ACTION_DATA_STRUCT_ABI,
  RelayAdapt7702ExecutionType,
  TRANSACTION_STRUCT_ABI,
  getExecutePayloadHash,
  signExecutionAuthorization,
} from '../relay-adapt-7702-signature';
import { TransactionStructV2 } from '../../models/transaction-types';
import { RelayAdapt7702 } from '../../abi/typechain/RelayAdapt7702';
import { TXIDVersion } from '../../models/poi-types';

describe('RelayAdapt7702 Execution Signature', () => {
  it('should sign and recover correctly', async () => {
    const signer = Wallet.createRandom();
    const chainId = 1;

    const mockTransaction: TransactionStructV2 = {
      txidVersion: TXIDVersion.V2_PoseidonMerkle,
      proof: {
        a: { x: 1n, y: 2n },
        b: { x: [3n, 4n], y: [5n, 6n] },
        c: { x: 7n, y: 8n },
      },
      merkleRoot: '0x' + '0'.repeat(64),
      nullifiers: ['0x' + '0'.repeat(64)],
      commitments: ['0x' + '0'.repeat(64)],
      boundParams: {
        treeNumber: 0,
        minGasPrice: 0n,
        unshield: 0,
        chainID: 1n,
        adaptContract: '0x' + '0'.repeat(40),
        adaptParams: '0x' + '0'.repeat(64),
        commitmentCiphertext: [],
      },
      unshieldPreimage: {
        npk: '0x' + '0'.repeat(64),
        token: {
          tokenType: 0,
          tokenAddress: '0x' + '0'.repeat(40),
          tokenSubID: 0n,
        },
        value: 0n,
      },
    };

    const mockActionData: RelayAdapt7702.ActionDataStruct = {
      requireSuccess: true,
      minGasLimit: 100000n,
      calls: [],
    };

    const executionDetails = {
      executionType: RelayAdapt7702ExecutionType.ExecuteWithNonce,
      executeNonce: 2n,
    };
    const signature = await signExecutionAuthorization(
      signer,
      [mockTransaction],
      mockActionData,
      chainId,
      executionDetails,
    );

    const recovered = verifyTypedData(
      {
        name: 'RelayAdapt7702',
        version: '1',
        chainId,
        verifyingContract: signer.address,
      },
      {
        Execute: [{ name: 'payloadHash', type: 'bytes32' }],
      },
      {
        payloadHash: getExecutePayloadHash([mockTransaction], mockActionData, executionDetails),
      },
      signature,
    );

    expect(recovered).to.equal(signer.address);
  });

  it('should encode current and legacy payload hashes explicitly', () => {
    const mockActionData: RelayAdapt7702.ActionDataStruct = {
      requireSuccess: true,
      minGasLimit: 100000n,
      calls: [],
    };
    const transactions: TransactionStructV2[] = [];
    const abiCoder = AbiCoder.defaultAbiCoder();
    const executeNonce = 2n;

    const legacyHash = getExecutePayloadHash(transactions, mockActionData, {
      executionType: RelayAdapt7702ExecutionType.LegacyPreExecuteNonce,
    });
    const currentHash = getExecutePayloadHash(transactions, mockActionData, {
      executionType: RelayAdapt7702ExecutionType.ExecuteWithNonce,
      executeNonce,
    });

    expect(legacyHash).to.equal(keccak256(abiCoder.encode(
      [`${TRANSACTION_STRUCT_ABI}[]`, ACTION_DATA_STRUCT_ABI],
      [transactions, mockActionData],
    )));
    expect(currentHash).to.equal(keccak256(abiCoder.encode(
      [`${TRANSACTION_STRUCT_ABI}[]`, ACTION_DATA_STRUCT_ABI, 'uint256'],
      [transactions, mockActionData, executeNonce],
    )));
    expect(currentHash).to.not.equal(legacyHash);
  });
});
