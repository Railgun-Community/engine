import { Provider, TransactionRequest } from '@ethersproject/abstract-provider';
import { BigNumber, CallOverrides, Contract, ethers, PopulatedTransaction } from 'ethers';
import { Result } from 'ethers/lib/utils';
import { ABIRelayAdapt } from '../../abi/abi';
import { TransactionReceiptLog } from '../../models/formatted-types';
import { getTokenDataERC20 } from '../../note/note-util';
import { RelayAdapt } from '../../typechain-types/contracts/adapt/Relay.sol/RelayAdapt';
import {
  ShieldRequestStruct,
  TransactionStruct,
} from '../../typechain-types/contracts/logic/RailgunSmartWallet';
import { ZERO_ADDRESS } from '../../utils/constants';
import { RelayAdaptHelper } from './relay-adapt-helper';
import EngineDebug from '../../debugger/debugger';
import { BaseProvider } from '@ethersproject/providers';

enum RelayAdaptEvent {
  CallError = 'CallError',
}

// A low (or undefined) gas limit can cause the Relay Adapt module to fail.
// Set a high default that can be overridden by a developer.
export const MINIMUM_RELAY_ADAPT_CROSS_CONTRACT_CALLS_GAS_LIMIT = BigNumber.from(2_800_000);
// Contract call needs ~50,000 less gas than the gasLimit setting.
// This can be more if there are complex UTXO sets for the unshield.
export const MINIMUM_RELAY_ADAPT_CROSS_CONTRACT_CALLS_MINIMUM_GAS_FOR_CONTRACT =
  BigNumber.from(2_600_000);

export class RelayAdaptContract {
  private readonly contract: RelayAdapt;

  readonly address: string;

  /**
   * Connect to Railgun instance on network
   * @param relayAdaptContractAddress - address of Railgun relay adapt contract
   * @param provider - Network provider
   */
  constructor(relayAdaptContractAddress: string, provider: Provider) {
    this.address = relayAdaptContractAddress;
    this.contract = new Contract(relayAdaptContractAddress, ABIRelayAdapt, provider) as RelayAdapt;
  }

  async populateShieldBaseToken(shieldRequest: ShieldRequestStruct): Promise<PopulatedTransaction> {
    const orderedCalls: PopulatedTransaction[] = await Promise.all([
      this.contract.populateTransaction.wrapBase(shieldRequest.preimage.value),
      this.populateRelayShields([shieldRequest]),
    ]);

    const requireSuccess = true;

    return this.populateRelayMulticall(requireSuccess, orderedCalls, {
      value: shieldRequest.preimage.value,
    });
  }

  /**
   * @returns Populated transaction
   */
  private populateRelayShields(
    shieldRequests: ShieldRequestStruct[],
  ): Promise<PopulatedTransaction> {
    RelayAdaptHelper.validateShieldRequests(shieldRequests);
    return this.contract.populateTransaction.shield(shieldRequests);
  }

  private async getOrderedCallsForUnshieldBaseToken(
    unshieldAddress: string,
  ): Promise<PopulatedTransaction[]> {
    // Use 0x00 address ERC20 to represent base token.
    const baseTokenData = getTokenDataERC20(ZERO_ADDRESS);

    // Automatically unwraps and unshields all tokens.
    const value = 0n;

    const baseTokenTransfer: RelayAdapt.TokenTransferStruct = {
      token: baseTokenData,
      to: unshieldAddress,
      value,
    };

    return Promise.all([
      this.contract.populateTransaction.unwrapBase(value),
      this.populateRelayTransfers([baseTokenTransfer]),
    ]);
  }

  async getRelayAdaptParamsUnshieldBaseToken(
    dummyTransactions: TransactionStruct[],
    unshieldAddress: string,
    random: string,
  ): Promise<string> {
    const orderedCalls: PopulatedTransaction[] = await this.getOrderedCallsForUnshieldBaseToken(
      unshieldAddress,
    );

    const requireSuccess = true;
    return RelayAdaptHelper.getRelayAdaptParams(
      dummyTransactions,
      random,
      requireSuccess,
      orderedCalls,
    );
  }

  async populateUnshieldBaseToken(
    transactions: TransactionStruct[],
    unshieldAddress: string,
    random31Bytes: string,
  ): Promise<PopulatedTransaction> {
    const orderedCalls: PopulatedTransaction[] = await this.getOrderedCallsForUnshieldBaseToken(
      unshieldAddress,
    );

    const requireSuccess = true;
    return this.populateRelay(transactions, random31Bytes, requireSuccess, orderedCalls, {});
  }

