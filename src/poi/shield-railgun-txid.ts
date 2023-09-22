import { TREE_DEPTH } from '../models/merkletree-types';
import { ByteLength, nToHex } from '../utils/bytes';

const bitwiseMerge = (tree: number, index: number): number => {
  return (tree << TREE_DEPTH) + index;
};

/**
 * Shields don't have txids, so we generate an ID from the UTXO tree and position.
 */
export const getShieldRailgunTxid = (tree: number, position: number) => {
  return nToHex(BigInt(bitwiseMerge(tree, position)), ByteLength.UINT_256, true);
};
