import {
  CommitmentCiphertextStructOutput,
  TransactionStruct,
} from '../abi/typechain/RailgunSmartWallet';
import { formatCommitmentCiphertext } from '../contracts/railgun-smart-wallet/events';
import {
  Commitment,
  CommitmentCiphertext,
  CommitmentSummary,
  CommitmentType,
  LegacyEncryptedCommitment,
  StoredReceiveCommitment,
  TransactCommitment,
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

export const isReceiveShieldCommitment = (receiveCommitment: StoredReceiveCommitment): boolean => {
  switch (receiveCommitment.commitmentType) {
    case CommitmentType.ShieldCommitment:
    case CommitmentType.LegacyGeneratedCommitment:
      return true;
    case CommitmentType.TransactCommitment:
    case CommitmentType.LegacyEncryptedCommitment:
      return false;
  }
  return false;
};

export const isSentCommitmentType = (commitmentType: CommitmentType): boolean => {
  switch (commitmentType) {
    case CommitmentType.TransactCommitment:
    case CommitmentType.LegacyEncryptedCommitment:
      return true;
    case CommitmentType.ShieldCommitment:
    case CommitmentType.LegacyGeneratedCommitment:
      return false;
  }
  return false;
};

export const isSentCommitment = (
  commitment: Commitment,
): commitment is TransactCommitment | LegacyEncryptedCommitment => {
  return isSentCommitmentType(commitment.commitmentType);
};