  /**
   * @returns Populated transaction
   */
  private populateRelayTransfers(
    transfersData: RelayAdapt.TokenTransferStruct[],
  ): Promise<PopulatedTransaction> {
    return this.contract.populateTransaction.transfer(transfersData);
  }

  private async getOrderedCallsForCrossContractCalls(
    crossContractCalls: PopulatedTransaction[],
    relayShieldRequests: ShieldRequestStruct[],
  ): Promise<PopulatedTransaction[]> {
    const orderedCallPromises: PopulatedTransaction[] = [...crossContractCalls];
    if (relayShieldRequests.length) {
      orderedCallPromises.push(await this.populateRelayShields(relayShieldRequests));
    }
    return orderedCallPromises;
  }

  private static shouldRequireSuccessForCrossContractCalls(
    isGasEstimate: boolean,
    isRelayerTransaction: boolean,
  ): boolean {
    // If the cross contract calls (multicalls) fail, the Relayer Fee and Shields should continue to process.
    // We should only !requireSuccess for production relayer transactions (not gas estimates).
    const continueAfterMulticallFailure = isRelayerTransaction && !isGasEstimate;
    return !continueAfterMulticallFailure;
  }

  async getRelayAdaptParamsCrossContractCalls(
    dummyUnshieldTransactions: TransactionStruct[],
    crossContractCalls: PopulatedTransaction[],
    relayShieldRequests: ShieldRequestStruct[],
    random: string,
    isRelayerTransaction: boolean,
  ): Promise<string> {
    const orderedCalls: PopulatedTransaction[] = await this.getOrderedCallsForCrossContractCalls(
      crossContractCalls,
      relayShieldRequests,
    );

    // Adapt params not required for gas estimates.
    const isGasEstimate = false;

    const requireSuccess = RelayAdaptContract.shouldRequireSuccessForCrossContractCalls(
      isGasEstimate,
      isRelayerTransaction,
    );

    return RelayAdaptHelper.getRelayAdaptParams(
      dummyUnshieldTransactions,
      random,
      requireSuccess,
      orderedCalls,
      MINIMUM_RELAY_ADAPT_CROSS_CONTRACT_CALLS_MINIMUM_GAS_FOR_CONTRACT,
    );
  }

  async populateCrossContractCalls(
    unshieldTransactions: TransactionStruct[],
    crossContractCalls: PopulatedTransaction[],
    relayShieldRequests: ShieldRequestStruct[],
    random31Bytes: string,
    isGasEstimate: boolean,
    isRelayerTransaction: boolean,
  ): Promise<PopulatedTransaction> {
    const orderedCalls: PopulatedTransaction[] = await this.getOrderedCallsForCrossContractCalls(
      crossContractCalls,
      relayShieldRequests,
    );

    const requireSuccess = RelayAdaptContract.shouldRequireSuccessForCrossContractCalls(
      isGasEstimate,
      isRelayerTransaction,
    );

    const populatedTransaction = await this.populateRelay(
      unshieldTransactions,
      random31Bytes,
      requireSuccess,
      orderedCalls,
      {},
      MINIMUM_RELAY_ADAPT_CROSS_CONTRACT_CALLS_MINIMUM_GAS_FOR_CONTRACT,
    );

    // Set default gas limit for cross-contract calls.
    populatedTransaction.gasLimit = MINIMUM_RELAY_ADAPT_CROSS_CONTRACT_CALLS_GAS_LIMIT;

    return populatedTransaction;
  }

  static async estimateGasWithErrorHandler(
    provider: BaseProvider,
    transaction: PopulatedTransaction | TransactionRequest,
  ): Promise<BigNumber> {
    try {
      const gasEstimate = await provider.estimateGas(transaction);
      return gasEstimate;
    } catch (err) {
      if (!(err instanceof Error)) {
        throw err;
      }
      const { callFailedIndexString, errorMessage } =
        RelayAdaptContract.extractCallFailedIndexAndErrorText(err.message);
      throw new Error(
        `RelayAdapt multicall failed at index ${callFailedIndexString} with ${errorMessage}`,
      );
    }
  }

