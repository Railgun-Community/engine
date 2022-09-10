import { TreeBalance, TXO } from '../wallet/abstract-wallet';
import { isValidNullifierCount, MAX_NULLIFIERS } from './nullifiers';
import { calculateTotalSpend, sortUTXOsBySize } from './utxos';

export const shouldAddMoreUTXOsToConsolidateBalances = (utxoCount: number) =>
  !isValidNullifierCount(utxoCount) && utxoCount < MAX_NULLIFIERS;

const shouldAddMoreUTXOs = (utxos: TXO[], totalRequired: bigint) =>
  calculateTotalSpend(utxos) < totalRequired ||
  shouldAddMoreUTXOsToConsolidateBalances(utxos.length);

export function findExactSolutionsOverTargetValue(
  treeBalance: TreeBalance,
  totalRequired: bigint,
): Optional<TXO[]> {
  // If this tree doesn't have enough to cover this transaction, return false
  if (treeBalance.balance < totalRequired) return [];

  const filteredUTXOs = treeBalance.utxos;

  // Sort UTXOs by size
  sortUTXOsBySize(filteredUTXOs);

  // Accumulate UTXOs until we hit the target value
  const utxos: TXO[] = [];

  // Check if sum of UTXOs selected is greater than target
  while (filteredUTXOs.length > utxos.length && shouldAddMoreUTXOs(utxos, totalRequired)) {
    // If sum is not greater than target, push the next largest UTXO
    utxos.push(filteredUTXOs[utxos.length]);
  }

  if (totalRequired > calculateTotalSpend(utxos)) {
    // Fallback to next tree, or complex transaction batch.
    return undefined;
  }

  if (!isValidNullifierCount(utxos.length)) {
    // Fallback to next tree, or complex transaction batch.
    return undefined;
  }

  return utxos;
}
