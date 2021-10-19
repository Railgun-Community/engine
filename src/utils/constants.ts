import BN from 'bn.js';
import bytes from './bytes';
import hash from './hash';

const MERKLE_TREE_DEPTH: number = 16;

const SNARK_PRIME: BN = new BN(
  '21888242871839275222246405745257275088548364400416034343698204186575808495617',
  10,
);

const MERKLE_ZERO_VALUE: BN = bytes.numberify(
  hash.keccak256(
    bytes.fromUTF8String('Railgun'),
  ),
).mod(SNARK_PRIME);

export default {
  MERKLE_TREE_DEPTH,
  SNARK_PRIME,
  MERKLE_ZERO_VALUE,
};
