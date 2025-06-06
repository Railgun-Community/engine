import { BigNumberish } from 'ethers';
import { RailgunWallet } from '../wallet/railgun-wallet';
import { Prover } from '../prover/prover';
import { HashZero } from '../utils/bytes';
import { findExactSolutionsOverTargetValue } from '../solutions/simple-solutions';
import { Transaction } from './transaction';
import { SpendingSolutionGroup, TXO, UnshieldData } from '../models/txo-types';
import { AdaptID, OutputType, TokenData, TokenType } from '../models/formatted-types';
import { TransactionStructV2, TransactionStructV3 } from '../models/transaction-types';
import { createSpendingSolutionsForValue } from '../solutions/complex-solutions';
import { calculateTotalSpend } from '../solutions/utxos';
import EngineDebug from '../debugger/debugger';
import {
  extractSpendingSolutionGroupsData,
  serializeExtractedSpendingSolutionGroupsData,
} from '../solutions/spending-group-extractor';
import { stringifySafe } from '../utils/stringify';
import { Chain } from '../models/engine-types';
import { TransactNote } from '../note/transact-note';
import {
  PreTransactionPOIsPerTxidLeafPerList,
  TXIDVersion,
  TreeBalance,
  UnprovedTransactionInputs,
} from '../models';
import { getTokenDataHash } from '../note/note-util';
import { AbstractWallet } from '../wallet';
import { BoundParamsStruct } from '../abi/typechain/RailgunSmartWallet';
import { isDefined } from '../utils/is-defined';
import { POI } from '../poi';
import { PoseidonMerkleVerifier } from '../abi/typechain';
import { Memo } from '../note/memo';
import WalletInfo from '../wallet/wallet-info';
import { ZERO_ADDRESS } from '../utils/constants';

