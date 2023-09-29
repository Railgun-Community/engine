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

export const getRailgunTransactionIDHexV2 = (railgunTransaction: {
  nullifiers: string[];
  commitments: string[];
  boundParamsHash: string;
}): string => {
  const railgunTxid = getRailgunTransactionID(railgunTransaction);
  return nToHex(railgunTxid, ByteLength.UINT_256);
};

export const getRailgunTxidLeafHash = (
  railgunTransaction: RailgunTransaction,
  txidVersion: TXIDVersion,
): string => {
  const railgunTxidBigInt = getRailgunTransactionID(railgunTransaction);
  switch (txidVersion) {
    case TXIDVersion.V2_PoseidonMerkle:
      return nToHex(railgunTxidBigInt, ByteLength.UINT_256);
    // case TXIDVersion.V3_PoseidonMerkle: {
    //   const { utxoTreeIn, globalStartPositionOut } = railgunTransaction;
    //   if (!isDefined(utxoTreeIn) || !isDefined(globalStartPositionOut)) {
    //     throw new Error('V3 merkle railgun txids require utxoTreeIn and globalStartPositionOut');
    //   }
    //   return nToHex(
    //     poseidon([railgunTxidBigInt, BigInt(utxoTreeIn), BigInt(globalStartPositionOut)]),
    //     ByteLength.UINT_256,
    //   );
    // }
    // case TXIDVersion.V3_KZG:
    //   throw new Error('Unimplemented railgun txid hash for KZG');
  }
  throw new Error('TXID Version not recognized');
};

export const createRailgunTransactionWithID = (
  railgunTransaction: RailgunTransaction,
  txidVersion: TXIDVersion,
): RailgunTransactionWithTxid => {
  return {
    ...railgunTransaction,
    hash: getRailgunTxidLeafHash(railgunTransaction, txidVersion),
  };
};
