import { Provider, TransactionReceipt } from '@ethersproject/abstract-provider';
import { CallOverrides, Contract, ethers, PopulatedTransaction } from 'ethers';
import { ABIRelayAdapt } from '../../abi/abi';
import {
  DepositInput,
  SerializedTransaction,
  TokenData,
  TokenType,
} from '../../models/formatted-types';
import { ByteLength, formatToByteLength, random as bytesRandom } from '../../utils/bytes';
import { ZERO_ADDRESS } from '../../utils/constants';
import { RelayAdaptHelper } from './relay-adapt-helper';

const RETURN_DATA_STRING_PREFIX = '0x08c379a0';

enum RelayAdaptEvent {
  CallResult = 'CallResult',
}

type CallResult = {
  success: boolean;
  returnData: string;
};

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
    return Promise.all([
      ...crossContractCalls,
      await this.populateRelayDeposits(relayDepositInputs),
    ]);
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

    return this.populateRelay(withdrawTransactions, random, requireSuccess, orderedCalls, {});
  }

  /**
   * Generates Relay call given a list of serialized transactions.
   * @returns populated transaction
   */
  private populateRelay(
    serializedTransactions: SerializedTransaction[],
    random: string,
    requireSuccess: boolean,
    calls: PopulatedTransaction[],
    overrides: CallOverrides,
  ): Promise<PopulatedTransaction> {
    const formattedRandom = formatToByteLength(random, ByteLength.UINT_256, true);
    return this.contract.populateTransaction.relay(
      serializedTransactions,
      formattedRandom,
      requireSuccess,
      RelayAdaptHelper.formatCalls(calls),
      overrides,
    );
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
    if (returnData.match(RETURN_DATA_STRING_PREFIX)) {
      const strippedReturnValue = returnData.replace(RETURN_DATA_STRING_PREFIX, '0x');
      const result = ethers.utils.defaultAbiCoder.decode(['string'], strippedReturnValue);
      return result[0];
    }

    return 'Unknown Relay Adapt error.';
  }
}

export { RelayAdaptContract };
