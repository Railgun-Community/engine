import { ContractTransaction, AbiCoder, keccak256, Wallet, encodeRlp, toBeHex, concat, Interface, HDNodeWallet } from 'ethers';
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
import { RelayAdapt, ShieldRequestStruct } from '../../abi/typechain/RelayAdapt';
import { TransactionStructV2, TransactionStructV3 } from '../../models/transaction-types';
import { EIP7702Authorization } from '../../models/relay-adapt-types';
import { ABIRelayAdapt7702 } from '../../abi/abi';

class RelayAdapt7702Helper {
  static async signEIP7702Authorization(
    signer: Wallet | HDNodeWallet,
    contractAddress: string,
    chainId: bigint,
    nonce: number,
  ): Promise<EIP7702Authorization> {
    // 0x05 || rlp([chain_id, address, nonce])
    const rlpEncoded = encodeRlp([
      toBeHex(chainId),
      contractAddress,
      toBeHex(nonce),
    ]);
    const payload = concat(['0x05', rlpEncoded]);
    const digest = keccak256(payload);

    const signature = signer.signingKey.sign(digest);

    return {
      chainId: chainId.toString(),
      address: contractAddress,
      nonce,
      yParity: signature.yParity,
      r: signature.r,
      s: signature.s,
    };
  }

  static async signExecutionAuthorization(
    signer: Wallet | HDNodeWallet,
    transactions: (TransactionStructV2 | TransactionStructV3)[],
    actionData: RelayAdapt.ActionDataStruct,
    chainId: bigint,
  ): Promise<string> {
    // 1. Extract nullifiers
    const nullifiers = transactions.map(tx => tx.nullifiers);

    // 2. Encode adaptParams
    // keccak256(abi.encode(nullifiers, _transactions.length, _actionData))
    // ActionData is (bytes31, bool, uint256, (address, bytes, uint256)[])
    
    const actionDataTuple = [
      actionData.random,
      actionData.requireSuccess,
      actionData.minGasLimit,
      actionData.calls.map(call => [call.to, call.data, call.value])
    ];

    const adaptParamsEncoded = AbiCoder.defaultAbiCoder().encode(
      ['bytes32[][]', 'uint256', 'tuple(bytes31, bool, uint256, tuple(address, bytes, uint256)[])'],
      [nullifiers, transactions.length, actionDataTuple]
    );
    const adaptParams = keccak256(adaptParamsEncoded);

    // 3. Sign Typed Data
    const domain = {
      name: 'RelayAdapt7702',
      version: '1',
      chainId,
      verifyingContract: signer.address,
    };

    const types = {
      Relay: [
        { name: 'adaptParams', type: 'bytes32' },
      ],
    };

    const value = {
      adaptParams,
    };

    return signer.signTypedData(domain, types, value);
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
  ): RelayAdapt.ActionDataStruct {
    const formattedRandom = RelayAdapt7702Helper.formatRandom(random);
    return {
      random: formattedRandom,
      requireSuccess,
      minGasLimit,
      calls: RelayAdapt7702Helper.formatCalls(calls),
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
    transactions: (TransactionStructV2 | TransactionStructV3)[],
    random: string,
    requireSuccess: boolean,
    calls: ContractTransaction[],
    minGasLimit = BigInt(0),
  ): string {
    const actionData = RelayAdapt7702Helper.getActionData(random, requireSuccess, calls, minGasLimit);
    return RelayAdapt7702Helper.getAdaptParams(transactions, actionData);
  }

  static getAdaptParams(
    transactions: (TransactionStructV2 | TransactionStructV3)[],
    actionData: RelayAdapt.ActionDataStruct,
  ): string {
    const nullifiers = transactions.map((transaction) => transaction.nullifiers);

    const preimage = AbiCoder.defaultAbiCoder().encode(
      [
        'bytes32[][] nullifiers',
        'uint256 transactionsLength',
        'tuple(bytes31 random, bool requireSuccess, uint256 minGasLimit, tuple(address to, bytes data, uint256 value)[] calls) actionData',
      ],
      [nullifiers, transactions.length, actionData],
    );

    return keccak256(ByteUtils.hexToBytes(preimage));
  }

  /**
   * Strips all unnecessary fields from populated transactions
   *
   * @param {object[]} calls - calls list
   * @returns {object[]} formatted calls
   */
  static formatCalls(calls: ContractTransaction[]): RelayAdapt.CallStruct[] {
    return calls.map((call) => ({
      to: call.to || '',
      data: call.data || '',
      value: call.value ?? 0n,
    }));
  }

  static formatRandom(random: string): Uint8Array {
    if (random.length !== 62) {
      throw new Error('Relay Adapt random parameter must be a hex string of length 62 (31 bytes).');
    }
    return ByteUtils.hexToBytes(random);
  }
}

export { RelayAdapt7702Helper };
