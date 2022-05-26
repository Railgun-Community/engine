import { Provider } from '@ethersproject/abstract-provider';
import { BigNumber, CallOverrides, Contract, ethers, PopulatedTransaction } from 'ethers';
import { ABIRelayAdapt } from '../../abi/abi';
import { DepositInput, SerializedTransaction, TokenData } from '../../models/formatted-types';
import { ERC20Deposit, ERC20WithdrawNote } from '../../note';
import { ByteLength, formatToByteLength, random as bytesRandom } from '../../utils/bytes';

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

  async depositBaseToken(depositInput: DepositInput): Promise<PopulatedTransaction> {
    const orderedCalls: PopulatedTransaction[] = await Promise.all([
      this.contract.populateTransaction.wrapAllBase(),
      this.relayDeposit([depositInput]),
    ]);

    // Empty transactions array for deposit.
    const transactions: SerializedTransaction[] = [];
    const random = bytesRandom(16);
    const requireSuccess = true;

    return this.relay(transactions, random, requireSuccess, orderedCalls, {
      value: depositInput.preImage.value,
    });
  }

  static generateRelayDeposits(masterPublicKey: bigint, tokens: string[]): ERC20Deposit[] {
    const random = bytesRandom(16);
    return tokens.map((token) => {
      return new ERC20Deposit(masterPublicKey, random, 0n, token);
    });
  }

  private static generateRelayDepositInputs(
    viewingPrivateKey: Uint8Array,
    relayDeposits: ERC20Deposit[],
  ): DepositInput[] {
    return relayDeposits.map((deposit) => {
      return deposit.serialize(viewingPrivateKey);
    });
  }

  /**
   * @returns Populated transaction
   */
  private relayDeposit(depositInputs: DepositInput[]): Promise<PopulatedTransaction> {
    const tokens: TokenData[] = depositInputs.map((depositInput) => depositInput.preImage.token);
    const { encryptedRandom, preImage } = depositInputs[0];
    depositInputs.forEach((depositInput) => {
      if (depositInput.preImage.npk !== preImage.npk) {
        throw new Error('Relay deposits must all contain the same random.');
      }
    });
    return this.contract.populateTransaction.deposit(tokens, encryptedRandom, preImage.npk);
  }

  async getRelayAdaptParamsWithdrawBaseToken(
    dummyWithdrawTransactions: SerializedTransaction[],
    withdrawNote: ERC20WithdrawNote,
    random: string,
  ): Promise<string> {
    const orderedCalls: PopulatedTransaction[] = await Promise.all([
      this.contract.populateTransaction.unwrapAllBase(),
      this.relaySend(withdrawNote.token, withdrawNote.withdrawAddress),
    ]);

    const requireSuccess = true;

    return RelayAdaptContract.getRelayAdaptParams(
      dummyWithdrawTransactions,
      random,
      requireSuccess,
      orderedCalls,
    );
  }

  async withdrawBaseToken(
    withdrawTransactions: SerializedTransaction[],
    withdrawNote: ERC20WithdrawNote,
    random: string,
  ): Promise<PopulatedTransaction> {
    const orderedCalls: PopulatedTransaction[] = await Promise.all([
      this.contract.populateTransaction.unwrapAllBase(),
      this.relaySend(withdrawNote.token, withdrawNote.withdrawAddress),
    ]);

    const requireSuccess = true;

    return this.relay(withdrawTransactions, random, requireSuccess, orderedCalls, {});
  }

  /**
   * @returns Populated transaction
   */
  private relaySend(tokenData: TokenData, toAddress: string): Promise<PopulatedTransaction> {
    return this.contract.populateTransaction.send(tokenData, toAddress);
  }

  async getRelayAdaptParamsCrossContractCalls(
    dummyWithdrawTransactions: SerializedTransaction[],
    crossContractCalls: PopulatedTransaction[],
    relayDepositInputs: DepositInput[],
    random: string,
  ): Promise<string> {
    const orderedCalls: PopulatedTransaction[] = [
      ...crossContractCalls,
      await this.relayDeposit(relayDepositInputs),
    ];

    const requireSuccess = true;

    return RelayAdaptContract.getRelayAdaptParams(
      dummyWithdrawTransactions,
      random,
      requireSuccess,
      orderedCalls,
    );
  }

  async crossContractCalls(
    withdrawTransactions: SerializedTransaction[],
    crossContractCalls: PopulatedTransaction[],
    relayDepositInputs: DepositInput[],
    random: string,
  ): Promise<PopulatedTransaction> {
    const orderedCalls: PopulatedTransaction[] = [
      ...crossContractCalls,
      await this.relayDeposit(relayDepositInputs),
    ];

    const requireSuccess = true;
    return this.relay(withdrawTransactions, random, requireSuccess, orderedCalls, {});
  }

  /**
   * Generates Relay call given a list of serialized transactions.
   * @returns populated transaction
   */
  private relay(
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
      RelayAdaptContract.formatCalls(calls),
      overrides,
    );
  }

  /**
   * Calculate hash of adapt params.
   *
   * @param {SerializedTransaction[]} serializedTransactions - serialized transactions
   * @param {string} additionalData - additional byte data to add to adapt params
   * @returns {string} adapt params
   */
  private static getAdaptParamsHash(
    serializedTransactions: SerializedTransaction[],
    additionalData: string,
  ): string {
    const firstNullifiers = serializedTransactions.map((tx) => tx.nullifiers[0]);

    const abiCoder = ethers.utils.defaultAbiCoder;
    return ethers.utils.keccak256(
      abiCoder.encode(
        ['uint256[]', 'uint256', 'bytes'],
        [firstNullifiers, serializedTransactions.length, additionalData],
      ),
    );
  }

  /**
   * Get relay adapt params field.
   * Hashes transaction data and params to ensure that transaction is not modified by MITM.
   *
   * @param {SerializedTransaction[]} serializedTransactions - serialized transactions
   * @param {string} random - random value
   * @param {boolean} requireSuccess - require success on calls
   * @param {object[]} calls - calls list
   * @returns {string} adapt params
   */
  private static getRelayAdaptParams(
    serializedTransactions: SerializedTransaction[],
    random: string,
    requireSuccess: boolean,
    calls: PopulatedTransaction[],
  ): string {
    const formattedRandom = formatToByteLength(random, ByteLength.UINT_256, true);
    const abiCoder = ethers.utils.defaultAbiCoder;
    const additionalData = abiCoder.encode(
      ['uint256', 'bool', 'tuple(address to, bytes data, uint256 value)[] calls'],
      [formattedRandom, requireSuccess, calls],
    );

    return RelayAdaptContract.getAdaptParamsHash(serializedTransactions, additionalData);
  }

  /**
   * Strips all unnecessary fields from populated transactions
   *
   * @param {object[]} calls - calls list
   * @returns {object[]} formatted calls
   */
  private static formatCalls(calls: PopulatedTransaction[]): PopulatedTransaction[] {
    return calls.map((call) => ({
      to: call.to,
      data: call.data,
      value: call.value ?? BigNumber.from(0),
    }));
  }
}

export { RelayAdaptContract };
