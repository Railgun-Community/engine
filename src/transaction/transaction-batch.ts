import { RailgunWallet } from '../wallet/railgun-wallet';
import { Prover, ProverProgressCallback } from '../prover/prover';
import { HashZero } from '../utils/bytes';
import { findExactSolutionsOverTargetValue } from '../solutions/simple-solutions';
import { Transaction } from './transaction';
import { SpendingSolutionGroup, TXO, UnshieldData } from '../models/txo-types';
import { AdaptID, OutputType, TokenData, TokenType } from '../models/formatted-types';
import { createSpendingSolutionsForValue } from '../solutions/complex-solutions';
import { calculateTotalSpend } from '../solutions/utxos';
import EngineDebug from '../debugger/debugger';
import {
  extractSpendingSolutionGroupsData,
  serializeExtractedSpendingSolutionGroupsData,
} from '../solutions/spending-group-extractor';
import { stringifySafe } from '../utils/stringify';
import { averageNumber } from '../utils/average';
import { Chain } from '../models/engine-types';
import { TransactNote } from '../note/transact-note';
import { TXIDVersion, TreeBalance, UnprovedTransactionInputs } from '../models';
import { getTokenDataHash } from '../note/note-util';
import { AbstractWallet } from '../wallet';
import { TransactionStruct } from '../abi/typechain/RailgunSmartWallet';
import { isDefined } from '../utils/is-defined';

export const GAS_ESTIMATE_VARIANCE_DUMMY_TO_ACTUAL_TRANSACTION = 7500;

export class TransactionBatch {
  private adaptID: AdaptID = {
    contract: '0x0000000000000000000000000000000000000000',
    parameters: HashZero,
  };

  private chain: Chain;

  private outputs: TransactNote[] = [];

  private unshieldDataMap: { [tokenHash: string]: UnshieldData } = {};

  private overallBatchMinGasPrice: bigint;

  /**
   * Create TransactionBatch Object
   * @param chain - chain type/id of network
   */
  constructor(chain: Chain, overallBatchMinGasPrice: bigint = BigInt(0)) {
    this.chain = chain;
    this.overallBatchMinGasPrice = overallBatchMinGasPrice;
  }

  addOutput(output: TransactNote) {
    this.outputs.push(output);
  }

  resetOutputs() {
    this.outputs = [];
  }

  addUnshieldData(unshieldData: UnshieldData) {
    const tokenHash = getTokenDataHash(unshieldData.tokenData);
    if (isDefined(this.unshieldDataMap[tokenHash])) {
      throw new Error(
        'You may only call .addUnshieldData once per token for a given TransactionBatch.',
      );
    }
    if (unshieldData.value === 0n) {
      throw new Error('Unshield value must be greater than 0.');
    }
    this.unshieldDataMap[tokenHash] = unshieldData;
  }

  resetUnshieldData() {
    this.unshieldDataMap = {};
  }

  private unshieldTotal(tokenHash: string) {
    return isDefined(this.unshieldDataMap[tokenHash])
      ? this.unshieldDataMap[tokenHash].value
      : BigInt(0);
  }

  setAdaptID(adaptID: AdaptID) {
    this.adaptID = adaptID;
  }

  private getOutputTokenDatas(): TokenData[] {
    const tokenHashes: string[] = [];
    const tokenDatas: TokenData[] = [];
    const outputTokenDatas: TokenData[] = this.outputs.map((output) => output.tokenData);
    const unshieldTokenDatas: TokenData[] = Object.values(this.unshieldDataMap).map(
      (output) => output.tokenData,
    );
    [...outputTokenDatas, ...unshieldTokenDatas].forEach((tokenData) => {
      const tokenHash = getTokenDataHash(tokenData);
      if (!tokenHashes.includes(tokenHash)) {
        tokenHashes.push(tokenHash);
        tokenDatas.push(tokenData);
      }
    });
    return tokenDatas;
  }

  async generateValidSpendingSolutionGroupsAllOutputs(
    wallet: RailgunWallet,
    txidVersion: TXIDVersion,
  ): Promise<SpendingSolutionGroup[]> {
    const tokenDatas: TokenData[] = this.getOutputTokenDatas();
    const spendingSolutionGroupsPerToken = await Promise.all(
      tokenDatas.map((tokenData) =>
        this.generateValidSpendingSolutionGroups(wallet, txidVersion, tokenData),
      ),
    );
    return spendingSolutionGroupsPerToken.flat();
  }

