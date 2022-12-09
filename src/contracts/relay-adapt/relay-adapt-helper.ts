import { ethers, PopulatedTransaction, BigNumber } from 'ethers';
import { randomHex, hexToBytes } from '../../utils/bytes';
import { RelayAdapt } from '../../typechain-types/contracts/adapt/Relay.sol/RelayAdapt';
import {
  ShieldRequestStruct,
  TransactionStruct,
} from '../../typechain-types/contracts/logic/RailgunSmartWallet';
import { ShieldNoteERC20 } from '../../note/erc20/shield-note-erc20';
import { AddressData } from '../../key-derivation';

class RelayAdaptHelper {
  static generateRelayShieldRequests(
    addressData: AddressData,
    random: string,
    shieldTokens: string[],
  ): Promise<ShieldRequestStruct[]> {
    const relayShields = RelayAdaptHelper.createRelayShieldERC20s(
      addressData.masterPublicKey,
      random,
      shieldTokens,
    );
    return Promise.all(
      relayShields.map((shield) => {
        // Random private key for Relay Adapt shield.
        const shieldPrivateKey = hexToBytes(randomHex(32));
        return shield.serialize(shieldPrivateKey, addressData.viewingPublicKey);
      }),
    );
  }

  private static createRelayShieldERC20s(
    masterPublicKey: bigint,
    random: string,
    tokens: string[],
  ): ShieldNoteERC20[] {
    return tokens.map((token) => {
      return new ShieldNoteERC20(masterPublicKey, random, 0n, token);
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
   * Format action data field for relay call.
   */
  static getActionData(
    random: string,
    requireSuccess: boolean,
    calls: PopulatedTransaction[],
    minGasLimit: BigNumber,
  ): RelayAdapt.ActionDataStruct {
    const formattedRandom = RelayAdaptHelper.formatRandom(random);
    return {
      random: formattedRandom,
      requireSuccess,
      minGasLimit,
      calls: RelayAdaptHelper.formatCalls(calls),
    };
  }

  /**
   * Get relay adapt params hash.
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
    minGasLimit = BigNumber.from(0),
  ): string {
    const nullifiers = transactions.map((transaction) => transaction.nullifiers);
    const actionData = RelayAdaptHelper.getActionData(random, requireSuccess, calls, minGasLimit);

    const abiCoder = ethers.utils.defaultAbiCoder;
    const preimage = abiCoder.encode(
      [
        'bytes32[][] nullifiers',
        'uint256 transactionsLength',
        'tuple(bytes31 random, bool requireSuccess, uint256 minGasLimit, tuple(address to, bytes data, uint256 value)[] calls) actionData',
      ],
      [nullifiers, transactions.length, actionData],
    );

    // Test: ['0x05802951a46d9e999151eb0eb9e4c7c1260b7ee88539011c207dc169c4dd17ee', 1, actionData]
    //
    // actionData:
    //
    // calls:
    //  0:
    // {to: '0x67d269191c92Caf3cD7723F116c85e6E9bf55933', data: '0xd5774a280000000000000000000000000000000000000000000000000000000000000000', value: 0n}
    // 1:
    // {to: '0x67d269191c92Caf3cD7723F116c85e6E9bf55933', data: '0xc2e9ffd8000000000000000000000000000000000000…000000000000000000000000000000000000000000000', value: 0n}
    // minGasLimit:
    // BigNumber {_hex: '0x00', _isBigNumber: true}
    // random:
    // Uint8Array(31) [18, 52, 86, 120, 144, 171, 205, 239, 18, 52, 86, 120, 144, 171, 205, 239, 18, 52, 86, 120, 144, 171, 205, 239, 18, 52, 86, 120, 144, 171, 205, buffer: ArrayBuffer(31), byteLength: 31, byteOffset: 0, length: 31]
    // requireSuccess:
    // true];

    return ethers.utils.keccak256(hexToBytes(preimage));
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
      value: call.value || 0n,
    }));
  }

  static formatRandom(random: string): Uint8Array {
    if (random.length !== 62) {
      throw new Error('Relay Adapt random parameter must be a hex string of length 62 (31 bytes).');
    }
    return hexToBytes(random);
  }
}

export { RelayAdaptHelper };
