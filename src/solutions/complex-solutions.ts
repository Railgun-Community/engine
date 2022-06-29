import { SpendingSolutionGroup, TXO } from '../models/txo-types';
import { Note } from '../note';
import { minBigInt } from '../utils/bigint';
import { TreeBalance } from '../wallet/types';
import { VALID_NULLIFIER_COUNTS, isValidNullifierCount } from './nullifiers';
import { calculateTotalSpend, sortUTXOsBySize } from './utxos';

type SolutionSpendingGroupGenerator = (
  tree: number,
  solutionValue: bigint,
  utxos: TXO[],
) => SpendingSolutionGroup;

const createSpendingSolutionsForValue = (
  treeSortedBalances: TreeBalance[],
  value: bigint,
  excludedUTXOIDs: string[],
  spendingSolutionGroupGenerator: SolutionSpendingGroupGenerator,
  updateOutputsCallback?: (amountLeft: bigint) => void,
) => {
  let amountLeft = value;

  const spendingSolutionGroups: SpendingSolutionGroup[] = [];

  treeSortedBalances.forEach((treeBalance, tree) => {
    while (amountLeft > 0) {
      const utxos = findNextSolutionBatch(treeBalance, amountLeft, excludedUTXOIDs);
      if (!utxos) {
        // No more solutions in this tree.
        break;
      }

      // Don't allow these UTXOs to be used twice.
      excludedUTXOIDs.push(...utxos.map((utxo) => utxo.txid));

      // Decrement amount left by total spend in UTXOs.
      const totalSpend = calculateTotalSpend(utxos);

      // Solution Value is the smaller of Solution spend value, or required output value.
      const solutionValue = minBigInt(totalSpend, amountLeft);

      // Generate spending solution group, which will be used to create a Transaction.
      const spendingSolutionGroup = spendingSolutionGroupGenerator(tree, solutionValue, utxos);
      spendingSolutionGroups.push(spendingSolutionGroup);

      amountLeft -= totalSpend;

      // For "outputs" search only, we iteratively search through and update an array of output notes.
      if (updateOutputsCallback) {
        updateOutputsCallback(amountLeft);
      }

      if (amountLeft < 0) {
        // Break out from the forEach loop, and continue with next output.
        return;
      }
    }
  });

  if (amountLeft > 0) {
    // Could not find enough solutions.
    throw consolidateBalanceError();
  }

  return spendingSolutionGroups;
};

export const createSpendingSolutionGroupsForOutput = (
  treeSortedBalances: TreeBalance[],
  output: Note,
  remainingOutputs: Note[],
  excludedUTXOIDs: string[],
): SpendingSolutionGroup[] => {
  const spendingSolutionGroupGenerator: SolutionSpendingGroupGenerator = (
    tree: number,
    solutionValue: bigint,
    utxos: TXO[],
  ): SpendingSolutionGroup => {
    const solutionOutput = output.newNoteWithValue(solutionValue);

    return {
      spendingTree: tree,
      utxos,
      outputs: [solutionOutput],
      withdrawValue: BigInt(0),
    };
  };

  const updateOutputsCallback = (amountLeft: bigint) => {
    // Remove the "used" output note.
    remainingOutputs.splice(0, 1);

    if (amountLeft > 0) {
      // Add another remaining output note for any Amount Left.
      remainingOutputs.unshift(output.newNoteWithValue(amountLeft));
    }
  };

  return createSpendingSolutionsForValue(
    treeSortedBalances,
    output.value,
    excludedUTXOIDs,
    spendingSolutionGroupGenerator,
    updateOutputsCallback,
  );
};

export const createSpendingSolutionGroupsForWithdraw = (
  treeSortedBalances: TreeBalance[],
  withdrawValue: bigint,
  excludedUTXOIDs: string[],
): SpendingSolutionGroup[] => {
  const spendingSolutionGroupGenerator: SolutionSpendingGroupGenerator = (
    tree: number,
    solutionValue: bigint,
    utxos: TXO[],
  ): SpendingSolutionGroup => {
    return {
      spendingTree: tree,
      utxos,
      outputs: [],
      withdrawValue: solutionValue,
    };
  };

  return createSpendingSolutionsForValue(
    treeSortedBalances,
    withdrawValue,
    excludedUTXOIDs,
    spendingSolutionGroupGenerator,
  );
};

/**
 * Wallet has appropriate balance in aggregate, but no solutions remain.
 * This means these UTXOs were already excluded, which can only occur in multi-send situations with multiple destination addresses.
 * eg. Out of a 225 balance (200 and 25), sending 75 each to 3 people becomes difficult, because of the constraints on the number of circuit outputs.
 */
export const consolidateBalanceError = (): Error => {
  throw new Error(
    'This transaction requires a complex circuit for multi-sending, which is not supported by RAILGUN at this time. Select a different Relayer fee token or send tokens to a single address to resolve.',
  );
};

/**
 * Finds next valid nullifier count above the current nullifier count.
 */
export const nextNullifierTarget = (utxoCount: number): number | undefined =>
  VALID_NULLIFIER_COUNTS.find((n) => n > utxoCount);

export const shouldAddMoreUTXOsForSolutionBatch = (
  currentNullifierCount: number,
  totalNullifierCount: number,
  currentSpend: bigint,
  totalRequired: bigint,
) => {
  if (currentSpend >= totalRequired) {
    // We've hit the target required.
    // Keep adding nullifiers until the count is valid.
    return !isValidNullifierCount(currentNullifierCount);
  }

  const nullifierTarget = nextNullifierTarget(currentNullifierCount);
  if (!nullifierTarget) {
    // No next nullifier target.
    return false;
  }

  if (nullifierTarget > totalNullifierCount) {
    // Next target is not reachable. Don't add any more UTXOs.
    return false;
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

  if (filteredUTXOs[0].note.value === 0n) {
    // No valuable notes in this tree.
    return undefined;
  }

  // Accumulate UTXOs until we hit the target value
  const utxos: TXO[] = [];

  // Check if sum of UTXOs selected is greater than target
  while (
    shouldAddMoreUTXOsForSolutionBatch(
      utxos.length,
      filteredUTXOs.length,
      calculateTotalSpend(utxos),
      totalRequired,
    )
  ) {
    utxos.push(filteredUTXOs[utxos.length]);
  }

  if (!isValidNullifierCount(utxos.length)) {
    return undefined;
  }

  return utxos;
}
