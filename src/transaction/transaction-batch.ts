import { Note } from '../note';
import { bytes } from '../utils';
import { Wallet, TXO, TreeBalance } from '../wallet';
import { Prover } from '../prover';
import { ByteLength, formatToByteLength } from '../utils/bytes';
import { findExactSolutionsOverTargetValue } from '../solutions/simple-solutions';
import { Transaction } from './transaction';
import { SpendingSolutionGroup } from '../models/txo-types';
import { TokenType, BigIntish, SerializedTransaction } from '../models/formatted-types';
import {
  consolidateBalanceError,
  createSpendingSolutionGroupsForOutput,
  createSpendingSolutionGroupsForWithdraw,
} from '../solutions/complex-solutions';
import { calculateTotalSpend } from '../solutions/utxos';
import { isValidFor3Outputs } from '../solutions/nullifiers';
import LeptonDebug from '../debugger';
import {
  extractSpendingSolutionGroupsData,
  serializeExtractedSpendingSolutionGroupsData,
} from '../solutions/spending-group-extractor';
import { stringifySafe } from '../utils/stringify';

class TransactionBatch {
  private chainID: number;

  private tokenAddress: string;

  private outputs: Note[] = [];

  private tokenType: TokenType;

  private withdrawAddress: string | undefined;

  private withdrawTotal: bigint = BigInt(0);

  private overrideWithdrawAddress: string | undefined;

  /**
   * Create ERC20Transaction Object
   * @param tokenAddress - token address, unformatted
   * @param tokenType - enum of token type
   * @param chainID - chainID of network transaction will be built for
   */
  constructor(tokenAddress: string, tokenType: TokenType, chainID: number) {
    this.tokenAddress = formatToByteLength(tokenAddress, ByteLength.UINT_256);
    this.tokenType = tokenType;
    this.chainID = chainID;
  }

  addOutput(output: Note) {
    this.outputs.push(output);
  }

  resetOutputs() {
    this.outputs = [];
  }

  setWithdraw(withdrawAddress: string, value: BigIntish, overrideWithdrawAddress?: string) {
    if (this.withdrawAddress != null) {
      throw new Error('You may only call .withdraw once for a given transaction batch.');
    }

    this.withdrawAddress = withdrawAddress;
    this.withdrawTotal = BigInt(value);
    this.overrideWithdrawAddress = overrideWithdrawAddress;
  }

  resetWithdraw() {
    this.withdrawAddress = undefined;
    this.withdrawTotal = BigInt(0);
    this.overrideWithdrawAddress = undefined;
  }

  /**
   * Generates spending solution groups for outputs
   * @param wallet - wallet to spend from
   */
  async generateValidSpendingSolutionGroups(wallet: Wallet): Promise<SpendingSolutionGroup[]> {
    const outputTotal = this.outputs.reduce((left, right) => left + right.value, BigInt(0));

    // Calculate total required to be supplied by UTXOs
    const totalRequired = outputTotal + this.withdrawTotal;

    // Check if output token fields match tokenID for this transaction
    this.outputs.forEach((output, index) => {
      if (output.token !== this.tokenAddress)
        throw new Error(`Token address mismatch on output ${index}`);
    });

    // Get UTXOs sorted by tree
    const treeSortedBalances = (await wallet.balancesByTree(this.chainID))[
      formatToByteLength(this.tokenAddress, 32, false)
    ];

    if (treeSortedBalances === undefined) {
      const formattedTokenAddress = `0x${bytes.trim(this.tokenAddress, ByteLength.Address)}`;
      throw new Error(`No wallet balance for token: ${formattedTokenAddress}`);
    }

    // Sum balances
    const balance: bigint = treeSortedBalances.reduce(
      (left, right) => left + right.balance,
      BigInt(0),
    );

    // Check if wallet balance is enough to cover this transaction
    if (totalRequired > balance) throw new Error('Wallet balance too low');

    // If single group possible, return it.
    const singleSpendingSolutionGroup = this.createSimpleSpendingSolutionGroupsIfPossible(
      treeSortedBalances,
      totalRequired,
    );
    if (singleSpendingSolutionGroup) {
      return [singleSpendingSolutionGroup];
    }

    // Single group not possible - need a more complex model.
    return this.createComplexSatisfyingSpendingSolutionGroups(treeSortedBalances);
  }

  private createSimpleSpendingSolutionGroupsIfPossible(
    treeSortedBalances: TreeBalance[],
    totalRequired: bigint,
  ): SpendingSolutionGroup | undefined {
    try {
      const { utxos, spendingTree, amount } = TransactionBatch.createSimpleSatisfyingUTXOGroup(
        treeSortedBalances,
        totalRequired,
      );
      if (amount < totalRequired) {
        throw new Error('Could not find UTXOs to satisfy required amount.');
      }
      if (!isValidFor3Outputs(utxos.length) && this.outputs.length > 0 && this.withdrawTotal > 0) {
        // Cannot have 3 outputs. Can't include withdraw in note.
        throw new Error('Requires 3 outputs, given a withdraw and at least one standard output.');
      }

      const spendingSolutionGroup: SpendingSolutionGroup = {
        utxos,
        spendingTree,
        withdrawValue: this.withdrawTotal,
        outputs: this.outputs,
      };

      return spendingSolutionGroup;
    } catch (err) {
      return undefined;
    }
  }

