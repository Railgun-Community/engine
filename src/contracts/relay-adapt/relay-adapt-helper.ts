import { ethers, PopulatedTransaction, BigNumber } from 'ethers';
import { randomHex, hexToBytes } from '../../utils/bytes';
import { RelayAdapt } from '../../typechain-types/contracts/adapt/Relay.sol/RelayAdapt';
import {
  ShieldRequestStruct,
  TransactionStruct,
} from '../../typechain-types/contracts/logic/RailgunSmartWallet';
import { ShieldNoteERC20 } from '../../note/erc20/shield-note-erc20';
import { AddressData } from '../../key-derivation';
import { NFTTokenData, TokenType } from '../../models/formatted-types';
import { ShieldNoteNFT } from '../../note/nft/shield-note-nft';
import { ERC721_NOTE_VALUE } from '../../note/note-util';

class RelayAdaptHelper {
  static async generateRelayShieldRequests(
    addressData: AddressData,
    random: string,
    shieldERC20Addresses: string[],
    shieldNFTsTokenData: NFTTokenData[],
  ): Promise<ShieldRequestStruct[]> {
    return Promise.all([
      ...(await RelayAdaptHelper.createRelayShieldRequestsERC20s(
        addressData,
        random,
        shieldERC20Addresses,
      )),
      ...(await RelayAdaptHelper.createRelayShieldRequestsNFTs(
        addressData,
        random,
        shieldNFTsTokenData,
      )),
    ]);
  }

  private static async createRelayShieldRequestsERC20s(
    addressData: AddressData,
    random: string,
    shieldERC20Addresses: string[],
  ): Promise<ShieldRequestStruct[]> {
    return Promise.all(
      shieldERC20Addresses.map((erc20Address) => {
        const shieldERC20 = new ShieldNoteERC20(
          addressData.masterPublicKey,
          random,
          0n, // 0n will automatically shield entire balance.
          erc20Address,
        );

        // Random private key for Relay Adapt shield.
        const shieldPrivateKey = hexToBytes(randomHex(32));

        return shieldERC20.serialize(shieldPrivateKey, addressData.viewingPublicKey);
      }),
    );
  }

  private static async createRelayShieldRequestsNFTs(
    addressData: AddressData,
    random: string,
    shieldNFTsTokenData: NFTTokenData[],
  ): Promise<ShieldRequestStruct[]> {
    return Promise.all(
      shieldNFTsTokenData.map((nftTokenData) => {
        const value = RelayAdaptHelper.valueForNFTShield(nftTokenData);

        const shieldERC20 = new ShieldNoteNFT(
          addressData.masterPublicKey,
          random,
          value,
          nftTokenData,
        );

        // Random private key for Relay Adapt shield.
        const shieldPrivateKey = hexToBytes(randomHex(32));

        return shieldERC20.serialize(shieldPrivateKey, addressData.viewingPublicKey);
      }),
    );
  }

  private static valueForNFTShield(nftTokenData: NFTTokenData): bigint {
    switch (nftTokenData.tokenType) {
      case TokenType.ERC721:
        return ERC721_NOTE_VALUE;
      case TokenType.ERC1155:
        return 0n; // 0n will automatically shield entire balance.
    }
    throw new Error('Unhandled NFT token type.');
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