  /**
   * Generates spending solution groups for outputs
   * @param wallet - wallet to spend from
   */
  private async generateValidSpendingSolutionGroups(
    wallet: RailgunWallet,
    txidVersion: TXIDVersion,
    tokenData: TokenData,
  ): Promise<SpendingSolutionGroup[]> {
    const tokenHash = getTokenDataHash(tokenData);
    const tokenOutputs = this.outputs.filter((output) => output.tokenHash === tokenHash);
    const outputTotal = TransactNote.calculateTotalNoteValues(tokenOutputs);

    // Calculate total required to be supplied by UTXOs
    const totalRequired = outputTotal + this.unshieldTotal(tokenHash);

    const treeSortedBalances = await wallet.balancesByTreeForToken(
      txidVersion,
      this.chain,
      tokenHash,
    );
    const tokenBalance = AbstractWallet.tokenBalanceAcrossAllTrees(treeSortedBalances);

    // Check if wallet balance is enough to cover this transaction
    if (totalRequired > tokenBalance) {
      EngineDebug.log(`Token balance too low: token hash ${tokenHash}`);
      EngineDebug.log(`totalRequired: ${totalRequired}`);
      EngineDebug.log(`tokenBalance: ${tokenBalance}`);
      switch (tokenData.tokenType) {
        case TokenType.ERC20: {
          const relayerFeeOutput = tokenOutputs.find(
            (output) => output.outputType === OutputType.RelayerFee,
          );
          const amountRequiredMessage = relayerFeeOutput
            ? `${totalRequired.toString()} (includes ${relayerFeeOutput.value.toString()} Relayer Fee)`
            : totalRequired.toString();
          throw new Error(
            `RAILGUN private token balance too low for ${
              tokenData.tokenAddress
            }. Amount required: ${amountRequiredMessage}. Balance: ${tokenBalance.toString()}.`,
          );
        }
        case TokenType.ERC721:
        case TokenType.ERC1155:
          throw new Error(`RAILGUN private NFT balance too low.`);
      }
    }

    // If single group possible, return it.
    const singleSpendingSolutionGroup = this.createSimpleSpendingSolutionGroupsIfPossible(
      tokenData,
      tokenHash,
      tokenOutputs,
      treeSortedBalances,
      totalRequired,
    );
    if (singleSpendingSolutionGroup) {
      return [singleSpendingSolutionGroup];
    }

    // Single group not possible - need a more complex model.
    return this.createComplexSatisfyingSpendingSolutionGroups(
      tokenData,
      tokenOutputs,
      treeSortedBalances,
    );
  }

