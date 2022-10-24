import { defaultAbiCoder } from '@ethersproject/abi';
import { BoundParamsStruct } from '../typechain-types/contracts/logic/RailgunSmartWallet';
import { keccak256, hexToBigInt, SNARK_PRIME_BIGINT } from '../utils';

const abiCoder = defaultAbiCoder;

export function hashBoundParams(boundParams: BoundParamsStruct) {
  const hashed = keccak256(
    abiCoder.encode(
      [
        'tuple(uint16 treeNumber, uint48 minGasPrice, uint8 unshield, address adaptContract, bytes32 adaptParams, tuple(bytes32[4] ciphertext, bytes32 blindedSenderViewingKey, bytes32 blindedReceiverViewingKey, bytes annotationData, bytes memo)[] commitmentCiphertext) boundParams',
      ],
      [boundParams],
    ),
  );

  return hexToBigInt(hashed) % SNARK_PRIME_BIGINT;
}
