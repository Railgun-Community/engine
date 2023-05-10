import { Provider } from '@ethersproject/abstract-provider';
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

  async getRelayAdaptParamsCrossContractCalls(
    dummyUnshieldTransactions: TransactionStruct[],
    crossContractCalls: PopulatedTransaction[],
    relayShieldRequests: ShieldRequestStruct[],
    random: string,
  ): Promise<string> {
    const orderedCalls: PopulatedTransaction[] = await this.getOrderedCallsForCrossContractCalls(
      crossContractCalls,
      relayShieldRequests,
    );

    // If the cross contract call fails, the Relayer Fee and Shields will continue to process.
    const requireSuccess = false;

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
  ): Promise<PopulatedTransaction> {
    const orderedCalls: PopulatedTransaction[] = await this.getOrderedCallsForCrossContractCalls(
      crossContractCalls,
      relayShieldRequests,
    );

    // If the cross contract call fails, the Relayer Fee and Shields will continue to process.
    const requireSuccess = false;

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
          const parsedError = this.customRelayAdaptErrorParse(log);
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

  private static customRelayAdaptErrorParse(log: TransactionReceiptLog): Optional<string> {
    // Force parse as bytes
    const decoded: Result = ethers.utils.defaultAbiCoder.decode(
      ['tuple(uint256 callIndex, bytes revertReason)'],
      log.data,
    );

    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
    const revertReasonBytes: string = decoded[0][1];

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
