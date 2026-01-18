import { expect } from 'chai';
import { Wallet, verifyMessage, AbiCoder, keccak256, getBytes } from 'ethers';
import { signExecutionAuthorization } from '../relay-adapt-7702-signature';
import { TransactionStructV2 } from '../../models/transaction-types';
import { RelayAdapt } from '../../abi/typechain/RelayAdapt';
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

    const mockActionData: RelayAdapt.ActionDataStruct = {
      random: '0x' + '0'.repeat(62),
      requireSuccess: true,
      minGasLimit: 100000n,
      calls: [],
    };

    const signature = await signExecutionAuthorization(signer, [mockTransaction], mockActionData, chainId);

    const TRANSACTION_STRUCT_ABI = `tuple(
      tuple(
        tuple(uint256 x, uint256 y) a,
        tuple(uint256[2] x, uint256[2] y) b,
        tuple(uint256 x, uint256 y) c
      ) proof,
      bytes32 merkleRoot,
      bytes32[] nullifiers,
      bytes32[] commitments,
      tuple(
        uint16 treeNumber,
        uint72 minGasPrice,
        uint8 unshield,
        uint64 chainID,
        address adaptContract,
        bytes32 adaptParams,
        tuple(
          bytes32[4] ciphertext,
          bytes32 blindedSenderViewingKey,
          bytes32 blindedReceiverViewingKey,
          bytes annotationData,
          bytes memo
        )[] commitmentCiphertext
      ) boundParams,
      tuple(
        bytes32 npk,
        tuple(
          uint8 tokenType,
          address tokenAddress,
          uint256 tokenSubID
        ) token,
        uint120 value
      ) unshieldPreimage
    )`;

    const ACTION_DATA_STRUCT_ABI = `tuple(
      bytes31 random,
      bool requireSuccess,
      uint256 minGasLimit,
      tuple(
        address to,
        bytes data,
        uint256 value
      )[] calls
    )`;
    
    const abiCoder = AbiCoder.defaultAbiCoder();
    const encoded = abiCoder.encode(
        ['uint256', `${TRANSACTION_STRUCT_ABI}[]`, ACTION_DATA_STRUCT_ABI],
        [chainId, [mockTransaction], mockActionData]
    );
    const hash = keccak256(encoded);
    
    const recovered = verifyMessage(getBytes(hash), signature);
    expect(recovered).to.equal(signer.address);
  });
});
