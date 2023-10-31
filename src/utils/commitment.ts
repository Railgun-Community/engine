import {
  CommitmentCiphertextStructOutput,
  TransactionStruct,
} from '../abi/typechain/RailgunSmartWallet';
import { formatCommitmentCiphertext } from '../contracts/railgun-smart-wallet/V2/V2-events';
import {
  Commitment,
  CommitmentCiphertext,
  CommitmentSummary,
  CommitmentType,
  LegacyEncryptedCommitment,
  StoredReceiveCommitment,
  TransactCommitmentV2,
} from '../models/formatted-types';

export const convertTransactionStructToCommitmentSummary = (
  transactionStruct: TransactionStruct,
  commitmentIndex: number,
): CommitmentSummary => {
  const commitmentCiphertextStruct = transactionStruct.boundParams.commitmentCiphertext[
    commitmentIndex
  ] as CommitmentCiphertextStructOutput;

  const commitmentCiphertext: CommitmentCiphertext = formatCommitmentCiphertext(
    commitmentCiphertextStruct,
  );
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
