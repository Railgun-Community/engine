import { poseidon } from 'circomlibjs';
import { NFTTokenData, TokenData, TokenType } from '../models/formatted-types';
import { TOKEN_SUB_ID_NULL } from '../models/transaction-constants';
import { SNARK_PRIME_BIGINT } from '../utils/constants';
import {
  formatToByteLength,
  ByteLength,
  nToHex,
  hexToBigInt,
  hexlify,
  combine,
  nToBytes,
  hexToBytes,
  trim,
} from '../utils/bytes';
import { keccak256 } from '../utils/hash';

export const ERC721_NOTE_VALUE = BigInt(1);

export const assertValidNoteToken = (tokenData: TokenData, value: bigint) => {
  const tokenAddressLength = hexlify(tokenData.tokenAddress, false).length;

  switch (tokenData.tokenType) {
    case TokenType.ERC20: {
      if (tokenAddressLength !== 40 && tokenAddressLength !== 64) {
        throw new Error(
          `ERC20 address must be length 40 (20 bytes) or 64 (32 bytes). Got ${hexlify(
            tokenData.tokenAddress,
            false,
          )}.`,
        );
      }
      if (BigInt(tokenData.tokenSubID) !== 0n) {
        throw new Error('ERC20 note cannot have tokenSubID parameter.');
      }
      return;
    }
    case TokenType.ERC721: {
      if (tokenAddressLength !== 40) {
        throw new Error(
          `ERC721 address must be length 40 (20 bytes). Got ${hexlify(
            tokenData.tokenAddress,
            false,
          )}.`,
        );
      }
      if (!tokenData.tokenSubID.length) {
        throw new Error('ERC721 note must have tokenSubID parameter.');
      }
      if (value !== BigInt(1)) {
        throw new Error('ERC721 note must have value of 1.');
      }
      return;
    }
    case TokenType.ERC1155: {
      if (tokenAddressLength !== 40) {
        throw new Error(
          `ERC1155 address must be length 40 (20 bytes). Got ${hexlify(
            tokenData.tokenAddress,
            false,
          )}.`,
        );
      }
      if (!tokenData.tokenSubID.length) {
        throw new Error('ERC1155 note must have tokenSubID parameter.');
      }
    }
  }
};

export const assertValidNoteRandom = (random: string) => {
  if (hexlify(random, false).length !== 32) {
    throw new Error(`Random must be length 32 (16 bytes). Got ${hexlify(random, false)}.`);
  }
};

export const serializePreImage = (
  address: string,
  tokenData: TokenData,
  value: bigint,
  prefix: boolean = false,
) => {
  return {
    npk: formatToByteLength(address, ByteLength.UINT_256, prefix),
    token: tokenData,
    value: formatValue(value, prefix),
  };
};

export const serializeTokenData = (
  tokenAddress: string,
  tokenType: bigint | TokenType,
  tokenSubID: bigint | string,
): TokenData => {
  return {
    tokenAddress: formatToByteLength(tokenAddress, ByteLength.Address, true),
    tokenType: Number(tokenType),
    tokenSubID: nToHex(BigInt(tokenSubID), ByteLength.UINT_256, true),
  };
};

export const formatValue = (value: bigint, prefix: boolean = false): string => {
  return nToHex(value, ByteLength.UINT_128, prefix);
};

export const getNoteHash = (address: string, tokenData: TokenData, value: bigint): bigint => {
  const tokenHash = getTokenDataHash(tokenData);
  return poseidon([hexToBigInt(address), hexToBigInt(tokenHash), value]);
};

const getTokenDataHashERC20 = (tokenAddress: string): string => {
  return formatToByteLength(hexToBytes(tokenAddress), ByteLength.UINT_256);
};

const getTokenDataHashNFT = (tokenData: TokenData): string => {
  // keccak256 hash of the token data.
  const combinedData: string = combine([
    nToBytes(BigInt(tokenData.tokenType), ByteLength.UINT_256),
    hexToBytes(formatToByteLength(tokenData.tokenAddress, ByteLength.UINT_256)),
    nToBytes(BigInt(tokenData.tokenSubID), ByteLength.UINT_256),
  ]);
  const hashed: string = keccak256(combinedData);
  const modulo: bigint = hexToBigInt(hashed) % SNARK_PRIME_BIGINT;
  return nToHex(modulo, ByteLength.UINT_256);
};

export const getTokenDataERC20 = (tokenAddress: string): TokenData => {
  return {
    tokenAddress: formatToByteLength(tokenAddress, ByteLength.Address, true),
    tokenType: TokenType.ERC20,
    tokenSubID: formatToByteLength(TOKEN_SUB_ID_NULL, ByteLength.UINT_256, true),
  };
};

export const getTokenDataNFT = (
  nftAddress: string,
  tokenType: TokenType.ERC721 | TokenType.ERC1155,
  tokenSubID: string,
): NFTTokenData => {
  return {
    tokenAddress: formatToByteLength(nftAddress, ByteLength.Address, true),
    tokenType,
    tokenSubID: formatToByteLength(tokenSubID, ByteLength.UINT_256, true),
  };
};

export const getTokenDataHash = (tokenData: TokenData): string => {
  switch (tokenData.tokenType) {
    case TokenType.ERC20:
      return getTokenDataHashERC20(tokenData.tokenAddress);
    case TokenType.ERC721:
    case TokenType.ERC1155:
      return getTokenDataHashNFT(tokenData);
  }
  throw new Error('Unrecognized token type.');
};

export const getReadableTokenAddress = (tokenData: TokenData): string => {
  switch (tokenData.tokenType) {
    case TokenType.ERC20:
      return `0x${trim(tokenData.tokenAddress, ByteLength.Address) as string}`;
    case TokenType.ERC721:
    case TokenType.ERC1155:
      return `${tokenData.tokenAddress} (${tokenData.tokenSubID})`;
  }
  throw new Error('Unrecognized token type.');
};
