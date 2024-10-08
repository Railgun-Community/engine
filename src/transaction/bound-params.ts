import { AbiCoder } from 'ethers';
import { BoundParamsStruct } from '../abi/typechain/RailgunSmartWallet';
import { ByteUtils } from '../utils';
import { PoseidonMerkleVerifier } from '../abi/typechain';
import { SNARK_PRIME } from '../utils/constants';
import { keccak256 } from '../utils/hash';

const abiCoder = AbiCoder.defaultAbiCoder();

export const hashBoundParamsV2 = (boundParams: BoundParamsStruct) => {
  const hashed = keccak256(
    abiCoder.encode(
      [
        'tuple(uint16 treeNumber, uint48 minGasPrice, uint8 unshield, uint64 chainID, address adaptContract, bytes32 adaptParams, tuple(bytes32[4] ciphertext, bytes32 blindedSenderViewingKey, bytes32 blindedReceiverViewingKey, bytes annotationData, bytes memo)[] commitmentCiphertext) boundParams',
      ],
      [boundParams],
    ),
  );

  return ByteUtils.hexToBigInt(hashed) % SNARK_PRIME;
};

export const hashBoundParamsV3 = (boundParams: PoseidonMerkleVerifier.BoundParamsStruct) => {
  const hashed = keccak256(
    abiCoder.encode(
      [
        'tuple(tuple(uint32 treeNumber, tuple(bytes ciphertext, bytes32 blindedSenderViewingKey, bytes32 blindedReceiverViewingKey)[] commitmentCiphertext) local, tuple(uint128 minGasPrice, uint128 chainID, bytes senderCiphertext, address to, bytes data) global)',
      ],
      [boundParams],
    ),
  );

  return ByteUtils.hexToBigInt(hashed) % SNARK_PRIME;
};
