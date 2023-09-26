import { poseidon } from 'circomlibjs';
import { RailgunTransaction, RailgunTransactionWithTxid } from '../models';
import { ByteLength, hexToBigInt, nToHex } from '../utils/bytes';
import { MERKLE_ZERO_VALUE_BIGINT } from '../models/merkletree-types';

const padWithZerosToMax = (array: bigint[], max: number): bigint[] => {
  const padded = [...array];
  while (padded.length < max) {
    padded.push(MERKLE_ZERO_VALUE_BIGINT);
  }
  return padded;
};

export const getRailgunTransactionID = (railgunTransaction: RailgunTransaction): bigint => {
  const maxInputs = 13;
  const nullifiersPadded = padWithZerosToMax(
    railgunTransaction.nullifiers.map((el) => hexToBigInt(el)),
    maxInputs,
  );
  const nullifiersHash = poseidon(nullifiersPadded);

  const maxOutputs = 13;
  const commitmentsPadded = padWithZerosToMax(
    railgunTransaction.commitments.map((el) => hexToBigInt(el)),
    maxOutputs,
  );
  const commitmentsHash = poseidon(commitmentsPadded);

  const boundParamsHash = hexToBigInt(railgunTransaction.boundParamsHash);

  const railgunTxid = poseidon([nullifiersHash, commitmentsHash, boundParamsHash]);
  return railgunTxid;
};

export const createRailgunTransactionWithID = (
  railgunTransaction: RailgunTransaction,
): RailgunTransactionWithTxid => {
  const txid = getRailgunTransactionID(railgunTransaction);
  return {
    ...railgunTransaction,
    hash: nToHex(txid, ByteLength.UINT_256),
  };
};
