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

export function findSolutions(
  treeBalance: TreeBalance,
  totalRequired: bigint,
  excludedUTXOIDs: string[],
): TXO[] | undefined {
  // If this tree doesn't have enough to cover this transaction, return false
  if (treeBalance.balance < totalRequired) return [];

  const filteredUTXOs = treeBalance.utxos.filter((utxo) => !excludedUTXOIDs.includes(utxo.txid));

  // Sort UTXOs by size
  filteredUTXOs.sort((left, right) => {
    const leftNum = left.note.value;
    const rightNum = right.note.value;

    if (leftNum < rightNum) return 1;

    if (leftNum > rightNum) return -1;

    return 0;
  });

  // Optimized UTXO selection:
  // Select the utxo whose balance is above the required value, but closest to required value.
  // This will leave larger balances unbroken, supporting larger transactions.
  const utxosSupportingRequiredValue = filteredUTXOs.filter(
    (utxo) => utxo.note.value >= totalRequired,
  );
  if (utxosSupportingRequiredValue.length) {
    // Last element will be the smallest (pre-sorted array).
    return [utxosSupportingRequiredValue.pop()!];
  }

  // Accumulate UTXOs until we hit the target value
  const utxos: TXO[] = [];

  // Check if sum of UTXOs selected is greater than target
  while (filteredUTXOs.length > utxos.length && requiresMoreUTXOs(utxos, totalRequired)) {
    // If sum is not greater than target, push the next largest UTXO
    utxos.push(filteredUTXOs[utxos.length]);
  }

  if (totalRequired > calculateTotalSpend(utxos)) {
    // Search next tree.
    return undefined;
  }

  if (!isValidNullifierCount(utxos.length)) {
    // Search next tree.
    return undefined;
  }

  return utxos;
}
