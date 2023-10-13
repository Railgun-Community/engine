import { SpendingSolutionGroup, TXO } from '../models/txo-types';
import { minBigInt } from '../utils/bigint';
import { TreeBalance } from '../models/wallet-types';
import { VALID_INPUT_COUNTS, isValidNullifierCount } from './nullifiers';
import { calculateTotalSpend, filterZeroUTXOs, sortUTXOsByAscendingValue } from './utxos';
import { TransactNote } from '../note/transact-note';
import EngineDebug from '../debugger/debugger';
import { ByteLength, ZERO_32_BYTE_VALUE, formatToByteLength } from '../utils';
import { isDefined } from '../utils/is-defined';
import { CommitmentType } from '../models/formatted-types';

const logTreeSortedBalancesMetadata = (treeSortedBalances: TreeBalance[]) => {
  EngineDebug.log('treeSortedBalances metadata:');
  treeSortedBalances.forEach((treeBalance) => {
    EngineDebug.log(`Token: ${treeBalance.tokenData.tokenAddress}`);
    EngineDebug.log(`Total balance: ${treeBalance.balance.toString()}`);
    EngineDebug.log(
      `UTXOs: ${filterZeroUTXOs(treeBalance.utxos)
        .map((utxo) => utxo.note.value.toString())
        .join(', ')}`,
    );
  });
};

const createSpendingSolutionGroup = (
  output: TransactNote,
  tree: number,
  solutionValue: bigint,
  utxos: TXO[],
  isUnshield: boolean,
): SpendingSolutionGroup => {
  if (isUnshield) {
    return {
      spendingTree: tree,
      utxos,
      tokenOutputs: [],
      unshieldValue: solutionValue,
      tokenData: output.tokenData,
    };
  }

  const solutionOutput = output.newProcessingNoteWithValue(solutionValue);
  return {
    spendingTree: tree,
    utxos,
    tokenOutputs: [solutionOutput],
    unshieldValue: 0n,
    tokenData: output.tokenData,
  };
};

/**
 * UTXO with value 0n. All other fields are placeholders.
 * The circuit will ignore fields if value is 0.
 */
const createNullUTXO = (nullNote: TransactNote): TXO => {
  const nullTxid = formatToByteLength('0x00', ByteLength.UINT_256, true);
  return {
    tree: 0,
    position: 100000, // out of bounds position - so we don't have collisions on nullifiers
    blockNumber: 100,
    timestamp: undefined,
    spendtxid: false,
    note: nullNote,
    txid: nullTxid,
    poisPerList: undefined,
    blindedCommitment: undefined,
    transactCreationRailgunTxid: undefined,
    commitmentType: CommitmentType.TransactCommitment,
    nullifier: ZERO_32_BYTE_VALUE,
  };
};

const getUTXOIDPosition = (utxo: TXO): string => {
  return `${utxo.txid}-${utxo.position}`;
};

const replaceOrRemoveRemainingOutput = (remainingOutputs: TransactNote[], amountToFill: bigint) => {
  // Remove the "used" output note.
  const [deletedOutput] = remainingOutputs.splice(0, 1);

  // Insert another remaining output note for any Amount Left.
  if (amountToFill > 0n) {
    remainingOutputs.splice(0, 0, deletedOutput.newProcessingNoteWithValue(amountToFill));
  }
};

