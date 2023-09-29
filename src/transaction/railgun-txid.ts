import { poseidon } from 'circomlibjs';
import { RailgunTransaction, RailgunTransactionWithTxid, TXIDVersion } from '../models';
import { ByteLength, hexToBigInt, nToHex } from '../utils/bytes';
import { MERKLE_ZERO_VALUE_BIGINT } from '../models/merkletree-types';

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
  const maxInputs = 13; // Always 13 - no matter the POI circuit
  const nullifiersPadded = padWithZerosToMax(
    railgunTransaction.nullifiers.map((el) => hexToBigInt(el)),
    maxInputs,
  );
  const nullifiersHash = poseidon(nullifiersPadded);

  const maxOutputs = 13; // Always 13 - no matter the POI circuit
  const commitmentsPadded = padWithZerosToMax(
    railgunTransaction.commitments.map((el) => hexToBigInt(el)),
    maxOutputs,
  );
  const commitmentsHash = poseidon(commitmentsPadded);

  const boundParamsHash = hexToBigInt(railgunTransaction.boundParamsHash);

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

export const createRailgunTransactionWithID = (
  railgunTransaction: RailgunTransaction,
  txidVersion: TXIDVersion,
): RailgunTransactionWithTxid => {
  const txidHex = getRailgunTransactionIDHex(railgunTransaction);
  return {
    ...railgunTransaction,
    hash: txidHex,
    txidVersion,
  };
};
