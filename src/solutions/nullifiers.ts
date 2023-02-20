/**
 * CIRCUITS (V2)
 *
 * Valid, currently used:
 * All circuits with 1 - 10 inputs and 1 - 5 outputs, less the 10x5 circuit
 *
 * Valid, but currently unused:
 * 11x1, 12x1, 13x1
 * 1x10, 1x13
 */

export const VALID_INPUT_COUNTS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
export const VALID_OUTPUT_COUNTS = [1, 2, 3, 4, 5];

export const MAX_INPUTS = Math.max(...VALID_INPUT_COUNTS);

export const isValidNullifierCount = (utxoCount: number): boolean =>
  VALID_INPUT_COUNTS.includes(utxoCount);