  /**
   * Finds exact group of UTXOs above required amount.
   */
  private static createSimpleSatisfyingUTXOGroup(
    treeSortedBalances: TreeBalance[],
    amountRequired: bigint,
  ): { utxos: TXO[]; spendingTree: number; amount: bigint } {
    let spendingTree: number | undefined;
    let utxos: TXO[] | undefined;

    // Find first tree with spending solutions.
    treeSortedBalances.forEach((treeBalance, tree) => {
      const solutions = findExactSolutionsOverTargetValue(treeBalance, amountRequired);
      if (!solutions) {
        return;
      }
      spendingTree = tree;
      utxos = solutions;
    });

    if (utxos == null || spendingTree == null) {
      throw new Error('No spending solutions found. Must use complex UTXO aggregator.');
    }

    return {
      utxos,
      spendingTree,
      amount: calculateTotalSpend(utxos),
    };
  }

  /**
   * Finds array of UTXOs groups that satisfies the required amount, excluding an already-used array of UTXO IDs.
   */
  createComplexSatisfyingSpendingSolutionGroups(
    treeSortedBalances: TreeBalance[],
  ): SpendingSolutionGroup[] {
    const spendingSolutionGroups: SpendingSolutionGroup[] = [];

    const excludedUTXOIDs: string[] = [];
    const remainingOutputs = [...this.outputs];

    while (remainingOutputs.length > 0) {
      const output = remainingOutputs[0];
      const outputSpendingSolutionGroups = createSpendingSolutionGroupsForOutput(
        treeSortedBalances,
        output,
        remainingOutputs,
        excludedUTXOIDs,
      );
      if (!outputSpendingSolutionGroups.length) {
        break;
      }
      spendingSolutionGroups.push(...outputSpendingSolutionGroups);
    }

    if (remainingOutputs.length > 0) {
      // Could not find enough solutions.
      throw consolidateBalanceError();
    }

    if (this.withdrawTotal > 0) {
      const withdrawSpendingSolutionGroups = createSpendingSolutionGroupsForWithdraw(
        treeSortedBalances,
        this.withdrawTotal,
        excludedUTXOIDs,
      );

      if (!withdrawSpendingSolutionGroups.length) {
        throw consolidateBalanceError();
      }

      spendingSolutionGroups.push(...withdrawSpendingSolutionGroups);
    }

    return spendingSolutionGroups;
  }

  /**
   * Generate proofs and return serialized transactions
   * @param prover - prover to use
   * @param wallet - wallet to spend from
   * @param encryptionKey - encryption key for wallet
   * @returns serialized transaction
   */
  async generateSerializedTransactions(
    prover: Prover,
    wallet: Wallet,
    encryptionKey: string,
  ): Promise<SerializedTransaction[]> {
    const proofPromises: Promise<SerializedTransaction>[] = [];

    const spendingSolutionGroups = await this.generateValidSpendingSolutionGroups(wallet);
    LeptonDebug.log('Actual spending solution groups:');
    LeptonDebug.log(
      stringifySafe(
        serializeExtractedSpendingSolutionGroupsData(
          extractSpendingSolutionGroupsData(spendingSolutionGroups),
        ),
      ),
    );

    spendingSolutionGroups.forEach((spendingSolutionGroup) => {
      const transaction = this.generateTransactionForSpendingSolutionGroup(spendingSolutionGroup);
      proofPromises.push(transaction.prove(prover, wallet, encryptionKey));
    });

    return Promise.all(proofPromises);
  }

  /**
   * Generate dummy proofs and return serialized transactions
   * @param wallet - wallet to spend from
   * @param encryptionKey - encryption key for wallet
   * @returns serialized transaction
   */
  async generateDummySerializedTransactions(
    wallet: Wallet,
    encryptionKey: string,
  ): Promise<SerializedTransaction[]> {
    const proofPromises: Promise<SerializedTransaction>[] = [];

    const spendingSolutionGroups = await this.generateValidSpendingSolutionGroups(wallet);
    LeptonDebug.log('Dummy spending solution groups:');
    LeptonDebug.log(
      stringifySafe(
        serializeExtractedSpendingSolutionGroupsData(
          extractSpendingSolutionGroupsData(spendingSolutionGroups),
        ),
      ),
    );

    spendingSolutionGroups.forEach((spendingSolutionGroup) => {
      const transaction = this.generateTransactionForSpendingSolutionGroup(spendingSolutionGroup);
      proofPromises.push(transaction.dummyProve(wallet, encryptionKey));
    });

    return Promise.all(proofPromises);
  }

  generateTransactionForSpendingSolutionGroup(
    spendingSolutionGroup: SpendingSolutionGroup,
  ): Transaction {
    const { spendingTree, utxos, outputs, withdrawValue } = spendingSolutionGroup;
    const transaction = new Transaction(
      this.tokenAddress,
      this.tokenType,
      this.chainID,
      spendingTree,
      utxos,
    );
    transaction.setOutputs(outputs);
    if (this.withdrawAddress && withdrawValue > 0) {
      transaction.withdraw(this.withdrawAddress, withdrawValue, this.overrideWithdrawAddress);
    }
    return transaction;
  }
}

export { TransactionBatch };
