import { Provider, TransactionReceipt } from '@ethersproject/abstract-provider';
import { BigNumber, CallOverrides, Contract, ethers, PopulatedTransaction } from 'ethers';
import { ABIRelayAdapt } from '../../abi/abi';
import {
  DepositInput,
  SerializedTransaction,
  TokenData,
  TokenType,
} from '../../models/formatted-types';
import { random as bytesRandom } from '../../utils/bytes';
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
export const MINIMUM_RELAY_ADAPT_CROSS_CONTRACT_CALLS_GAS_LIMIT = BigNumber.from(2_300_000);
// Contract call needs ~50,000 less gas than the gasLimit setting.
const MINIMUM_RELAY_ADAPT_CROSS_CONTRACT_CALLS_MINIMUM_GAS_FOR_CONTRACT = BigNumber.from(2_240_000);

class RelayAdaptContract {
  private readonly contract: Contract;

  readonly address: string;

  /**
   * Connect to Railgun instance on network
   * @param relayAdaptContractAddress - address of Railgun relay adapt contract
   * @param provider - Network provider
   */
  constructor(relayAdaptContractAddress: string, provider: Provider) {
    this.address = relayAdaptContractAddress;
    this.contract = new Contract(relayAdaptContractAddress, ABIRelayAdapt, provider);
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

  static getCallResultError(receipt: TransactionReceipt): string | undefined {
    const iface = new ethers.utils.Interface(ABIRelayAdapt);
    const topic = iface.getEventTopic(RelayAdaptEvent.CallResult);
    let results: {
      success: boolean;
      error?: string;
    }[] = [];

    // eslint-disable-next-line no-restricted-syntax
    for (const log of receipt.logs) {
      if (log.topics[0] === topic) {
        const parsed = iface.parseLog(log);
        results = parsed.args.callResults.map((callResult: CallResult) => {
          if (!callResult.success) {
            return {
              success: false,
              error: RelayAdaptContract.parseCallResultError(callResult.returnData),
            };
          }
          return {
            success: true,
          };
        });
      }
    }

    if (!results.length) {
      throw new Error('Call Result events not found.');
    }
    const firstErrorResult = results.find((r) => r.error);
    if (firstErrorResult) {
      return firstErrorResult.error as string;
    }
    return undefined;
  }

  private static parseCallResultError(returnData: string): string {
    if (returnData.length) {
      return returnData;
    }

    return 'Unknown Relay Adapt error.';
  }
}

export { RelayAdaptContract };
