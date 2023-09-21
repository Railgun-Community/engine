import { ByteLength, nToHex } from '../utils/bytes';
import { bitwiseMerge } from './blinded-commitment';

/**
 * Shields don't have txids, so we generate an ID from the UTXO tree and position.
 */
export const getShieldRailgunTxid = (tree: number, position: number) => {
  return nToHex(BigInt(bitwiseMerge(tree, position)), ByteLength.UINT_256, true);
};
