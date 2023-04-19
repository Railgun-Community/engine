import BN from 'bn.js';

export const SNARK_PRIME: BN = new BN(
  '21888242871839275222246405745257275088548364400416034343698204186575808495617',
);

export const SNARK_PRIME_BIGINT: bigint = BigInt(
  '21888242871839275222246405745257275088548364400416034343698204186575808495617',
);

export const ADDRESS_VERSION = 1;

export const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

/**
 * Block number per EVM chain designating when events changed for Engine V3 upgrade.
 */
export const ENGINE_V3_START_BLOCK_NUMBERS_EVM: { [chainID: number]: number } = {
  1: 16076750,
  5: 7921409,
  56: 23478204,
  137: 36219104,
  80001: 29032556,
};

/**
 * Block number per EVM chain designating when the shield event changed on Mar 9, 2023.
 */
export const ENGINE_V3_SHIELD_EVENT_UPDATE_03_09_23_BLOCK_NUMBERS_EVM: {
  [chainID: number]: number;
} = {
  1: 16790263,
  5: 8625125,
  56: 26313947,
  137: 40143539,
  42161: 68196853,
  80001: 32311023,
  421613: 10607748,
};

/**
 * Increment to issue fresh merkletree rescan on next launch.
 */
export const CURRENT_MERKLETREE_HISTORY_VERSION = 2;
