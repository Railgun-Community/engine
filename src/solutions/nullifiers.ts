export const VALID_INPUT_COUNTS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
export const VALID_OUTPUT_COUNTS = [1, 2, 3];
export const MAX_INPUTS = Math.max(...VALID_INPUT_COUNTS);

export const isValidNullifierCount = (utxoCount: number): boolean =>
  VALID_INPUT_COUNTS.includes(utxoCount);
