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
  txidVersion: TXIDVersion;
};

export type POIEngineProofInputs = {
  // --- Public inputs ---
  anyRailgunTxidMerklerootAfterTransaction: string;
  // poiMerkleroots: string[]; - see POIEngineProofInputsWithListPOIData
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
  utxoTreesIn: number;
  blindedCommitmentsIn: string[];
  creationTxidsIn: string[]; // For shields, this is `bitwiseMerge(tree, position)`

  // Commitment notes data
  npksOut: bigint[];
  valuesOut: bigint[];

  // Railgun txid tree
  railgunTxidMerkleProofIndices: string;
  railgunTxidMerkleProofPathElements: string[];

  // POI tree - see POIEngineProofInputsWithListPOIData
  // poiInMerkleProofIndices: string[];
  // poiInMerkleProofPathElements: string[][];
};

export type POIEngineProofInputsWithListPOIData = POIEngineProofInputs & {
  // --- Public inputs ---
  poiMerkleroots: string[];

  // --- Private inputs ---

  // POI tree - added by Wallet SDK
  poiInMerkleProofIndices: string[];
  poiInMerkleProofPathElements: string[][];
};

export enum TXIDVersion {
  V2_PoseidonMerkle = 'V2_PoseidonMerkle',
  V3_PoseidonMerkle = 'V3_PoseidonMerkle',
  V3_KZG = 'V3_KZG',
}

export const ACTIVE_TXID_VERSIONS: TXIDVersion[] = [TXIDVersion.V2_PoseidonMerkle];
