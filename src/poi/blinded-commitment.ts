import { poseidon } from 'circomlibjs';
import { LegacyEncryptedCommitment, TransactCommitment } from '../models/formatted-types';
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

export const getBlindedCommitmentForTransact = (
  commitment: TransactCommitment | LegacyEncryptedCommitment,
  npk: bigint,
  railgunTxid: string,
): string => {
  const hash: bigint = poseidon([hexToBigInt(commitment.hash), npk, hexToBigInt(railgunTxid)]);
  return formatHash(hash);
};

export const getBlindedCommitmentForShield = (
  commitmentHash: string,
  npk: bigint,
  globalTreePosition: string,
) => {
  const hash: bigint = poseidon([
    hexToBigInt(commitmentHash),
    npk,
    hexToBigInt(globalTreePosition),
  ]);
  return formatHash(hash);
};
