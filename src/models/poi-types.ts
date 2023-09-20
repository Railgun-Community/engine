export enum TXOPOIListStatus {
  Valid = 'Valid',
  ShieldBlocked = 'ShieldBlocked',
  ShieldPending = 'ShieldPending',
  TransactProofSubmitted = 'TransactProofSubmitted',
  Missing = 'Missing',
}

// !! DO NOT MODIFY THIS TYPE !!
export type POIsPerList = {
  [key: string]: TXOPOIListStatus;
};

export enum BlindedCommitmentType {
  Shield = 'Shield',
  Transact = 'Transact',
}

export type BlindedCommitmentData = {
  blindedCommitment: string;
  type: BlindedCommitmentType;
};
