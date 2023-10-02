import { poseidon } from 'circomlibjs';
import { RailgunTransaction, RailgunTransactionWithHash, TXIDVersion } from '../models';
import { ByteLength, hexToBigInt, nToHex } from '../utils/bytes';
import { MERKLE_ZERO_VALUE_BIGINT } from '../models/merkletree-types';
import { getGlobalTreePosition } from '../poi/global-tree-position';

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

export const getRailgunTxidLeafHash = (
  railgunTxidBigInt: bigint,
  railgunTransaction: RailgunTransaction,
  txidVersion: TXIDVersion,
): string => {
  switch (txidVersion) {
    case TXIDVersion.V2_PoseidonMerkle: {
      const { utxoTreeIn, utxoTreeOut, utxoBatchStartPositionOut } = railgunTransaction;
      const globalTreePosition = getGlobalTreePosition(utxoTreeOut, utxoBatchStartPositionOut);
      return nToHex(
        poseidon([railgunTxidBigInt, BigInt(utxoTreeIn), BigInt(globalTreePosition)]),
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
  return {
    ...railgunTransaction,
    railgunTxid: nToHex(railgunTxidBigInt, ByteLength.UINT_256),
    hash: getRailgunTxidLeafHash(railgunTxidBigInt, railgunTransaction, txidVersion),
  };
};
