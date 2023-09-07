import { ByteLength, formatToByteLength, fromUTF8String, numberify } from '../utils/bytes';
import { SNARK_PRIME } from '../utils/constants';
import { keccak256 } from '../utils/hash';

// eslint-disable-next-line no-unused-vars
export type RootValidator = (tree: number, root: string) => Promise<boolean>;

export type MerkletreeLeaf = {
  hash: string;
};

export type InvalidMerklerootDetails = {
  position: number;
  blockNumber: number;
};

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