  static extractCallFailedIndexAndErrorText(errMessage: string) {
    try {
      // Sample error text from ethers: `"data":{"message":"Error: VM Exception while processing transaction: reverted with custom error 'CallFailed(0, \"0x")\'\","data":"0x5c0dee5d000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000400000000000000000000000000000000000000000000000000000000000000000"\}}}"`
      const removedBackslashes = errMessage.replace(/\//g, '');
      const prefixSplit = `"data":{"message":"Error: VM Exception while processing transaction: reverted with custom error '`;
      const prefixSplitResult = removedBackslashes.split(prefixSplit)[1];
      const splitResult = prefixSplitResult.split(`'",`);
      const callFailedMessage = splitResult[0];
      const dataMessage = splitResult[1].split(`}}`)[0];
      const callFailedIndexString = callFailedMessage.split('(')[1].split(',')[0];
      return {
        callFailedIndexString,
        errorMessage: `ABI-encoded revert message: ${dataMessage}`,
      };
    } catch (err) {
      return {
        callFailedIndexString: 'UNKNOWN',
        errorMessage: `error: ${errMessage}`,
      };
    }
  }

  /**
   * Generates Relay multicall given a list of ordered calls.
   * @returns populated transaction
   */
  private async populateRelayMulticall(
    requireSuccess: boolean,
    calls: PopulatedTransaction[],
    overrides: CallOverrides,
  ): Promise<PopulatedTransaction> {
    const populatedTransaction = await this.contract.populateTransaction.multicall(
      requireSuccess,
      RelayAdaptHelper.formatCalls(calls),
      overrides,
    );
    return populatedTransaction;
  }

  /**
   * Generates Relay multicall given a list of transactions and ordered calls.
   * @returns populated transaction
   */
  private async populateRelay(
    transactions: TransactionStruct[],
    random31Bytes: string,
    requireSuccess: boolean,
    calls: PopulatedTransaction[],
    overrides: CallOverrides,
    minimumGasLimit = BigNumber.from(0),
  ): Promise<PopulatedTransaction> {
    const actionData: RelayAdapt.ActionDataStruct = RelayAdaptHelper.getActionData(
      random31Bytes,
      requireSuccess,
      calls,
      minimumGasLimit,
    );
    const populatedTransaction = await this.contract.populateTransaction.relay(
      transactions,
      actionData,
      overrides,
    );
    return populatedTransaction;
  }

  static getRelayAdaptCallError(receiptLogs: TransactionReceiptLog[]): Optional<string> {
    const iface = new ethers.utils.Interface(ABIRelayAdapt);
    const topic = iface.getEventTopic(RelayAdaptEvent.CallError);

    try {
      // eslint-disable-next-line no-restricted-syntax
      for (const log of receiptLogs) {
        if (log.topics[0] === topic) {
          const parsedError = this.customRelayAdaptErrorParse(log.data);
          if (parsedError) {
            return parsedError;
          }
        }
      }
    } catch (err) {
      if (!(err instanceof Error)) {
        throw err;
      }
      EngineDebug.error(err);
      throw new Error(`Relay Adapt log parsing error: ${err.message}.`);
    }
    return undefined;
  }

  static parseRelayAdaptReturnValue(returnValue: string): Optional<string> {
    const RETURN_DATA_RELAY_ADAPT_STRING_PREFIX = '0x5c0dee5d';
    if (!returnValue.match(RETURN_DATA_RELAY_ADAPT_STRING_PREFIX)) {
      return `Not a RelayAdapt return value: must be prefixed with ${RETURN_DATA_RELAY_ADAPT_STRING_PREFIX}`;
    }
    const strippedReturnValue = returnValue.replace(RETURN_DATA_RELAY_ADAPT_STRING_PREFIX, '0x');
    return this.customRelayAdaptErrorParse(strippedReturnValue);
  }

  private static customRelayAdaptErrorParse(data: string): Optional<string> {
    // Force parse as bytes
    const decoded: Result = ethers.utils.defaultAbiCoder.decode(
      ['uint256 callIndex', 'bytes revertReason'],
      data,
    );

    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
    const revertReasonBytes: string = decoded[1];

    // Map function to try parsing bytes as string
    const parsedError = this.parseCallResultError(revertReasonBytes);
    return parsedError;
  }

  private static parseCallResultError(revertReason: string): string {
    const RETURN_DATA_STRING_PREFIX = '0x08c379a0';
    if (revertReason.match(RETURN_DATA_STRING_PREFIX)) {
      const strippedReturnValue = revertReason.replace(RETURN_DATA_STRING_PREFIX, '0x');
      const result = ethers.utils.defaultAbiCoder.decode(['string'], strippedReturnValue);
      return result[0];
    }
    return 'Unknown Relay Adapt error.';
  }
}
