import { ContractTransaction, Wallet, Interface, HDNodeWallet, Authorization } from 'ethers';
import { ByteUtils } from '../../utils/bytes';
import { ShieldNoteERC20 } from '../../note/erc20/shield-note-erc20';
import { AddressData, decodeAddress } from '../../key-derivation';
import {
  NFTTokenData,
  RelayAdaptShieldERC20Recipient,
  RelayAdaptShieldNFTRecipient,
  TokenType,
} from '../../models/formatted-types';
import { ShieldNoteNFT } from '../../note/nft/shield-note-nft';
import { ERC721_NOTE_VALUE } from '../../note/note-util';
import { ShieldRequestStruct } from '../../abi/typechain/RelayAdapt';
import { RelayAdapt7702 } from '../../abi/typechain/RelayAdapt7702';
import { TransactionStructV2, TransactionStructV3 } from '../../models/transaction-types';
import { signEIP7702Authorization as signEIP7702AuthorizationCore } from '../../transaction/eip7702';
import {
  RelayAdapt7702ExecutionDetails,
  RelayAdapt7702ExecutionType,
  getExecutePayloadHash,
  signExecutionAuthorization as signExecutionAuthorizationCore,
  ZERO_7702_ADAPT_PARAMS,
} from '../../transaction/relay-adapt-7702-signature';

class RelayAdapt7702Helper {
  /**
   * Signs an EIP-7702 Authorization using ethers native methods.
   * @param signer - The ephemeral key signer
   * @param contractAddress - The address to delegate to (RelayAdapt7702)
   * @param chainId - Chain ID
   * @param nonce - Nonce (typically 0 for ephemeral keys)
   * @returns Authorization tuple
   */
  static async signEIP7702Authorization(
    signer: Wallet | HDNodeWallet,
    contractAddress: string,
    chainId: bigint,
    nonce: number,
  ): Promise<Authorization> {
    return signEIP7702AuthorizationCore(signer, contractAddress, chainId, nonce);
  }

  static async signExecutionAuthorization(
    signer: Wallet | HDNodeWallet,
    transactions: (TransactionStructV2 | TransactionStructV3)[],
    actionData: RelayAdapt7702.ActionDataStruct,
    chainId: bigint,
    executionDetails?: RelayAdapt7702ExecutionDetails,
  ): Promise<string> {
    return signExecutionAuthorizationCore(signer, transactions, actionData, Number(chainId), executionDetails);
  }

  static getExecutePayloadHash(
    transactions: (TransactionStructV2 | TransactionStructV3)[],
    actionData: RelayAdapt7702.ActionDataStruct,
    executionDetails?: RelayAdapt7702ExecutionDetails,
  ): string {
    return getExecutePayloadHash(transactions, actionData, executionDetails);
  }

  static encodeExecute(
    relayAdapt7702Interface: Interface,
    transactions: TransactionStructV2[],
    actionData: RelayAdapt7702.ActionDataStruct,
    signature: string,
    executionDetails: RelayAdapt7702ExecutionDetails,
  ): string {
    if (executionDetails.executionType === RelayAdapt7702ExecutionType.LegacyPreExecuteNonce) {
      return relayAdapt7702Interface.encodeFunctionData('execute', [
        transactions,
        actionData,
        signature,
      ]);
    }

    if (executionDetails.executeNonce == null) {
      throw new Error('RelayAdapt7702 execute nonce required for nonce-aware execute.');
    }

    return relayAdapt7702Interface.encodeFunctionData('execute', [
      transactions,
      actionData,
      executionDetails.executeNonce,
      signature,
    ]);
  }

  static getZeroAdaptParams(): string {
    return ZERO_7702_ADAPT_PARAMS;
  }

