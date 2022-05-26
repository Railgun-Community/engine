import { Provider } from '@ethersproject/abstract-provider';
import { BigNumber, CallOverrides, Contract, ethers, PopulatedTransaction } from 'ethers';
import { ABIRelayAdapt } from '../../abi/abi';
import { DepositInput, SerializedTransaction } from '../../models/formatted-types';
import { ByteLength, formatToByteLength, random as bytesRandom } from '../../utils/bytes';

class RelayAdaptContract {
  contract: Contract;

  // Contract address
  address: string;

  /**
   * Connect to Railgun instance on network
   * @param address - address of Railgun instance (Proxy contract)
   * @param provider - Network provider
   */
  constructor(address: string, provider: Provider) {
    this.address = address;
    this.contract = new Contract(address, ABIRelayAdapt, provider);
  }

  async depositBaseToken(depositInput: DepositInput): Promise<PopulatedTransaction> {
    const orderedCalls: PopulatedTransaction[] = await Promise.all([
      this.contract.populateTransaction.wrapAllBase(),
      this.relayDeposit(depositInput),
    ]);

    // Empty transactions array for deposit.
    const transactions: SerializedTransaction[] = [];
    const requireSuccess = true;

    return this.relay(transactions, requireSuccess, orderedCalls, {
      value: depositInput.preImage.value,
    });
  }

  /**
   * @returns Populated transaction
   */
  private relayDeposit({ preImage, encryptedRandom }: DepositInput): Promise<PopulatedTransaction> {
    return this.contract.populateTransaction.deposit(
      [preImage.token],
      encryptedRandom,
      preImage.npk,
      // formatToByteLength(preImage.npk, ByteLength.UINT_256, true),
    );
  }

  /**
   * Generates Relay call given a list of serialized transactions.
   * @returns populated transaction
   */
  private relay(
    transactions: SerializedTransaction[],
    requireSuccess: boolean,
    calls: PopulatedTransaction[],
    overrides: CallOverrides,
  ): Promise<PopulatedTransaction> {
    const random = formatToByteLength(bytesRandom(16), ByteLength.UINT_256, true);
    return this.contract.populateTransaction.relay(
      transactions,
      random,
      requireSuccess,
      RelayAdaptContract.formatCalls(calls),
      overrides,
    );
  }

  /**
   * Calculate hash of adapt params.
   *
   * @param {object[]} transactions - transactions
   * @param {string} additionalData - additional byte data to add to adapt params
   * @returns {string} adapt params
   */
  private static getAdaptParamsHash(
    transactions: SerializedTransaction[],
    additionalData: string,
  ): string {
    const firstNullifiers = transactions.map((transaction) => transaction.nullifiers[0]);

    const abiCoder = ethers.utils.defaultAbiCoder;
    return ethers.utils.keccak256(
      abiCoder.encode(
        ['uint256[]', 'uint256', 'bytes'],
        [firstNullifiers, transactions.length, additionalData],
      ),
    );
  }

  /**
   * Get relay adapt params field.
   * Hashes transaction data and params to ensure that transaction is not modified by MITM.
   *
   * @param {object[]} transactions - transactions
   * @param {bigint} random - random value
   * @param {boolean} requireSuccess - require success on calls
   * @param {object[]} calls - calls list
   * @returns {string} adapt params
   */
  private static getRelayAdaptParams(
    transactions: SerializedTransaction[],
    random: bigint,
    requireSuccess: boolean,
    calls: PopulatedTransaction[],
  ): string {
    const abiCoder = ethers.utils.defaultAbiCoder;
    const additionalData = abiCoder.encode(
      ['uint256', 'bool', 'tuple(address to, bytes data, uint256 value)[] calls'],
      [random, requireSuccess, calls],
    );

    return RelayAdaptContract.getAdaptParamsHash(transactions, additionalData);
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
