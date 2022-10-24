import { ethers, PopulatedTransaction, BigNumber } from 'ethers';
import { formatToByteLength, ByteLength, randomHex, hexToBytes } from '../../utils/bytes';
import { RailgunWallet } from '../../wallet/railgun-wallet';
import { RelayAdapt } from '../../typechain-types/contracts/adapt/Relay.sol/RelayAdapt';
import { ShieldNote } from '../../note/shield-note';
import {
  ShieldRequestStruct,
  TransactionStruct,
} from '../../typechain-types/contracts/logic/RailgunSmartWallet';

class RelayAdaptHelper {
  static generateRelayShieldRequests(
    wallet: RailgunWallet,
    random: string,
    shieldTokens: string[],
  ): Promise<ShieldRequestStruct[]> {
    const relayShields = RelayAdaptHelper.createRelayShields(
      wallet.masterPublicKey,
      random,
      shieldTokens,
    );
    return Promise.all(
      relayShields.map((shield) => {
        // Random private key for Relay Adapt shield.
        const shieldPrivateKey = hexToBytes(randomHex(32));
        return shield.serialize(shieldPrivateKey, wallet.addressKeys.viewingPublicKey);
      }),
    );
  }

  private static createRelayShields(
    masterPublicKey: bigint,
    random: string,
    tokens: string[],
  ): ShieldNote[] {
    return tokens.map((token) => {
      return new ShieldNote(masterPublicKey, random, 0n, token);
    });
  }

  static validateShieldRequests(shieldRequests: ShieldRequestStruct[]) {
    const { preimage } = shieldRequests[0];
    shieldRequests.forEach((shieldInput) => {
      if (shieldInput.preimage.npk !== preimage.npk) {
        throw new Error('Relay shields must all contain the same npk/random.');
      }
    });
  }

  /**
   * Calculate hash of adapt params.
   *
   * @param transactions - serialized transactions
   * @param additionalData - additional byte data to add to adapt params
   * @returns adapt params
   */
  static getActionData(
    random: string,
    requireSuccess: boolean,
    calls: PopulatedTransaction[],
    minimumGasLimit: BigNumber,
  ): RelayAdapt.ActionDataStruct {
    const formattedRandom = RelayAdaptHelper.formatRandom(random);
    const minGasLimit = RelayAdaptHelper.formatMinimumGas(minimumGasLimit);
    return {
      random: formattedRandom,
      requireSuccess,
      minGasLimit,
      calls: RelayAdaptHelper.formatCalls(calls),
    };
  }

  /**
   * Get relay adapt params field.
   * Hashes transaction data and params to ensure that transaction is not modified by MITM.
   *
   * @param transactions - serialized transactions
   * @param random - random value
   * @param requireSuccess - require success on calls
   * @param calls - calls list
   * @returns adapt params
   */
  static getRelayAdaptParams(
    transactions: TransactionStruct[],
    random: string,
    requireSuccess: boolean,
    calls: PopulatedTransaction[],
    minimumGas: BigNumber = BigNumber.from(1),
  ): string {
    const nullifiers = transactions.map((transaction) => transaction.nullifiers);
    const actionData = RelayAdaptHelper.getActionData(random, requireSuccess, calls, minimumGas);

    const abiCoder = ethers.utils.defaultAbiCoder;
    const preimage = abiCoder.encode(
      [
        'bytes32[][] nullifiers',
        'uint256 transactionsLength',
        'tuple(bytes31 random, bool requireSuccess, uint256 minGasLimit, tuple(address to, bytes data, uint256 value)[] calls) actionData',
      ],
      [nullifiers, transactions.length, actionData],
    );

    return ethers.utils.keccak256(preimage);
  }

  /**
   * Strips all unnecessary fields from populated transactions
   *
   * @param {object[]} calls - calls list
   * @returns {object[]} formatted calls
   */
  static formatCalls(calls: PopulatedTransaction[]): RelayAdapt.CallStruct[] {
    return calls.map((call) => ({
      to: call.to || '',
      data: call.data || '',
      value: call.value || BigNumber.from(0),
    }));
  }

  static formatRandom(random: string): string {
    return formatToByteLength(random, ByteLength.UINT_256, true);
  }

  static formatMinimumGas(minimumGas: BigNumber): string {
    return formatToByteLength(minimumGas.toHexString(), ByteLength.UINT_256, true);
  }
}

export { RelayAdaptHelper };
