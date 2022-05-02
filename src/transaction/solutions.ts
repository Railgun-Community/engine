import { TreeBalance, TXO } from '../wallet';

const calculateTotalSpend = (utxos: TXO[]) =>
  utxos.reduce((left, right) => left + right.note.value, BigInt(0));

export function findSolutions(treeBalance: TreeBalance, totalRequired: bigint): TXO[] | undefined {
  // If this tree doesn't have enough to cover this transaction, return false
  if (treeBalance.balance < totalRequired) return [];

  // Sort UTXOs by size
  treeBalance.utxos.sort((left, right) => {
    const leftNum = left.note.value;
    const rightNum = right.note.value;

    if (leftNum < rightNum) return 1;

    if (leftNum > rightNum) return -1;

    return 0;
  });

  // TODO: optimise UTXO selection
  // Accumulate UTXOs until we hit the target value
  const utxos: TXO[] = [];

  // Check if sum of UTXOs selected is greater than target
  while (calculateTotalSpend(utxos) < totalRequired) {
    // If sum is not greater than target, push the next largest UTXO
    utxos.push(treeBalance.utxos[utxos.length]);
  }

  if (totalRequired > calculateTotalSpend(utxos)) {
    return undefined;
  }
  return utxos;
}
