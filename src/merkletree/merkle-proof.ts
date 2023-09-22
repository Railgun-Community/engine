import { poseidon } from 'circomlibjs';
import { MerkleProof } from '../models/formatted-types';
import { TREE_DEPTH } from '../models/merkletree-types';
import { ByteLength, hexToBigInt, hexlify, nToHex, numberify, randomHex } from '../utils/bytes';
import { Merkletree } from './merkletree';

export const createDummyMerkleProof = (leaf: string): MerkleProof => {
  const indices = nToHex(0n, ByteLength.UINT_256);

  const elements: bigint[] = new Array<bigint>(TREE_DEPTH).fill(hexToBigInt(randomHex(31)));

  let latestHash = hexToBigInt(leaf);

  for (let level = 0; level < elements.length; level += 1) {
    latestHash = poseidon([latestHash, elements[level]]);
  }

  return {
    leaf,
    indices,
    elements: elements.map((el) => nToHex(el, ByteLength.UINT_256)),
    root: nToHex(latestHash, ByteLength.UINT_256),
  };
};

/**
 * Verifies a merkle proof
 * @param proof - proof to verify
 * @returns is valid
 */
export const verifyMerkleProof = (proof: MerkleProof): boolean => {
  // Get indices as BN form
  const indices = numberify(proof.indices);

  // Calculate proof root and return if it matches the proof in the MerkleProof
  // Loop through each element and hash till we've reduced to 1 element
  const calculatedRoot = proof.elements.reduce((current, element, index) => {
    // If index is right
    if (indices.testn(index)) {
      return Merkletree.hashLeftRight(element, current);
    }

    // If index is left
    return Merkletree.hashLeftRight(current, element);
  }, proof.leaf);
  return hexlify(proof.root) === hexlify(calculatedRoot);
};
