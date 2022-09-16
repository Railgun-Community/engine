import BN from 'bn.js';
import { Chain } from '../models/lepton-types';
import { formatToByteLength, ByteLength, hexlify } from '../utils/bytes';

export const getChainFullNetworkID = (chain: Chain): string => {
  // 1 byte: chainType.
  const formattedChainType = formatToByteLength(hexlify(new BN(chain.type)), ByteLength.UINT_8);
  // 7 bytes: chainID.
  const formattedChainID = formatToByteLength(hexlify(new BN(chain.id)), ByteLength.UINT_56);
  return `${formattedChainType}${formattedChainID}`;
};
