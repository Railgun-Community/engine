import { TreeBalance, TXO } from '../wallet';

export const VALID_NULLIFIER_COUNTS = [1, 2, 8];
const MAX_NULLIFIERS = Math.max(...VALID_NULLIFIER_COUNTS);

export const calculateTotalSpend = (utxos: TXO[]) =>
  utxos.reduce((left, right) => left + right.note.value, BigInt(0));

const isValidNullifierCount = (utxoCount: number): boolean =>
  VALID_NULLIFIER_COUNTS.includes(utxoCount);

export const shouldAddMoreUTXOsToConsolidateBalances = (utxoCount: number) =>
  !isValidNullifierCount(utxoCount) && utxoCount < MAX_NULLIFIERS;

const requiresMoreUTXOs = (utxos: TXO[], totalRequired: bigint) =>
  calculateTotalSpend(utxos) < totalRequired ||
  shouldAddMoreUTXOsToConsolidateBalances(utxos.length);

const sortUTXOsBySize = (utxos: TXO[]) => {
  utxos.sort((left, right) => {
    const leftNum = left.note.value;
    const rightNum = right.note.value;
    if (leftNum < rightNum) return 1;
    if (leftNum > rightNum) return -1;
    return 0;
  });
};

/**
 * Finds next valid nullifier count above the current nullifier count.
 */
const nextNullifierTarget = (utxoCount: number): number | undefined =>
  VALID_NULLIFIER_COUNTS.find((n) => n > utxoCount);

const shouldAddMoreUTXOsForSolutionBatch = (
  spendingUTXOs: TXO[],
  allUTXOs: TXO[],
  totalRequired: bigint,
) => {
  const nullifierCount = spendingUTXOs.length;
  const totalSpend = calculateTotalSpend(spendingUTXOs);

  if (totalSpend >= totalRequired) {
    // We've hit the target required.
    // Keep adding nullifiers until the count is valid.
    return !isValidNullifierCount(nullifierCount);
  }

  const nullifierTarget = nextNullifierTarget(nullifierCount);

  if (!nullifierTarget) {
    // No next nullifiers.
    // Keep adding nullifiers until the count is valid.
    return !isValidNullifierCount(nullifierCount);
  }

  const totalNullifierCount = allUTXOs.length;
  if (nextNullifierTarget(nullifierCount) > totalNullifierCount) {
    // Not reachable.
    // Keep adding nullifiers until the count is valid.
    return !isValidNullifierCount(nullifierCount);
  }

  // Total spend < total required, and next nullifier target is reachable.
  // Continue adding nullifiers.
  return true;
};

export function findNextSolutionBatch(
  treeBalance: TreeBalance,
  totalRequired: bigint,
  excludedUTXOIDs: string[],
): TXO[] | undefined {
  const filteredUTXOs = treeBalance.utxos.filter((utxo) => !excludedUTXOIDs.includes(utxo.txid));

  if (!filteredUTXOs.length) {
    // No more solutions in this tree.
    return undefined;
  }

  // Sort UTXOs by size
  sortUTXOsBySize(filteredUTXOs);

  // Accumulate UTXOs until we hit the target value
  const utxos: TXO[] = [];

  // Check if sum of UTXOs selected is greater than target
  while (shouldAddMoreUTXOsForSolutionBatch(utxos, filteredUTXOs, totalRequired)) {
    utxos.push(filteredUTXOs[utxos.length]);
  }

  if (!isValidNullifierCount(utxos.length)) {
    throw new Error('Invalid nullifier count');
  }

  return utxos;
}

export function findExactSolutionsOverTargetValue(
  treeBalance: TreeBalance,
  totalRequired: bigint,
): TXO[] | undefined {
  // If this tree doesn't have enough to cover this transaction, return false
  if (treeBalance.balance < totalRequired) return [];

  const filteredUTXOs = treeBalance.utxos;

  // Sort UTXOs by size
  sortUTXOsBySize(filteredUTXOs);

  // Accumulate UTXOs until we hit the target value
  const utxos: TXO[] = [];

  // Check if sum of UTXOs selected is greater than target
  while (filteredUTXOs.length > utxos.length && requiresMoreUTXOs(utxos, totalRequired)) {
    // If sum is not greater than target, push the next largest UTXO
    utxos.push(filteredUTXOs[utxos.length]);
  }

  if (totalRequired > calculateTotalSpend(utxos)) {
    // Fallback to next tree, or transaction batch.
    return undefined;
  }

  if (!isValidNullifierCount(utxos.length)) {
    // Fallback to next tree, or transaction batch.
    return undefined;
  }

  return utxos;
}