export const createSpendingSolutionsForValue = (
  treeSortedBalances: TreeBalance[],
  remainingOutputs: TransactNote[],
  excludedUTXOIDPositions: string[],
  isUnshield: boolean,
): SpendingSolutionGroup[] => {
  // Primary output to find UTXOs for.
  const primaryOutput = remainingOutputs[0];

  // Secondary output is used as the backup note for any change.
  const secondaryOutput = remainingOutputs.length > 1 ? remainingOutputs[1] : undefined;

  const { value } = primaryOutput;

  EngineDebug.log('createSpendingSolutionsForValue');
  EngineDebug.log(`totalRequired: ${value.toString()}`);
  EngineDebug.log(`excludedUTXOIDPositions: ${excludedUTXOIDPositions.join(', ')}`);
  logTreeSortedBalancesMetadata(treeSortedBalances);

  if (value === 0n) {
    replaceOrRemoveRemainingOutput(
      remainingOutputs,
      0n, // value
    );

    // Create a 0-value spending solution group.
    // This is used when simulating a circuit transaction, without requiring an input note.
    // Helpful for initial dummy Relayer Fee with recursive gas estimator.
    const nullNote = primaryOutput.newProcessingNoteWithValue(0n);
    const nullUtxo = createNullUTXO(nullNote);
    const utxos = [nullUtxo];
    const nullSpendingSolutionGroup = createSpendingSolutionGroup(
      nullNote,
      nullUtxo.tree,
      nullNote.value,
      utxos,
      isUnshield,
    );
    return [nullSpendingSolutionGroup];
  }

  let amountToFill = value;

  const spendingSolutionGroups: SpendingSolutionGroup[] = [];

  treeSortedBalances.forEach((treeBalance, tree) => {
    while (amountToFill > 0n) {
      const utxos = findNextSolutionBatch(treeBalance, amountToFill, excludedUTXOIDPositions);
      if (!utxos) {
        // No more solutions in this tree.
        break;
      }

      // Don't allow these UTXOs to be used twice.
      excludedUTXOIDPositions.push(...utxos.map(getUTXOIDPosition));

      // Decrement amount left by total spend in UTXOs.
      const totalSpend = calculateTotalSpend(utxos);

      // Solution Value is the smaller of Solution spend value, or required output value.
      const solutionValue = minBigInt(totalSpend, amountToFill);

      // Generate spending solution group, which will be used to create a Transaction.
      const spendingSolutionGroup = createSpendingSolutionGroup(
        primaryOutput,
        tree,
        solutionValue,
        utxos,
        isUnshield,
      );
      spendingSolutionGroups.push(spendingSolutionGroup);

      amountToFill -= totalSpend;

      replaceOrRemoveRemainingOutput(
        remainingOutputs,
        amountToFill, // value
      );

      if (amountToFill <= 0n) {
        // Use any remaining change to fill the secondary output.
        const change = 0n - amountToFill;
        if (change > 0n && secondaryOutput && !isUnshield) {
          let secondaryNoteValue: bigint;
          let finalAmountToFill: bigint;
          if (secondaryOutput.value < change) {
            secondaryNoteValue = secondaryOutput.value;
            finalAmountToFill = 0n;
          } else {
            secondaryNoteValue = change;
            finalAmountToFill = secondaryOutput.value - change;
          }
          const secondaryNote = secondaryOutput.newProcessingNoteWithValue(secondaryNoteValue);

          const finalSpendingSolutionGroup =
            spendingSolutionGroups[spendingSolutionGroups.length - 1];
          finalSpendingSolutionGroup.tokenOutputs.push(secondaryNote);

          // NOTE: Primary output is already removed from remainingOutputs.
          // This will remove the secondary output, or update the value.
          replaceOrRemoveRemainingOutput(remainingOutputs, finalAmountToFill);
        }

        // Break out from the forEach loop, and continue Solution search with next output.
        return;
      }
    }
  });

  if (amountToFill > 0n) {
    // Could not find enough solutions.
    throw new Error('Balance too low: requires additional UTXOs to satisfy spending solution.');
  }

  return spendingSolutionGroups;
};

/**
 * Finds next valid nullifier count above the current nullifier count.
 */
export const nextNullifierTarget = (utxoCount: number): Optional<number> =>
  VALID_INPUT_COUNTS.find((n) => n > utxoCount);

export const shouldAddMoreUTXOsForSolutionBatch = (
  currentNullifierCount: number,
  totalNullifierCount: number,
  currentSpend: bigint,
  totalRequired: bigint,
) => {
  if (currentSpend >= totalRequired) {
    // We've hit the target required.
    return false;
  }

  const nullifierTarget = nextNullifierTarget(currentNullifierCount);
  if (!isDefined(nullifierTarget)) {
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

/**
 * 1. Filter out UTXOs with value 0.
 * 2. Use exact match UTXO for totalRequired value if it exists.
 * 3. Sort by smallest UTXO ascending.
 * 4. Add UTXOs to the batch until we hit the totalRequired value, or exceed the UTXO input count maximum.
 */
export const findNextSolutionBatch = (
  treeBalance: TreeBalance,
  totalRequired: bigint,
  excludedUTXOIDPositions: string[],
): Optional<TXO[]> => {
  const removedZeroUTXOs = filterZeroUTXOs(treeBalance.utxos);
  const filteredUTXOs = removedZeroUTXOs.filter(
    (utxo) => !excludedUTXOIDPositions.includes(getUTXOIDPosition(utxo)),
  );
  if (!filteredUTXOs.length) {
    // No more solutions in this tree.
    return undefined;
  }

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
};
