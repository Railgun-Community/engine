import { poseidon } from 'circomlibjs';
import { TokenData, TokenType } from '../models';
import { formatToByteLength, ByteLength, nToHex, hexToBigInt } from '../utils';

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
  tokenType: TokenType,
  tokenSubID: string,
): TokenData => {
  return {
    tokenAddress: formatToByteLength(tokenAddress, ByteLength.Address, true),
    tokenType,
    tokenSubID,
  };
};

export const formatValue = (value: bigint, prefix: boolean = false): string => {
  return nToHex(value, ByteLength.UINT_128, prefix);
};

export const getNoteHash = (address: string, tokenAddress: string, value: bigint): bigint => {
  return poseidon([hexToBigInt(address), hexToBigInt(tokenAddress), value]);
};
