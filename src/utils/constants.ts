const MERKLE_TREE_DEPTH = BigInt(16);
const SNARK_PRIME = BigInt(
  21888242871839275222246405745257275088548364400416034343698204186575808495617,
);
  // fucntion merkleZeroValue() {
  //   const railgunPreimage = Buffer.from('Railgun', 'utf8').toString('hex');
  //   return BigInt(`0x${utils.hash.sha256(railgunPreimage)}`) % utils.constants.SNARK_PRIME;
  // }
const MERKLE_ZERO_VALUE = BigInt(
  8734913958451492414605690299249383966198911133281982885257665331255822315496,
);

export default {
  MERKLE_TREE_DEPTH,
  SNARK_PRIME,
  MERKLE_ZERO_VALUE,
};
