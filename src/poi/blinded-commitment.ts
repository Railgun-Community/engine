import { poseidon } from 'circomlibjs';
import { ByteLength, formatToByteLength, hexToBigInt, nToHex } from '../utils/bytes';

const formatHash = (hash: bigint): string => {
  return `0x${nToHex(hash, ByteLength.UINT_256)}`;
};

export const getBlindedCommitmentForUnshield = (railgunTxid: string) => {
  return formatToByteLength(railgunTxid, ByteLength.UINT_256, true);
};

export const getBlindedCommitmentForShieldOrTransact = (
  commitmentHash: string,
  npk: bigint,
  globalTreePosition: bigint,
) => {
  const hash: bigint = poseidon([hexToBigInt(commitmentHash), npk, globalTreePosition]);
  return formatHash(hash);
};