export const GAS_ESTIMATE_VARIANCE_DUMMY_TO_ACTUAL_TRANSACTION = 9000;

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
    for (const tokenData of [...outputTokenDatas, ...unshieldTokenDatas]) {
      const tokenHash = getTokenDataHash(tokenData);
      if (!tokenHashes.includes(tokenHash)) {
        tokenHashes.push(tokenHash);
        tokenDatas.push(tokenData);
      }
    }
    return tokenDatas;
  }

  async generateValidSpendingSolutionGroupsAllOutputs(
    wallet: RailgunWallet,
    txidVersion: TXIDVersion,
    originShieldTxidForSpendabilityOverride?: string,
  ): Promise<SpendingSolutionGroup[]> {
    const tokenDatas: TokenData[] = this.getOutputTokenDatas();
    const spendingSolutionGroupsPerToken = await Promise.all(
      tokenDatas.map((tokenData) =>
        this.generateValidSpendingSolutionGroups(
          wallet,
          txidVersion,
          tokenData,
          originShieldTxidForSpendabilityOverride,
        ),
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
    originShieldTxidForSpendabilityOverride?: string,
  ): Promise<SpendingSolutionGroup[]> {
    const tokenHash = getTokenDataHash(tokenData);
    const tokenOutputs = this.outputs.filter((output) => output.tokenHash === tokenHash);
    const outputTotal = TransactNote.calculateTotalNoteValues(tokenOutputs);

    // Calculate total required to be supplied by UTXOs
    const totalRequired = outputTotal + this.unshieldTotal(tokenHash);

    const balanceBucketFilter = await POI.getSpendableBalanceBuckets(this.chain);

    const treeSortedBalances = await wallet.balancesByTreeForToken(
      txidVersion,
      this.chain,
      tokenHash,
      balanceBucketFilter,
      originShieldTxidForSpendabilityOverride,
    );
    const tokenBalance = AbstractWallet.tokenBalanceAcrossAllTrees(treeSortedBalances);

    // Check if wallet balance is enough to cover this transaction
    if (totalRequired > tokenBalance) {
      EngineDebug.log(`Token balance too low: token hash ${tokenHash}`);
      EngineDebug.log(`totalRequired: ${totalRequired}`);
      EngineDebug.log(`tokenBalance: ${tokenBalance}`);
      switch (tokenData.tokenType) {
        case TokenType.ERC20: {
          const broadcasterFeeOutput = tokenOutputs.find(
            (output) => output.outputType === OutputType.BroadcasterFee,
          );
          const amountRequiredMessage = broadcasterFeeOutput
            ? `${totalRequired.toString()} (includes ${broadcasterFeeOutput.value.toString()} Broadcaster Fee)`
            : totalRequired.toString();
          if (isDefined(originShieldTxidForSpendabilityOverride)) {
            throw new Error(
              `RAILGUN balance too low for ${
                tokenData.tokenAddress
              } from shield origin txid ${originShieldTxidForSpendabilityOverride}. Amount required: ${amountRequiredMessage}. Amount available: ${tokenBalance.toString()}.`,
            );
          }
          throw new Error(
            `RAILGUN spendable private balance too low for ${
              tokenData.tokenAddress
            }. Amount required: ${amountRequiredMessage}. Balance: ${tokenBalance.toString()}.`,
          );
        }
        case TokenType.ERC721:
        case TokenType.ERC1155:
          throw new Error(`RAILGUN spendable private NFT balance too low.`);
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
    for (const [tree, treeBalance] of treeSortedBalances.entries()) {
      if (!isDefined(treeBalance)) continue;
      const solutions = findExactSolutionsOverTargetValue(treeBalance, amountRequired);
      if (!isDefined(solutions)) continue;
      spendingTree = tree;
      utxos = solutions;
    }

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

  static getChangeOutput(
    wallet: RailgunWallet,
    spendingSolutionGroup: SpendingSolutionGroup,
  ): Optional<TransactNote> {
    const totalIn = calculateTotalSpend(spendingSolutionGroup.utxos);
    const totalOutputNoteValues = TransactNote.calculateTotalNoteValues(
      spendingSolutionGroup.tokenOutputs,
    );
    const totalOut = totalOutputNoteValues + spendingSolutionGroup.unshieldValue;

    const change = totalIn - totalOut;
    if (change < 0n) {
      throw new Error('Negative change value - transaction not possible.');
    }

    const requiresChangeOutput = change > 0n;
    const changeOutput = requiresChangeOutput
      ? TransactNote.createTransfer(
          wallet.addressKeys, // Receiver
          wallet.addressKeys, // Sender
          change,
          spendingSolutionGroup.tokenData,
          true, // showSenderAddressToRecipient
          OutputType.Change,
          undefined, // memoText
        )
      : undefined;
    return changeOutput;
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
    progressCallback: (progress: number, status: string) => void,
    shouldGeneratePreTransactionPOIs: boolean,
    originShieldTxidForSpendabilityOverride?: string,
  ): Promise<{
    provedTransactions: (TransactionStructV2 | TransactionStructV3)[];
    preTransactionPOIsPerTxidLeafPerList: PreTransactionPOIsPerTxidLeafPerList;
  }> {
    const spendingSolutionGroups = await this.generateValidSpendingSolutionGroupsAllOutputs(
      wallet,
      txidVersion,
      originShieldTxidForSpendabilityOverride,
    );
    EngineDebug.log('Actual spending solution groups:');
    EngineDebug.log(
      stringifySafe(
        serializeExtractedSpendingSolutionGroupsData(
          extractSpendingSolutionGroupsData(spendingSolutionGroups),
        ),
      ),
    );

    const provedTransactions: (TransactionStructV2 | TransactionStructV3)[] = [];

    const preTransactionPOIsPerTxidLeafPerList: PreTransactionPOIsPerTxidLeafPerList = {};
    const activeListKeys = POI.getActiveListKeys();

    const transactionDatas = spendingSolutionGroups.map((spendingSolutionGroup) => {
      const changeOutput = TransactionBatch.getChangeOutput(wallet, spendingSolutionGroup);
      const transaction = this.generateTransactionForSpendingSolutionGroup(
        spendingSolutionGroup,
        changeOutput,
      );
      const outputTypes = spendingSolutionGroup.tokenOutputs.map(
        (output) => output.outputType as OutputType,
      );
      if (changeOutput) {
        outputTypes.push(OutputType.Change);
      }
      return {
        transaction,
        outputTypes,
        utxos: spendingSolutionGroup.utxos,
        hasUnshield: spendingSolutionGroup.unshieldValue > 0n,
      };
    });

    const { walletSource } = WalletInfo;
    const orderedOutputTypes = transactionDatas.map(({ outputTypes }) => outputTypes).flat();

    const globalBoundParams: PoseidonMerkleVerifier.GlobalBoundParamsStruct = {
      minGasPrice: this.overallBatchMinGasPrice,
      chainID: this.chain.id,
      senderCiphertext: Memo.createSenderAnnotationEncryptedV3(
        walletSource,
        orderedOutputTypes,
        wallet.viewingKeyPair.privateKey,
      ),
      to: ZERO_ADDRESS, // TODO-V3: Add RelayAdapt contract address
      data: '0x', // TODO-V3: Add RelayAdapt encoded calldata
    };

    for (let index = 0; index < transactionDatas.length; index += 1) {
      const { transaction, utxos, hasUnshield } = transactionDatas[index];

      const { publicInputs, privateInputs, boundParams } =
        // eslint-disable-next-line no-await-in-loop
        await transaction.generateTransactionRequest(
          wallet,
          txidVersion,
          encryptionKey,
          globalBoundParams,
        );

      // eslint-disable-next-line no-await-in-loop
      const signature = await wallet.sign(publicInputs, encryptionKey);

      // Specific types per TXIDVersion
      let treeNumber: BigNumberish;
      let unprovedTransactionInputs: UnprovedTransactionInputs;
      switch (txidVersion) {
        case TXIDVersion.V2_PoseidonMerkle: {
          const boundParamsVersioned = boundParams as BoundParamsStruct;
          treeNumber = boundParamsVersioned.treeNumber;
          unprovedTransactionInputs = {
            txidVersion,
            privateInputs,
            publicInputs,
            boundParams: boundParamsVersioned,
            signature: [...signature.R8, signature.S],
          };
          break;
        }
        case TXIDVersion.V3_PoseidonMerkle: {
          const boundParamsVersioned = boundParams as PoseidonMerkleVerifier.BoundParamsStruct;
          treeNumber = boundParamsVersioned.local.treeNumber;
          unprovedTransactionInputs = {
            txidVersion,
            privateInputs,
            publicInputs,
            boundParams: boundParamsVersioned,
            signature: [...signature.R8, signature.S],
          };
          break;
        }
      }

      if (shouldGeneratePreTransactionPOIs) {
        for (let i = 0; i < activeListKeys.length; i += 1) {
          const listKey = activeListKeys[i];
          preTransactionPOIsPerTxidLeafPerList[listKey] ??= {};

          const preTransactionProofProgressStatus = `Generating proof of spendability ${
            i + index * activeListKeys.length + 1
          }/${spendingSolutionGroups.length * activeListKeys.length}...`;

          // eslint-disable-next-line no-await-in-loop
          const { txidLeafHash, preTransactionPOI } = await wallet.generatePreTransactionPOI(
            txidVersion,
            this.chain,
            listKey,
            utxos,
            publicInputs,
            privateInputs,
            treeNumber,
            hasUnshield,
            (progress: number) => progressCallback(progress, preTransactionProofProgressStatus),
          );

          preTransactionPOIsPerTxidLeafPerList[listKey][txidLeafHash] = preTransactionPOI;
        }
      }

      // NOTE: For multisig, at this point the UnprovedTransactionInputs are
      // forwarded to the next participant, along with an array of signatures.

      const preTransactionProofProgressStatus = `Generating transaction proof ${index + 1}/${
        spendingSolutionGroups.length
      }...`;

      // eslint-disable-next-line no-await-in-loop
      const provedTransaction = await transaction.generateProvedTransaction(
        txidVersion,
        prover,
        unprovedTransactionInputs,
        (progress: number) => progressCallback(progress, preTransactionProofProgressStatus),
      );
      provedTransactions.push(provedTransaction);
    }
    return { provedTransactions, preTransactionPOIsPerTxidLeafPerList };
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
    originShieldTxidForSpendabilityOverride?: string,
  ): Promise<(TransactionStructV2 | TransactionStructV3)[]> {
    const spendingSolutionGroups = await this.generateValidSpendingSolutionGroupsAllOutputs(
      wallet,
      txidVersion,
      originShieldTxidForSpendabilityOverride,
    );
    TransactionBatch.logDummySpendingSolutionGroupsSummary(spendingSolutionGroups);

    const globalBoundParams: PoseidonMerkleVerifier.GlobalBoundParamsStruct = {
      minGasPrice: this.overallBatchMinGasPrice,
      chainID: this.chain.id,
      senderCiphertext: '0x',
      to: ZERO_ADDRESS, // TODO-V3: Add RelayAdapt contract address
      data: '0x', // TODO-V3: Add RelayAdapt encoded calldata
    };

    const dummyProvedTransactions: (TransactionStructV2 | TransactionStructV3)[] = [];
    for (const spendingSolutionGroup of spendingSolutionGroups) {
      const changeOutput = TransactionBatch.getChangeOutput(wallet, spendingSolutionGroup);
      const transaction = this.generateTransactionForSpendingSolutionGroup(
        spendingSolutionGroup,
        changeOutput,
      );
      // eslint-disable-next-line no-await-in-loop
      const transactionRequest = await transaction.generateTransactionRequest(
        wallet,
        txidVersion,
        encryptionKey,
        globalBoundParams,
      );
      // eslint-disable-next-line no-await-in-loop
      const dummyProvedTransaction = await transaction.generateDummyProvedTransaction(
        prover,
        transactionRequest,
      );
      dummyProvedTransactions.push(dummyProvedTransaction);
    }
    return dummyProvedTransactions;
  }

  generateTransactionForSpendingSolutionGroup(
    spendingSolutionGroup: SpendingSolutionGroup,
    changeOutput: Optional<TransactNote>,
  ): Transaction {
    const { spendingTree, utxos, tokenOutputs, unshieldValue, tokenData } = spendingSolutionGroup;
    const allOutputs = changeOutput ? [...tokenOutputs, changeOutput] : tokenOutputs;
    const transaction = new Transaction(
      this.chain,
      tokenData,
      spendingTree,
      utxos,
      allOutputs,
      this.adaptID,
    );
    const tokenHash = getTokenDataHash(tokenData);
    if (isDefined(this.unshieldDataMap[tokenHash]) && unshieldValue > 0) {
      transaction.addUnshieldData(this.unshieldDataMap[tokenHash], unshieldValue);
    }
    return transaction;
  }
}
