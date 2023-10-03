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

export type POIEngineProofInputs = {
  // --- Public inputs ---
  anyRailgunTxidMerklerootAfterTransaction: string;
  poiMerkleroots: string[];
  // blindedCommitmentsOut: string[] - output of circuit

  // --- Private inputs ---

  // Railgun Transaction info
  boundParamsHash: string;
  nullifiers: string[];
  commitmentsOut: string[];

  // Spender wallet info
  spendingPublicKey: [bigint, bigint];
  nullifyingKey: bigint;

  // Nullified notes data
  token: string;
  randomsIn: string[];
  valuesIn: bigint[];
  utxoPositionsIn: number[];
  utxoTreeIn: number;

  // Commitment notes data
  npksOut: bigint[];
  valuesOut: bigint[];
  utxoTreeOut: number;
  utxoBatchStartPositionOut: number;

  // Unshield data
  railgunTxidIfHasUnshield: string;

  // Railgun txid tree
  railgunTxidMerkleProofIndices: string;
  railgunTxidMerkleProofPathElements: string[];

  // POI tree
  poiInMerkleProofIndices: string[];
  poiInMerkleProofPathElements: string[][];
};

export enum TXIDVersion {
  V2_PoseidonMerkle = 'V2_PoseidonMerkle',
  // V3_PoseidonMerkle = 'V3_PoseidonMerkle',
  // V3_KZG = 'V3_KZG',
}

export const ACTIVE_UTXO_MERKLETREE_TXID_VERSIONS: TXIDVersion[] = [TXIDVersion.V2_PoseidonMerkle];
export const ACTIVE_TXID_VERSIONS: TXIDVersion[] = Object.values(TXIDVersion);
