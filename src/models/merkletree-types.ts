import { ByteLength, formatToByteLength, fromUTF8String, numberify } from '../utils/bytes';
import { SNARK_PRIME } from '../utils/constants';
import { keccak256 } from '../utils/hash';

export const TREE_DEPTH = 16;
export const TREE_MAX_ITEMS = 65_536; // 2^16

// eslint-disable-next-line no-unused-vars
export type MerklerootValidator = (
  tree: number,
  index: number,
  merkleroot: string,
) => Promise<boolean>;

export type MerkletreeLeaf = {
  hash: string;
};

export type InvalidMerklerootDetails = {
  position: number;
  blockNumber: number;
};

// Optimization: process leaves for a many commitment groups before checking merkleroot against contract.
// If merkleroot is invalid, scan leaves as medium batches, and individually as a final backup.
// For TXID merkletree on POI Nodes, re-calculate for every Single tree update, in order to capture its merkleroot.
export enum CommitmentProcessingGroupSize {
  XXXLarge = 8000,
  XXLarge = 1600,
  XLarge = 800,
  Large = 200,
  Medium = 40,
  Small = 10,
  Single = 1,
}

type TreeMetadata = {
  scannedHeight: number;
  invalidMerklerootDetails: InvalidMerklerootDetails | null;
};
export type MerkletreesMetadata = {
  trees: { [tree: number]: TreeMetadata };
};

// Calculate tree zero value
export const MERKLE_ZERO_VALUE: string = formatToByteLength(
  numberify(keccak256(fromUTF8String('Railgun')))
    .mod(SNARK_PRIME)
    .toString('hex'),
  ByteLength.UINT_256,
);
