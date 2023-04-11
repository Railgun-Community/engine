import { TXO, TreeBalance } from '../models';
import { isValidNullifierCount } from './nullifiers';
import { calculateTotalSpend, filterZeroUTXOs, sortUTXOsByAscendingValue } from './utxos';

const shouldAddMoreUTXOs = (utxos: TXO[], totalRequired: bigint) =>
  calculateTotalSpend(utxos) < totalRequired;

export function findExactSolutionsOverTargetValue(
  treeBalance: TreeBalance,
  totalRequired: bigint,
): Optional<TXO[]> {
  // If this tree doesn't have enough to cover this transaction, return false
  if (treeBalance.balance < totalRequired) return [];

  // Remove utxos with 0 value.
  const filteredUTXOs: TXO[] = filterZeroUTXOs(treeBalance.utxos);

  // Use exact match if it exists.
  // TODO: Use exact matches from any tree, not just the first tree examined.
  const exactMatch = filteredUTXOs.find((utxo) => utxo.note.value === totalRequired);
  if (exactMatch) {
    return [exactMatch];
  }

  // Sort UTXOs by smallest size
  sortUTXOsByAscendingValue(filteredUTXOs);

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
