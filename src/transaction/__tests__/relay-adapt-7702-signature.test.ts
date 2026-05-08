import { expect } from 'chai';
import { Wallet, verifyTypedData } from 'ethers';
import { getExecutePayloadHash, signExecutionAuthorization } from '../relay-adapt-7702-signature';
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

    const signature = await signExecutionAuthorization(signer, [mockTransaction], mockActionData, chainId);

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
        payloadHash: getExecutePayloadHash([mockTransaction], mockActionData),
      },
      signature,
    );

    expect(recovered).to.equal(signer.address);
  });
});
