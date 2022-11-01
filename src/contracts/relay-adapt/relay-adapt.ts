import { Provider } from '@ethersproject/abstract-provider';
import { BigNumber, CallOverrides, Contract, ethers, PopulatedTransaction } from 'ethers';
import { Result } from 'ethers/lib/utils';
import { ABIRelayAdapt, ABIRelayAdaptLegacyEvents } from '../../abi/abi';
import { TokenData, TokenType, TransactionReceiptLog } from '../../models/formatted-types';
import { RelayAdapt } from '../../typechain-types/contracts/adapt/Relay.sol/RelayAdapt';
import {
  ShieldRequestStruct,
  TransactionStruct,
} from '../../typechain-types/contracts/logic/RailgunSmartWallet';
import { randomHex as bytesRandom } from '../../utils/bytes';
import { ZERO_ADDRESS } from '../../utils/constants';
import { RelayAdaptHelper } from './relay-adapt-helper';

enum RelayAdaptEvent {
  CallResult = 'CallResult',
}

type CallResult = {
  success: boolean;
  returnData: string;
};

// A low (or undefined) gas limit can cause the Relay Adapt module to fail.
// Set a high default that can be overridden by a developer.
const MINIMUM_RELAY_ADAPT_CROSS_CONTRACT_CALLS_GAS_LIMIT = BigNumber.from(2_500_000);
// Contract call needs ~50,000 less gas than the gasLimit setting.
const MINIMUM_RELAY_ADAPT_CROSS_CONTRACT_CALLS_MINIMUM_GAS_FOR_CONTRACT = BigNumber.from(2_420_000);

class RelayAdaptContract {
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

    // Empty transactions array for shield.
    const transactions: TransactionStruct[] = [];
    const random = bytesRandom(16);
    const requireSuccess = true;

    return this.populateRelay(transactions, random, requireSuccess, orderedCalls, {
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
    value: string,
  ): Promise<PopulatedTransaction[]> {
    const baseTokenData: TokenData = {
      tokenAddress: ZERO_ADDRESS,
      tokenType: TokenType.ERC20,
      tokenSubID: ZERO_ADDRESS,
    };
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
    value: string,
  ): Promise<string> {
    const orderedCalls: PopulatedTransaction[] = await this.getOrderedCallsForUnshieldBaseToken(
      unshieldAddress,
      value,
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
    random: string,
    value: string,
  ): Promise<PopulatedTransaction> {
    const orderedCalls: PopulatedTransaction[] = await this.getOrderedCallsForUnshieldBaseToken(
      unshieldAddress,
      value,
    );

    const requireSuccess = true;
    return this.populateRelay(transactions, random, requireSuccess, orderedCalls, {});
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
    random: string,
  ): Promise<PopulatedTransaction> {
    const orderedCalls: PopulatedTransaction[] = await this.getOrderedCallsForCrossContractCalls(
      crossContractCalls,
      relayShieldRequests,
    );

    // If the cross contract call fails, the Relayer Fee and Shields will continue to process.
    const requireSuccess = false;

    const populatedTransaction = await this.populateRelay(
      unshieldTransactions,
      random,
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
   * Generates Relay call given a list of serialized transactions.
   * @returns populated transaction
   */
  private async populateRelay(
    transactions: TransactionStruct[],
    random: string,
    requireSuccess: boolean,
    calls: PopulatedTransaction[],
    overrides: CallOverrides,
    minimumGasLimit = BigNumber.from(0),
  ): Promise<PopulatedTransaction> {
    const actionData: RelayAdapt.ActionDataStruct = RelayAdaptHelper.getActionData(
      random,
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

  static getCallResultError(receiptLogs: TransactionReceiptLog[]): Optional<string> {
    const iface = new ethers.utils.Interface(ABIRelayAdaptLegacyEvents);
    const topic = iface.getEventTopic(RelayAdaptEvent.CallResult);
    const results: CallResult[] = [];

    try {
      // eslint-disable-next-line no-restricted-syntax
      for (const log of receiptLogs) {
        if (log.topics[0] === topic) {
          const parsed = this.customRelayAdaptParse(log);
          results.push(...parsed);
        }
      }
    } catch (err) {
      throw new Error('Relay Adapt parsing error.');
    }
    if (!results.length) {
      throw new Error('CallResult events not found.');
    }

    const firstErrorResult = results.find((r) => !r.success);
    if (firstErrorResult) {
      return firstErrorResult.returnData;
    }
    return undefined;
  }

  private static customRelayAdaptParse(log: TransactionReceiptLog): CallResult[] {
    // Force parse as bytes
    const decoded: Result = ethers.utils.defaultAbiCoder.decode(
      ['tuple(bool success, bytes returnData)[]'],
      log.data,
    );

    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const decodedCallResults: CallResult[] = decoded[0];

    // Map function to try parsing bytes as string
    return decodedCallResults.map((callResult: CallResult) => {
      // Decode and strip non-printable-chars
      const returnData = this.parseCallResultError(callResult.returnData);

      return {
        success: callResult.success,
        returnData,
      };
    });
  }

  private static parseCallResultError(returnData: string): string {
    const RETURN_DATA_STRING_PREFIX = '0x08c379a0';
    if (returnData.match(RETURN_DATA_STRING_PREFIX)) {
      const strippedReturnValue = returnData.replace(RETURN_DATA_STRING_PREFIX, '0x');
      const result = ethers.utils.defaultAbiCoder.decode(['string'], strippedReturnValue);
      return result[0];
    }
    return 'Unknown Relay Adapt error.';
  }
}

export { RelayAdaptContract, MINIMUM_RELAY_ADAPT_CROSS_CONTRACT_CALLS_GAS_LIMIT };
