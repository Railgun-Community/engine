import { poseidon } from 'circomlibjs';
import { Commitment, CommitmentType } from '../models/formatted-types';
import { ByteLength, nToHex } from '../utils/bytes';
import { TREE_DEPTH } from '../models/merkletree-types';

const bitwiseMerge = (tree: number, index: number) => {
  return (tree << TREE_DEPTH) + index;
};

export const getBlindedCommitment = (
  commitment: Commitment,
  npk: string,
  railgunTxid: string,
): string => {
  const hash: bigint = getBlindedCommitmentHash(commitment, npk, railgunTxid);
  return `0x${nToHex(hash, ByteLength.UINT_256)}`;
};

const getBlindedCommitmentHash = (
  commitment: Commitment,
  npk: string,
  railgunTxid: string,
): bigint => {
  switch (commitment.commitmentType) {
    case CommitmentType.ShieldCommitment:
    case CommitmentType.LegacyGeneratedCommitment:
      return poseidon(
        [
          commitment.hash,
          commitment.preImage.npk,
          bitwiseMerge(commitment.utxoTree, commitment.utxoIndex),
        ].map((x) => BigInt(x)),
      );

    case CommitmentType.TransactCommitment:
    case CommitmentType.LegacyEncryptedCommitment:
      return poseidon([commitment.hash, npk, railgunTxid].map((x) => BigInt(x)));
  }
  throw new Error('Unrecognized commitment type');
};
