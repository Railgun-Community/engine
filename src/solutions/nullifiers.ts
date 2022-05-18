export const VALID_NULLIFIER_COUNTS = [1, 2, 8];
export const MAX_NULLIFIERS = Math.max(...VALID_NULLIFIER_COUNTS);

export const isValidNullifierCount = (utxoCount: number): boolean =>
  VALID_NULLIFIER_COUNTS.includes(utxoCount);

export const isValidFor3Outputs = (utxoCount: number): boolean => {
  return utxoCount === 1 || utxoCount === 2;
};
