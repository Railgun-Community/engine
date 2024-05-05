import { poseidon } from '../utils/poseidon';
import { MerkleProof } from '../models/formatted-types';
import { TREE_DEPTH } from '../models/merkletree-types';
import { ByteLength, hexToBigInt, hexlify, nToHex } from '../utils/bytes';
import { Merkletree } from './merkletree';

export const createDummyMerkleProof = (leaf: string): MerkleProof => {
  const indices = nToHex(0n, ByteLength.UINT_256);

  // Fill with 0n dummy value
  const elements: bigint[] = new Array<bigint>(TREE_DEPTH).fill(0n);

  let latestHash = hexToBigInt(leaf);

  for (const element of elements) {
    latestHash = poseidon([latestHash, element]);
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
  const indices = hexToBigInt(proof.indices);

  // Calculate proof root and return if it matches the proof in the MerkleProof
  // Loop through each element and hash till we've reduced to 1 element
  const calculatedRoot = proof.elements.reduce((current, element, index) => {
    // If index is right
    if ((indices & (2n ** BigInt(index))) > 0n) {
      return Merkletree.hashLeftRight(element, current);
    }

    // If index is left
    return Merkletree.hashLeftRight(current, element);
  }, proof.leaf);
  const valid = hexlify(proof.root) === hexlify(calculatedRoot);
  return valid;
};
