import { TreeBalance, TXO } from '../wallet';

export function findSolutions(
  token: string,
  treeBalance: TreeBalance,
  tree: number,
  totalRequired: bigint,
): TXO[] {
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
  while (utxos.reduce((left, right) => left + right.note.value, BigInt(0)) < totalRequired) {
    // If sum is not greater than target, push the next largest UTXO
    utxos.push(treeBalance.utxos[utxos.length]);
  }

  return utxos;
}
