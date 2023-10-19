import { poseidon } from 'circomlibjs';
import { RailgunTransaction, RailgunTransactionWithHash, TXIDVersion } from '../models';
import {
  ByteLength,
  combine,
  formatToByteLength,
  hexToBigInt,
  hexToBytes,
  nToHex,
} from '../utils/bytes';
import { MERKLE_ZERO_VALUE_BIGINT } from '../models/merkletree-types';
import { getGlobalTreePosition } from '../poi/global-tree-position';
import { ZERO_32_BYTE_VALUE, keccak256 } from '../utils';

const padWithZerosToMax = (array: bigint[], max: number): bigint[] => {
  const padded = [...array];
  while (padded.length < max) {
    padded.push(MERKLE_ZERO_VALUE_BIGINT);
  }
  return padded;
};

export const getRailgunTransactionID = (railgunTransaction: {
  nullifiers: string[];
  commitments: string[];
  boundParamsHash: string;
}): bigint => {
  const nullifierBigInts = railgunTransaction.nullifiers.map((el) => hexToBigInt(el));
  const commitmentBigInts = railgunTransaction.commitments.map((el) => hexToBigInt(el));
  const boundParamsHashBigInt = hexToBigInt(railgunTransaction.boundParamsHash);
  return getRailgunTransactionIDFromBigInts(
    nullifierBigInts,
    commitmentBigInts,
    boundParamsHashBigInt,
  );
};

export const getRailgunTransactionIDFromBigInts = (
  nullifiers: bigint[],
  commitments: bigint[],
  boundParamsHash: bigint,
): bigint => {
  const maxInputs = 13; // Always 13 - no matter the POI circuit
  const nullifiersPadded = padWithZerosToMax(nullifiers, maxInputs);
  const nullifiersHash = poseidon(nullifiersPadded);

  const maxOutputs = 13; // Always 13 - no matter the POI circuit
  const commitmentsPadded = padWithZerosToMax(commitments, maxOutputs);
  const commitmentsHash = poseidon(commitmentsPadded);

  return poseidon([nullifiersHash, commitmentsHash, boundParamsHash]);
};

export const getRailgunTransactionIDHex = (railgunTransaction: {
  nullifiers: string[];
  commitments: string[];
  boundParamsHash: string;
}): string => {
  const railgunTxid = getRailgunTransactionID(railgunTransaction);
  return nToHex(railgunTxid, ByteLength.UINT_256);
};

export const getRailgunTxidLeafHash = (
  railgunTxidBigInt: bigint,
  utxoTreeIn: bigint,
  globalTreePosition: bigint,
  txidVersion: TXIDVersion,
): string => {
  switch (txidVersion) {
    case TXIDVersion.V2_PoseidonMerkle: {
      return nToHex(
        poseidon([railgunTxidBigInt, utxoTreeIn, globalTreePosition]),
        ByteLength.UINT_256,
      );
    }
  }
  throw new Error('TXID Version not recognized');
};

export const createRailgunTransactionWithHash = (
  railgunTransaction: RailgunTransaction,
  txidVersion: TXIDVersion,
): RailgunTransactionWithHash => {
  const railgunTxidBigInt = getRailgunTransactionID(railgunTransaction);
  const { utxoTreeIn, utxoTreeOut, utxoBatchStartPositionOut } = railgunTransaction;
  const globalTreePosition = getGlobalTreePosition(utxoTreeOut, utxoBatchStartPositionOut);
  return {
    ...railgunTransaction,
    railgunTxid: nToHex(railgunTxidBigInt, ByteLength.UINT_256),
    hash: getRailgunTxidLeafHash(
      railgunTxidBigInt,
      BigInt(utxoTreeIn),
      globalTreePosition,
      txidVersion,
    ),
  };
};

export const calculateRailgunTransactionVerificationHash = (
  previousVerificationHash: Optional<string>,
  firstNullifier: string,
): string => {
  // hash[n] = keccak(hash[n-1] ?? 0, n_firstNullifier);

  const combinedData: string = combine([
    hexToBytes(previousVerificationHash ?? '0x'),
    hexToBytes(firstNullifier),
  ]);
  return formatToByteLength(keccak256(combinedData), ByteLength.UINT_256, true);
};
