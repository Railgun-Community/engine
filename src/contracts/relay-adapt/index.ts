import { Provider } from '@ethersproject/abstract-provider';
import { CallOverrides, Contract, PopulatedTransaction } from 'ethers';
import { ABIRelayAdapt } from '../../abi/abi';
import { DepositInput, SerializedTransaction, TokenData } from '../../models/formatted-types';
import { ERC20WithdrawNote } from '../../note';
import { ByteLength, formatToByteLength, random as bytesRandom } from '../../utils/bytes';
import { RelayAdaptHelper } from './relay-adapt-helper';

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
    withdrawNote: ERC20WithdrawNote,
  ): Promise<PopulatedTransaction[]> {
    return Promise.all([
      this.contract.populateTransaction.unwrapAllBase(),
      this.populateRelaySend([withdrawNote.token], withdrawNote.withdrawAddress),
    ]);
  }

  async getRelayAdaptParamsWithdrawBaseToken(
    dummyTransactions: SerializedTransaction[],
    withdrawNote: ERC20WithdrawNote,
    random: string,
  ): Promise<string> {
    const orderedCalls: PopulatedTransaction[] = await this.getOrderedCallsForWithdrawBaseToken(
      withdrawNote,
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
    withdrawNote: ERC20WithdrawNote,
    random: string,
  ): Promise<PopulatedTransaction> {
    const orderedCalls: PopulatedTransaction[] = await this.getOrderedCallsForWithdrawBaseToken(
      withdrawNote,
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

    const requireSuccess = true;
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

    const requireSuccess = true;
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
}

export { RelayAdaptContract };
