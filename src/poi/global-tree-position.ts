import { TREE_MAX_ITEMS } from '../models/merkletree-types';

export const getGlobalTreePosition = (tree: number, index: number): bigint => {
  return BigInt(tree * TREE_MAX_ITEMS + index);
};