  private createSimpleSpendingSolutionGroupsIfPossible(
    tokenData: TokenData,
    tokenHash: string,
    tokenOutputs: TransactNote[],
    treeSortedBalances: TreeBalance[],
    totalRequired: bigint,
  ): Optional<SpendingSolutionGroup> {
    try {
      const { utxos, spendingTree, amount } = TransactionBatch.createSimpleSatisfyingUTXOGroup(
        treeSortedBalances,
        totalRequired,
      );
      if (amount < totalRequired) {
        throw new Error('Could not find UTXOs to satisfy required amount.');
      }

      const unshieldValue = this.unshieldTotal(tokenHash);

      const spendingSolutionGroup: SpendingSolutionGroup = {
        utxos,
        spendingTree,
        unshieldValue,
        tokenOutputs,
        tokenData,
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
    let spendingTree: Optional<number>;
    let utxos: Optional<TXO[]>;

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
    tokenData: TokenData,
    tokenOutputs: TransactNote[],
    treeSortedBalances: TreeBalance[],
  ): SpendingSolutionGroup[] {
    const spendingSolutionGroups: SpendingSolutionGroup[] = [];

    const excludedUTXOIDPositions: string[] = [];
    const remainingTokenOutputs = [...tokenOutputs];

    while (remainingTokenOutputs.length > 0) {
      const transactSpendingSolutionGroups = createSpendingSolutionsForValue(
        treeSortedBalances,
        remainingTokenOutputs,
        excludedUTXOIDPositions,
        false, // isUnshield
      );
      if (!transactSpendingSolutionGroups.length) {
        break;
      }
      spendingSolutionGroups.push(...transactSpendingSolutionGroups);
    }

    if (remainingTokenOutputs.length > 0) {
      throw new Error('Could not find enough UTXOs to satisfy transfer.');
    }

    const tokenHash = getTokenDataHash(tokenData);
    if (isDefined(this.unshieldDataMap[tokenHash])) {
      const value = this.unshieldTotal(tokenHash);
      const nullUnshieldNote = TransactNote.createNullUnshieldNote(tokenData, value);
      const unshieldTokenOutputs: TransactNote[] = [nullUnshieldNote];

      const unshieldSpendingSolutionGroups = createSpendingSolutionsForValue(
        treeSortedBalances,
        unshieldTokenOutputs,
        excludedUTXOIDPositions,
        true, // isUnshield
      );

      if (!unshieldSpendingSolutionGroups.length) {
        throw new Error('Could not find enough UTXOs to satisfy unshield.');
      }

      spendingSolutionGroups.push(...unshieldSpendingSolutionGroups);
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
  async generateTransactions(
    prover: Prover,
    wallet: RailgunWallet,
    txidVersion: TXIDVersion,
    encryptionKey: string,
    progressCallback: ProverProgressCallback,
  ): Promise<TransactionStruct[]> {
    const spendingSolutionGroups = await this.generateValidSpendingSolutionGroupsAllOutputs(
      wallet,
      txidVersion,
    );
    EngineDebug.log('Actual spending solution groups:');
    EngineDebug.log(
      stringifySafe(
        serializeExtractedSpendingSolutionGroupsData(
          extractSpendingSolutionGroupsData(spendingSolutionGroups),
        ),
      ),
    );

    const individualProgressAmounts: number[] = new Array<number>(
      spendingSolutionGroups.length,
    ).fill(0);
    const updateProgressCallback = () => {
      const averageProgress = averageNumber(individualProgressAmounts);
      progressCallback(averageProgress);
    };

    const provedTransactions: TransactionStruct[] = [];

    for (let index = 0; index < spendingSolutionGroups.length; index += 1) {
      const spendingSolutionGroup = spendingSolutionGroups[index];
      const transaction = this.generateTransactionForSpendingSolutionGroup(spendingSolutionGroup);
      const individualProgressCallback = (progress: number) => {
        individualProgressAmounts[index] = progress;
        updateProgressCallback();
      };
      const { publicInputs, privateInputs, boundParams } =
        // eslint-disable-next-line no-await-in-loop
        await transaction.generateTransactionRequest(
          wallet,
          txidVersion,
          encryptionKey,
          this.overallBatchMinGasPrice,
        );
      // eslint-disable-next-line no-await-in-loop
      const signature = await wallet.sign(publicInputs, encryptionKey);
      const unprovedTransactionInputs: UnprovedTransactionInputs = {
        privateInputs,
        publicInputs,
        boundParams,
        signature: [...signature.R8, signature.S],
      };
      // NOTE: For multisig, at this point the UnprovedTransactionInputs are
      // forwarded to the next participant, along with an array of signatures.
      // eslint-disable-next-line no-await-in-loop
      const provedTransaction = await transaction.generateProvedTransaction(
        prover,
        unprovedTransactionInputs,
        individualProgressCallback,
      );
      provedTransactions.push(provedTransaction);
    }
    return provedTransactions;
  }

  private static logDummySpendingSolutionGroupsSummary(
    spendingSolutionGroups: SpendingSolutionGroup[],
  ) {
    const spendingSolutionGroupsSummaries: string[] = spendingSolutionGroups.map(
      (spendingSolutionGroup) => {
        const nullifiers = spendingSolutionGroup.utxos.length;
        const commitments = spendingSolutionGroup.tokenOutputs.length;
        return `${nullifiers}x${commitments}`;
      },
    );
    EngineDebug.log(
      `Dummy spending solution groups - circuits ${spendingSolutionGroupsSummaries.join(
        ', ',
      )} (excluding unshields)`,
    );
    EngineDebug.log(
      stringifySafe(
        serializeExtractedSpendingSolutionGroupsData(
          extractSpendingSolutionGroupsData(spendingSolutionGroups),
        ),
      ),
    );
  }

  /**
   * Generate dummy proofs and return serialized transactions
   * @param wallet - wallet to spend from
   * @param encryptionKey - encryption key for wallet
   * @returns serialized transaction
   */
  async generateDummyTransactions(
    prover: Prover,
    wallet: RailgunWallet,
    txidVersion: TXIDVersion,
    encryptionKey: string,
  ): Promise<TransactionStruct[]> {
    const spendingSolutionGroups = await this.generateValidSpendingSolutionGroupsAllOutputs(
      wallet,
      txidVersion,
    );
    TransactionBatch.logDummySpendingSolutionGroupsSummary(spendingSolutionGroups);

    const dummyProvedTransactionPromises: Promise<TransactionStruct>[] = spendingSolutionGroups.map(
      async (spendingSolutionGroup) => {
        const transaction = this.generateTransactionForSpendingSolutionGroup(spendingSolutionGroup);
        const transactionRequest = await transaction.generateTransactionRequest(
          wallet,
          txidVersion,
          encryptionKey,
          this.overallBatchMinGasPrice,
        );
        return transaction.generateDummyProvedTransaction(prover, transactionRequest);
      },
    );
    return Promise.all(dummyProvedTransactionPromises);
  }

  generateTransactionForSpendingSolutionGroup(
    spendingSolutionGroup: SpendingSolutionGroup,
  ): Transaction {
    const { spendingTree, utxos, tokenOutputs, unshieldValue, tokenData } = spendingSolutionGroup;
    const transaction = new Transaction(
      this.chain,
      tokenData,
      spendingTree,
      utxos,
      tokenOutputs,
      this.adaptID,
    );
    const tokenHash = getTokenDataHash(tokenData);
    if (isDefined(this.unshieldDataMap[tokenHash]) && unshieldValue > 0) {
      transaction.addUnshieldData(this.unshieldDataMap[tokenHash], unshieldValue);
    }
    return transaction;
  }
}
