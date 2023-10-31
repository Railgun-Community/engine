import { PoseidonMerkleAccumulator } from '../abi/typechain/PoseidonMerkleAccumulator';
import { CommitmentCiphertextStructOutput } from '../abi/typechain/RailgunSmartWallet';
import { formatCommitmentCiphertextV2 } from '../contracts/railgun-smart-wallet/V2/V2-events';
import { formatCommitmentCiphertextV3 } from '../contracts/railgun-smart-wallet/V3/V3-events';
import {
  Commitment,
  CommitmentCiphertextV2,
  CommitmentCiphertextV3,
  CommitmentSummary,
  CommitmentType,
  LegacyEncryptedCommitment,
  StoredReceiveCommitment,
  TransactCommitmentV2,
} from '../models/formatted-types';
import { TXIDVersion } from '../models/poi-types';
import { TransactionStructV2, TransactionStructV3 } from '../models/transaction-types';
import { isDefined } from './is-defined';

export const convertTransactionStructToCommitmentSummary = (
  transactionStruct: TransactionStructV2 | TransactionStructV3,
  commitmentIndex: number,
): CommitmentSummary => {
  let commitmentCiphertext: CommitmentCiphertextV2 | CommitmentCiphertextV3;

  if (!isDefined(transactionStruct.txidVersion)) {
    throw new Error('txidVersion is not defined in TransactionStruct');
  }

  switch (transactionStruct.txidVersion) {
    case TXIDVersion.V2_PoseidonMerkle: {
      const commitmentCiphertextStruct = transactionStruct.boundParams.commitmentCiphertext[
        commitmentIndex
      ] as CommitmentCiphertextStructOutput;
      commitmentCiphertext = formatCommitmentCiphertextV2(commitmentCiphertextStruct);
      break;
    }
    case TXIDVersion.V3_PoseidonMerkle: {
      const commitmentCiphertextStruct = transactionStruct.boundParams.local.commitmentCiphertext[
        commitmentIndex
      ] as PoseidonMerkleAccumulator.CommitmentCiphertextStructOutput;
      commitmentCiphertext = formatCommitmentCiphertextV3(commitmentCiphertextStruct);
      break;
    }
  }

  const commitmentHash = transactionStruct.commitments[commitmentIndex] as string;

  return {
    commitmentCiphertext,
    commitmentHash,
  };
};

export const isShieldCommitmentType = (commitmentType: CommitmentType): boolean => {
  switch (commitmentType) {
    case CommitmentType.ShieldCommitment:
    case CommitmentType.LegacyGeneratedCommitment:
      return true;
    case CommitmentType.TransactCommitmentV2:
    case CommitmentType.TransactCommitmentV3:
    case CommitmentType.LegacyEncryptedCommitment:
      return false;
  }
  return false;
};

export const isReceiveShieldCommitment = (receiveCommitment: StoredReceiveCommitment): boolean => {
  return isShieldCommitmentType(receiveCommitment.commitmentType);
};

export const isTransactCommitmentType = (commitmentType: CommitmentType): boolean => {
  switch (commitmentType) {
    case CommitmentType.TransactCommitmentV2:
    case CommitmentType.TransactCommitmentV3:
    case CommitmentType.LegacyEncryptedCommitment:
      return true;
    case CommitmentType.ShieldCommitment:
    case CommitmentType.LegacyGeneratedCommitment:
      return false;
  }
  return false;
};

export const isTransactCommitment = (
  commitment: Commitment,
): commitment is TransactCommitmentV2 | LegacyEncryptedCommitment => {
  return isTransactCommitmentType(commitment.commitmentType);
};
