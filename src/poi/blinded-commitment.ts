import { poseidon } from 'circomlibjs';
import { ByteLength, hexToBigInt, nToHex } from '../utils/bytes';

const formatHash = (hash: bigint): string => {
  return `0x${nToHex(hash, ByteLength.UINT_256)}`;
};

export const getBlindedCommitmentForUnshield = (
  commitmentHash: string,
  toAddress: string,
  railgunTxid: string,
) => {
  const hash: bigint = poseidon(
    [commitmentHash, toAddress, railgunTxid].map((x) => hexToBigInt(x)),
  );
  return formatHash(hash);
};

export const getBlindedCommitmentForShieldOrTransact = (
  commitmentHash: string,
  npk: bigint,
  globalTreePosition: bigint,
) => {
  const hash: bigint = poseidon([hexToBigInt(commitmentHash), npk, globalTreePosition]);
  return formatHash(hash);
};