  static async generateRelayShieldRequests(
    random: string,
    shieldERC20Recipients: RelayAdaptShieldERC20Recipient[],
    shieldNFTRecipients: RelayAdaptShieldNFTRecipient[],
  ): Promise<ShieldRequestStruct[]> {
    return Promise.all([
      ...(await RelayAdapt7702Helper.createRelayShieldRequestsERC20s(random, shieldERC20Recipients)),
      ...(await RelayAdapt7702Helper.createRelayShieldRequestsNFTs(random, shieldNFTRecipients)),
    ]);
  }

  private static async createRelayShieldRequestsERC20s(
    random: string,
    shieldERC20Recipients: RelayAdaptShieldERC20Recipient[],
  ): Promise<ShieldRequestStruct[]> {
    return Promise.all(
      shieldERC20Recipients.map(({ tokenAddress, recipientAddress }) => {
        const addressData: AddressData = decodeAddress(recipientAddress);
        const shieldERC20 = new ShieldNoteERC20(
          addressData.masterPublicKey,
          random,
          0n, // 0n will automatically shield entire balance.
          tokenAddress,
        );

        // Random private key for Relay Adapt shield.
        const shieldPrivateKey = ByteUtils.hexToBytes(ByteUtils.randomHex(32));

        return shieldERC20.serialize(shieldPrivateKey, addressData.viewingPublicKey);
      }),
    );
  }

  private static async createRelayShieldRequestsNFTs(
    random: string,
    shieldNFTRecipients: RelayAdaptShieldNFTRecipient[],
  ): Promise<ShieldRequestStruct[]> {
    return Promise.all(
      shieldNFTRecipients.map(({ nftTokenData, recipientAddress }) => {
        const value = RelayAdapt7702Helper.valueForNFTShield(nftTokenData);
        const addressData: AddressData = decodeAddress(recipientAddress);
        const shieldNFT = new ShieldNoteNFT(
          addressData.masterPublicKey,
          random,
          value,
          nftTokenData,
        );

        // Random private key for Relay Adapt shield.
        const shieldPrivateKey = ByteUtils.hexToBytes(ByteUtils.randomHex(32));

        return shieldNFT.serialize(shieldPrivateKey, addressData.viewingPublicKey);
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

  /**
   * Format action data field for relay call.
   */
  static getActionData(
    random: string,
    requireSuccess: boolean,
    calls: ContractTransaction[],
    minGasLimit: bigint,
  ): RelayAdapt7702.ActionDataStruct;
  static getActionData(
    requireSuccess: boolean,
    calls: ContractTransaction[],
    minGasLimit: bigint,
  ): RelayAdapt7702.ActionDataStruct;
  static getActionData(
    randomOrRequireSuccess: string | boolean,
    callsOrRequireSuccess: ContractTransaction[] | boolean,
    callsOrMinGasLimit: ContractTransaction[] | bigint,
    maybeMinGasLimit?: bigint,
  ): RelayAdapt7702.ActionDataStruct {
    const requireSuccess =
      typeof randomOrRequireSuccess === 'boolean'
        ? randomOrRequireSuccess
        : (callsOrRequireSuccess as boolean);
    const calls =
      typeof randomOrRequireSuccess === 'boolean'
        ? (callsOrRequireSuccess as ContractTransaction[])
        : (callsOrMinGasLimit as ContractTransaction[]);
    const minGasLimit =
      typeof randomOrRequireSuccess === 'boolean'
        ? (callsOrMinGasLimit as bigint)
        : maybeMinGasLimit;

    if (minGasLimit == null) {
      throw new Error('RelayAdapt7702Helper.getActionData missing minGasLimit.');
    }

    return {
      requireSuccess,
      minGasLimit,
      calls: RelayAdapt7702Helper.formatCalls(calls),
    };
  }

  /**
   * Strips all unnecessary fields from populated transactions
   *
   * @param {object[]} calls - calls list
   * @returns {object[]} formatted calls
   */
  static formatCalls(calls: ContractTransaction[]): RelayAdapt7702.CallStruct[] {
    return calls.map((call) => ({
      to: call.to || '',
      data: call.data || '',
      value: call.value ?? 0n,
    }));
  }
}

export { RelayAdapt7702Helper };
