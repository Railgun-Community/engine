import { ContractTransaction } from 'ethers';
import { Chain } from '../models/engine-types';
import { TXIDVersion } from '../models/poi-types';
import { AddressData } from '../key-derivation/bech32';
import { TokenDataGetter } from '../token/token-data-getter';
import {
  extractFirstNoteERC20AmountMapFromTransactionRequestV2,
  extractRailgunTransactionDataFromTransactionRequestV2,
} from './extract-transaction-data-v2';
import {
  extractFirstNoteERC20AmountMapFromTransactionRequestV3,
  extractRailgunTransactionDataFromTransactionRequestV3,
} from './extract-transaction-data-v3';

export const extractFirstNoteERC20AmountMapFromTransactionRequest = (
  txidVersion: TXIDVersion,
  chain: Chain,
  transactionRequest: ContractTransaction,
  useRelayAdapt: boolean,
  contractAddress: string,
  receivingViewingPrivateKey: Uint8Array,
  receivingRailgunAddressData: AddressData,
  tokenDataGetter: TokenDataGetter,
) => {
  switch (txidVersion) {
    case TXIDVersion.V2_PoseidonMerkle:
      return extractFirstNoteERC20AmountMapFromTransactionRequestV2(
        chain,
        transactionRequest,
        useRelayAdapt,
        contractAddress,
        receivingViewingPrivateKey,
        receivingRailgunAddressData,
        tokenDataGetter,
      );
    case TXIDVersion.V3_PoseidonMerkle:
      return extractFirstNoteERC20AmountMapFromTransactionRequestV3(
        chain,
        transactionRequest,
        contractAddress,
        receivingViewingPrivateKey,
        receivingRailgunAddressData,
        tokenDataGetter,
      );
  }
  throw new Error('Unsupported txidVersion');
};

export const extractRailgunTransactionDataFromTransactionRequest = (
  txidVersion: TXIDVersion,
  chain: Chain,
  transactionRequest: ContractTransaction,
  useRelayAdapt: boolean,
  contractAddress: string,
  receivingViewingPrivateKey: Uint8Array,
  receivingRailgunAddressData: AddressData,
  tokenDataGetter: TokenDataGetter,
) => {
  switch (txidVersion) {
    case TXIDVersion.V2_PoseidonMerkle:
      return extractRailgunTransactionDataFromTransactionRequestV2(
        chain,
        transactionRequest,
        useRelayAdapt,
        contractAddress,
        receivingViewingPrivateKey,
        receivingRailgunAddressData,
        tokenDataGetter,
      );
    case TXIDVersion.V3_PoseidonMerkle:
      return extractRailgunTransactionDataFromTransactionRequestV3(
        chain,
        transactionRequest,
        contractAddress,
        receivingViewingPrivateKey,
        receivingRailgunAddressData,
        tokenDataGetter,
      );
  }
  throw new Error('Unsupported txidVersion');
};
