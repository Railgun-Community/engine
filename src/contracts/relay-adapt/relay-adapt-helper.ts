import { ethers, PopulatedTransaction, BigNumber } from 'ethers';
import { DepositInput, SerializedTransaction } from '../../models/formatted-types';
import { ERC20Deposit } from '../../note';
import { formatToByteLength, ByteLength } from '../../utils/bytes';
import { Wallet } from '../../wallet';

class RelayAdaptHelper {
  static generateRelayDepositInputs(wallet: Wallet, random: string, depositTokens: string[]) {
    const relayDeposits = RelayAdaptHelper.createRelayDeposits(
      wallet.masterPublicKey,
      random,
      depositTokens,
    );
    const viewingPrivateKey = wallet.getViewingKeyPair().privateKey;
    return RelayAdaptHelper.createRelayDepositInputs(viewingPrivateKey, relayDeposits);
  }

  private static createRelayDeposits(
    masterPublicKey: bigint,
    random: string,
    tokens: string[],
  ): ERC20Deposit[] {
    return tokens.map((token) => {
      return new ERC20Deposit(masterPublicKey, random, 0n, token);
    });
  }

  private static createRelayDepositInputs(
    viewingPrivateKey: Uint8Array,
    relayDeposits: ERC20Deposit[],
  ): DepositInput[] {
    return relayDeposits.map((deposit) => {
      return deposit.serialize(viewingPrivateKey);
    });
  }

  static validateDepositInputs(depositInputs: DepositInput[]) {
    const { preImage } = depositInputs[0];
    depositInputs.forEach((depositInput) => {
      if (depositInput.preImage.npk !== preImage.npk) {
        throw new Error('Relay deposits must all contain the same npk/random.');
      }
    });
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
  static getRelayAdaptParams(
    serializedTransactions: SerializedTransaction[],
    random: string,
    requireSuccess: boolean,
    calls: PopulatedTransaction[],
  ): string {
    const formattedRandom = formatToByteLength(random, ByteLength.UINT_256, true);
    const abiCoder = ethers.utils.defaultAbiCoder;
    const additionalData = abiCoder.encode(
      ['uint256', 'bool', 'tuple(address to, bytes data, uint256 value)[] calls'],
      [formattedRandom, requireSuccess, this.formatCalls(calls)],
    );

    return RelayAdaptHelper.getAdaptParamsHash(serializedTransactions, additionalData);
  }

  /**
   * Strips all unnecessary fields from populated transactions
   *
   * @param {object[]} calls - calls list
   * @returns {object[]} formatted calls
   */
  static formatCalls(calls: PopulatedTransaction[]): PopulatedTransaction[] {
    return calls.map((call) => ({
      from: call.from,
      to: call.to,
      data: call.data,
      value: call.value ?? BigNumber.from(0),
    }));
  }
}

export { RelayAdaptHelper };
