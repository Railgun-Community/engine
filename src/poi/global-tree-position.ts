import { TREE_DEPTH } from '../models/merkletree-types';

const bitwiseMerge = (tree: number, index: number): number => {
  return (tree << TREE_DEPTH) + index;
};

/**
 * Shields don't have txids, so we generate an ID from the UTXO tree and position.
 */
export const getGlobalTreePosition = (tree: number, position: number): bigint => {
  return BigInt(bitwiseMerge(tree, position));
};
