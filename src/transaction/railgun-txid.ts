import { poseidon } from 'circomlibjs';
import { RailgunTransaction, RailgunTransactionWithTxid } from '../models';
import { hexToBigInt } from '../utils';

export const getRailgunTransactionID = (railgunTransaction: RailgunTransaction): bigint => {
  const commitmentsHash = poseidon(railgunTransaction.commitments.map((el) => hexToBigInt(el)));
  const nullifiersHash = poseidon(railgunTransaction.nullifiers.map((el) => hexToBigInt(el)));
  const boundParamsHash = hexToBigInt(railgunTransaction.boundParamsHash);

  return poseidon([commitmentsHash, nullifiersHash, boundParamsHash]);
};

export const createRailgunTransactionWithID = (
  railgunTransaction: RailgunTransaction,
): RailgunTransactionWithTxid => {
  const txid = getRailgunTransactionID(railgunTransaction);
  return {
    ...railgunTransaction,
    hash: txid.toString(),
  };
};
