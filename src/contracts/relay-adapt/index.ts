import { Provider } from '@ethersproject/abstract-provider';
import { BigNumber, CallOverrides, Contract, ethers, PopulatedTransaction } from 'ethers';
import { Result } from 'ethers/lib/utils';
import { ABIRelayAdapt } from '../../abi/abi';
import {
  DepositInput,
  SerializedTransaction,
  TokenData,
  TokenType,
  TransactionReceiptLog,
} from '../../models/formatted-types';
import { RelayAdapt } from '../../typechain-types/contracts/adapt/relay/Relay.sol/RelayAdapt';
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
export const MINIMUM_RELAY_ADAPT_CROSS_CONTRACT_CALLS_GAS_LIMIT = BigNumber.from(2_500_000);
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

  async populateDepositBaseToken(depositInput: DepositInput): Promise<PopulatedTransaction> {
    const orderedCalls: PopulatedTransaction[] = await Promise.all([
      this.contract.populateTransaction.wrapAllBase(),
      this.populateRelayDeposits([depositInput]),
    ]);

    // Empty transactions array for deposit.
    const transactions: SerializedTransaction[] = [];
    const random = bytesRandom(16);
    const requireSuccess = true;

    return this.populateRelay(transactions, random, requireSuccess, orderedCalls, {
      value: depositInput.preImage.value,
    });
  }

  /**
   * @returns Populated transaction
   */
  private populateRelayDeposits(depositInputs: DepositInput[]): Promise<PopulatedTransaction> {
    const tokens: TokenData[] = depositInputs.map((depositInput) => depositInput.preImage.token);
    RelayAdaptHelper.validateDepositInputs(depositInputs);
    const { encryptedRandom, preImage } = depositInputs[0];
    return this.contract.populateTransaction.deposit(tokens, encryptedRandom, preImage.npk);
  }

  private async getOrderedCallsForWithdrawBaseToken(
    withdrawAddress: string,
  ): Promise<PopulatedTransaction[]> {
    const baseTokenData: TokenData = {
      tokenAddress: ZERO_ADDRESS,
      tokenType: TokenType.ERC20,
      tokenSubID: ZERO_ADDRESS,
    };

    return Promise.all([
      this.contract.populateTransaction.unwrapAllBase(),
      this.populateRelaySend([baseTokenData], withdrawAddress),
    ]);
  }

  async getRelayAdaptParamsWithdrawBaseToken(
    dummyTransactions: SerializedTransaction[],
    withdrawAddress: string,
    random: string,
  ): Promise<string> {
    const orderedCalls: PopulatedTransaction[] = await this.getOrderedCallsForWithdrawBaseToken(
      withdrawAddress,
    );

    const requireSuccess = true;
    return RelayAdaptHelper.getRelayAdaptParams(
      dummyTransactions,
      random,
      requireSuccess,
      orderedCalls,
    );
  }

  async populateWithdrawBaseToken(
    transactions: SerializedTransaction[],
    withdrawAddress: string,
    random: string,
  ): Promise<PopulatedTransaction> {
    const orderedCalls: PopulatedTransaction[] = await this.getOrderedCallsForWithdrawBaseToken(
      withdrawAddress,
    );

    const requireSuccess = true;
    return this.populateRelay(transactions, random, requireSuccess, orderedCalls, {});
  }

  /**
   * @returns Populated transaction
   */
  private populateRelaySend(
    tokenData: TokenData[],
    toAddress: string,
  ): Promise<PopulatedTransaction> {
    return this.contract.populateTransaction.send(tokenData, toAddress);
  }

  private async getOrderedCallsForCrossContractCalls(
    crossContractCalls: PopulatedTransaction[],
    relayDepositInputs: DepositInput[],
  ): Promise<PopulatedTransaction[]> {
    const orderedCallPromises: PopulatedTransaction[] = [...crossContractCalls];
    if (relayDepositInputs.length) {
      orderedCallPromises.push(await this.populateRelayDeposits(relayDepositInputs));
    }
    return orderedCallPromises;
  }

  async getRelayAdaptParamsCrossContractCalls(
    dummyWithdrawTransactions: SerializedTransaction[],
    crossContractCalls: PopulatedTransaction[],
    relayDepositInputs: DepositInput[],
    random: string,
  ): Promise<string> {
    const orderedCalls: PopulatedTransaction[] = await this.getOrderedCallsForCrossContractCalls(
      crossContractCalls,
      relayDepositInputs,
    );

    // If the cross contract call fails, the Relayer Fee and Deposits will continue to process.
    const requireSuccess = false;

    return RelayAdaptHelper.getRelayAdaptParams(
      dummyWithdrawTransactions,
      random,
      requireSuccess,
      orderedCalls,
      MINIMUM_RELAY_ADAPT_CROSS_CONTRACT_CALLS_MINIMUM_GAS_FOR_CONTRACT,
    );
  }

  async populateCrossContractCalls(
    withdrawTransactions: SerializedTransaction[],
    crossContractCalls: PopulatedTransaction[],
    relayDepositInputs: DepositInput[],
    random: string,
  ): Promise<PopulatedTransaction> {
    const orderedCalls: PopulatedTransaction[] = await this.getOrderedCallsForCrossContractCalls(
      crossContractCalls,
      relayDepositInputs,
    );

    // If the cross contract call fails, the Relayer Fee and Deposits will continue to process.
    const requireSuccess = false;

    const populatedTransaction = await this.populateRelay(
      withdrawTransactions,
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
    serializedTransactions: SerializedTransaction[],
    random: string,
    requireSuccess: boolean,
    calls: PopulatedTransaction[],
    overrides: CallOverrides,
    minimumGas: BigNumber = BigNumber.from(1),
  ): Promise<PopulatedTransaction> {
    const formattedRandom = RelayAdaptHelper.formatRandom(random);
    const minGas = RelayAdaptHelper.formatMinimumGas(minimumGas);
    const populatedTransaction = await this.contract.populateTransaction.relay(
      serializedTransactions,
      formattedRandom,
      requireSuccess,
      minGas,
      RelayAdaptHelper.formatCalls(calls),
      overrides,
    );
    return populatedTransaction;
  }

  static getCallResultError(receiptLogs: TransactionReceiptLog[]): Optional<string> {
    const iface = new ethers.utils.Interface(ABIRelayAdapt);
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

export { RelayAdaptContract };
