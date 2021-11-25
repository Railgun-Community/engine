export default [
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: 'uint256',
        name: 'treeNumber',
        type: 'uint256',
      },
      {
        indexed: true,
        internalType: 'uint256',
        name: 'startPosition',
        type: 'uint256',
      },
      {
        components: [
          {
            internalType: 'uint256',
            name: 'hash',
            type: 'uint256',
          },
          {
            internalType: 'uint256[6]',
            name: 'ciphertext',
            type: 'uint256[6]',
          },
          {
            internalType: 'uint256[2]',
            name: 'senderPubKey',
            type: 'uint256[2]',
          },
        ],
        indexed: false,
        internalType: 'struct Commitment[]',
        name: 'commitments',
        type: 'tuple[]',
      },
    ],
    name: 'CommitmentBatch',
    type: 'event',
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: false,
        internalType: 'uint256',
        name: 'depositFee',
        type: 'uint256',
      },
      {
        indexed: false,
        internalType: 'uint256',
        name: 'withdrawFee',
        type: 'uint256',
      },
      {
        indexed: false,
        internalType: 'uint256',
        name: 'transferFee',
        type: 'uint256',
      },
    ],
    name: 'FeeChange',
    type: 'event',
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: 'uint256',
        name: 'treeNumber',
        type: 'uint256',
      },
      {
        indexed: true,
        internalType: 'uint256',
        name: 'startPosition',
        type: 'uint256',
      },
      {
        components: [
          {
            internalType: 'uint256[2]',
            name: 'pubkey',
            type: 'uint256[2]',
          },
          {
            internalType: 'uint256',
            name: 'random',
            type: 'uint256',
          },
          {
            internalType: 'uint256',
            name: 'amount',
            type: 'uint256',
          },
          {
            internalType: 'address',
            name: 'token',
            type: 'address',
          },
        ],
        indexed: false,
        internalType: 'struct GeneratedCommitment[]',
        name: 'commitments',
        type: 'tuple[]',
      },
    ],
    name: 'GeneratedCommitmentBatch',
    type: 'event',
  },
  {
    anonymous: false,
    inputs: [
      {
        components: [
          {
            components: [
              {
                internalType: 'uint256',
                name: 'x',
                type: 'uint256',
              },
              {
                internalType: 'uint256',
                name: 'y',
                type: 'uint256',
              },
            ],
            internalType: 'struct G1Point',
            name: 'alpha1',
            type: 'tuple',
          },
          {
            components: [
              {
                internalType: 'uint256[2]',
                name: 'x',
                type: 'uint256[2]',
              },
              {
                internalType: 'uint256[2]',
                name: 'y',
                type: 'uint256[2]',
              },
            ],
            internalType: 'struct G2Point',
            name: 'beta2',
            type: 'tuple',
          },
          {
            components: [
              {
                internalType: 'uint256[2]',
                name: 'x',
                type: 'uint256[2]',
              },
              {
                internalType: 'uint256[2]',
                name: 'y',
                type: 'uint256[2]',
              },
            ],
            internalType: 'struct G2Point',
            name: 'gamma2',
            type: 'tuple',
          },
          {
            components: [
              {
                internalType: 'uint256[2]',
                name: 'x',
                type: 'uint256[2]',
              },
              {
                internalType: 'uint256[2]',
                name: 'y',
                type: 'uint256[2]',
              },
            ],
            internalType: 'struct G2Point',
            name: 'delta2',
            type: 'tuple',
          },
          {
            components: [
              {
                internalType: 'uint256',
                name: 'x',
                type: 'uint256',
              },
              {
                internalType: 'uint256',
                name: 'y',
                type: 'uint256',
              },
            ],
            internalType: 'struct G1Point[2]',
            name: 'ic',
            type: 'tuple[2]',
          },
        ],
        indexed: false,
        internalType: 'struct VerifyingKey',
        name: 'vkey',
        type: 'tuple',
      },
    ],
    name: 'LargeVerificationKeyChange',
    type: 'event',
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: 'uint256',
        name: 'treeNumber',
        type: 'uint256',
      },
      {
        indexed: true,
        internalType: 'uint256',
        name: 'position',
        type: 'uint256',
      },
      {
        indexed: false,
        internalType: 'uint256',
        name: 'hash',
        type: 'uint256',
      },
      {
        indexed: false,
        internalType: 'uint256[6]',
        name: 'ciphertext',
        type: 'uint256[6]',
      },
      {
        indexed: false,
        internalType: 'uint256[2]',
        name: 'senderPubKey',
        type: 'uint256[2]',
      },
    ],
    name: 'NewCommitment',
    type: 'event',
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: 'uint256',
        name: 'treeNumber',
        type: 'uint256',
      },
      {
        indexed: true,
        internalType: 'uint256',
        name: 'position',
        type: 'uint256',
      },
      {
        indexed: false,
        internalType: 'uint256',
        name: 'hash',
        type: 'uint256',
      },
      {
        indexed: false,
        internalType: 'uint256[2]',
        name: 'pubkey',
        type: 'uint256[2]',
      },
      {
        indexed: false,
        internalType: 'uint256',
        name: 'random',
        type: 'uint256',
      },
      {
        indexed: false,
        internalType: 'uint256',
        name: 'amount',
        type: 'uint256',
      },
      {
        indexed: false,
        internalType: 'address',
        name: 'token',
        type: 'address',
      },
    ],
    name: 'NewGeneratedCommitment',
    type: 'event',
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: 'uint256',
        name: 'nullifier',
        type: 'uint256',
      },
    ],
    name: 'Nullifier',
    type: 'event',
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: 'address',
        name: 'previousOwner',
        type: 'address',
      },
      {
        indexed: true,
        internalType: 'address',
        name: 'newOwner',
        type: 'address',
      },
    ],
    name: 'OwnershipTransferred',
    type: 'event',
  },
  {
    anonymous: false,
    inputs: [
      {
        components: [
          {
            components: [
              {
                internalType: 'uint256',
                name: 'x',
                type: 'uint256',
              },
              {
                internalType: 'uint256',
                name: 'y',
                type: 'uint256',
              },
            ],
            internalType: 'struct G1Point',
            name: 'alpha1',
            type: 'tuple',
          },
          {
            components: [
              {
                internalType: 'uint256[2]',
                name: 'x',
                type: 'uint256[2]',
              },
              {
                internalType: 'uint256[2]',
                name: 'y',
                type: 'uint256[2]',
              },
            ],
            internalType: 'struct G2Point',
            name: 'beta2',
            type: 'tuple',
          },
          {
            components: [
              {
                internalType: 'uint256[2]',
                name: 'x',
                type: 'uint256[2]',
              },
              {
                internalType: 'uint256[2]',
                name: 'y',
                type: 'uint256[2]',
              },
            ],
            internalType: 'struct G2Point',
            name: 'gamma2',
            type: 'tuple',
          },
          {
            components: [
              {
                internalType: 'uint256[2]',
                name: 'x',
                type: 'uint256[2]',
              },
              {
                internalType: 'uint256[2]',
                name: 'y',
                type: 'uint256[2]',
              },
            ],
            internalType: 'struct G2Point',
            name: 'delta2',
            type: 'tuple',
          },
          {
            components: [
              {
                internalType: 'uint256',
                name: 'x',
                type: 'uint256',
              },
              {
                internalType: 'uint256',
                name: 'y',
                type: 'uint256',
              },
            ],
            internalType: 'struct G1Point[2]',
            name: 'ic',
            type: 'tuple[2]',
          },
        ],
        indexed: false,
        internalType: 'struct VerifyingKey',
        name: 'vkey',
        type: 'tuple',
      },
    ],
    name: 'SmallVerificationKeyChange',
    type: 'event',
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: 'address',
        name: 'token',
        type: 'address',
      },
    ],
    name: 'TokenDelisting',
    type: 'event',
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: 'address',
        name: 'token',
        type: 'address',
      },
    ],
    name: 'TokenListing',
    type: 'event',
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: false,
        internalType: 'address',
        name: 'treasury',
        type: 'address',
      },
    ],
    name: 'TreasuryChange',
    type: 'event',
  },
  {
    inputs: [
      {
        internalType: 'address[]',
        name: '_tokens',
        type: 'address[]',
      },
    ],
    name: 'addToWhitelist',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      {
        internalType: 'uint256',
        name: '_depositFee',
        type: 'uint256',
      },
      {
        internalType: 'uint256',
        name: '_withdrawFee',
        type: 'uint256',
      },
      {
        internalType: 'uint256',
        name: '_transferFee',
        type: 'uint256',
      },
    ],
    name: 'changeFee',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      {
        internalType: 'address payable',
        name: '_treasury',
        type: 'address',
      },
    ],
    name: 'changeTreasury',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [],
    name: 'depositFee',
    outputs: [
      {
        internalType: 'uint256',
        name: '',
        type: 'uint256',
      },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      {
        components: [
          {
            internalType: 'uint256[2]',
            name: 'pubkey',
            type: 'uint256[2]',
          },
          {
            internalType: 'uint256',
            name: 'random',
            type: 'uint256',
          },
          {
            internalType: 'uint256',
            name: 'amount',
            type: 'uint256',
          },
          {
            internalType: 'address',
            name: 'token',
            type: 'address',
          },
        ],
        internalType: 'struct GeneratedCommitment[]',
        name: '_transactions',
        type: 'tuple[]',
      },
    ],
    name: 'generateDeposit',
    outputs: [],
    stateMutability: 'payable',
    type: 'function',
  },
  {
    inputs: [
      {
        components: [
          {
            components: [
              {
                internalType: 'uint256',
                name: 'x',
                type: 'uint256',
              },
              {
                internalType: 'uint256',
                name: 'y',
                type: 'uint256',
              },
            ],
            internalType: 'struct G1Point',
            name: 'alpha1',
            type: 'tuple',
          },
          {
            components: [
              {
                internalType: 'uint256[2]',
                name: 'x',
                type: 'uint256[2]',
              },
              {
                internalType: 'uint256[2]',
                name: 'y',
                type: 'uint256[2]',
              },
            ],
            internalType: 'struct G2Point',
            name: 'beta2',
            type: 'tuple',
          },
          {
            components: [
              {
                internalType: 'uint256[2]',
                name: 'x',
                type: 'uint256[2]',
              },
              {
                internalType: 'uint256[2]',
                name: 'y',
                type: 'uint256[2]',
              },
            ],
            internalType: 'struct G2Point',
            name: 'gamma2',
            type: 'tuple',
          },
          {
            components: [
              {
                internalType: 'uint256[2]',
                name: 'x',
                type: 'uint256[2]',
              },
              {
                internalType: 'uint256[2]',
                name: 'y',
                type: 'uint256[2]',
              },
            ],
            internalType: 'struct G2Point',
            name: 'delta2',
            type: 'tuple',
          },
          {
            components: [
              {
                internalType: 'uint256',
                name: 'x',
                type: 'uint256',
              },
              {
                internalType: 'uint256',
                name: 'y',
                type: 'uint256',
              },
            ],
            internalType: 'struct G1Point[2]',
            name: 'ic',
            type: 'tuple[2]',
          },
        ],
        internalType: 'struct VerifyingKey',
        name: '_vKeySmall',
        type: 'tuple',
      },
      {
        components: [
          {
            components: [
              {
                internalType: 'uint256',
                name: 'x',
                type: 'uint256',
              },
              {
                internalType: 'uint256',
                name: 'y',
                type: 'uint256',
              },
            ],
            internalType: 'struct G1Point',
            name: 'alpha1',
            type: 'tuple',
          },
          {
            components: [
              {
                internalType: 'uint256[2]',
                name: 'x',
                type: 'uint256[2]',
              },
              {
                internalType: 'uint256[2]',
                name: 'y',
                type: 'uint256[2]',
              },
            ],
            internalType: 'struct G2Point',
            name: 'beta2',
            type: 'tuple',
          },
          {
            components: [
              {
                internalType: 'uint256[2]',
                name: 'x',
                type: 'uint256[2]',
              },
              {
                internalType: 'uint256[2]',
                name: 'y',
                type: 'uint256[2]',
              },
            ],
            internalType: 'struct G2Point',
            name: 'gamma2',
            type: 'tuple',
          },
          {
            components: [
              {
                internalType: 'uint256[2]',
                name: 'x',
                type: 'uint256[2]',
              },
              {
                internalType: 'uint256[2]',
                name: 'y',
                type: 'uint256[2]',
              },
            ],
            internalType: 'struct G2Point',
            name: 'delta2',
            type: 'tuple',
          },
          {
            components: [
              {
                internalType: 'uint256',
                name: 'x',
                type: 'uint256',
              },
              {
                internalType: 'uint256',
                name: 'y',
                type: 'uint256',
              },
            ],
            internalType: 'struct G1Point[2]',
            name: 'ic',
            type: 'tuple[2]',
          },
        ],
        internalType: 'struct VerifyingKey',
        name: '_vKeyLarge',
        type: 'tuple',
      },
      {
        internalType: 'address[]',
        name: '_tokenWhitelist',
        type: 'address[]',
      },
      {
        internalType: 'address payable',
        name: '_treasury',
        type: 'address',
      },
      {
        internalType: 'uint256',
        name: '_depositFee',
        type: 'uint256',
      },
      {
        internalType: 'uint256',
        name: '_withdrawFee',
        type: 'uint256',
      },
      {
        internalType: 'uint256',
        name: '_transferFee',
        type: 'uint256',
      },
      {
        internalType: 'address',
        name: '_owner',
        type: 'address',
      },
    ],
    name: 'initializeRailgunLogic',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [],
    name: 'merkleRoot',
    outputs: [
      {
        internalType: 'uint256',
        name: '',
        type: 'uint256',
      },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      {
        internalType: 'uint256',
        name: '',
        type: 'uint256',
      },
    ],
    name: 'nullifiers',
    outputs: [
      {
        internalType: 'bool',
        name: '',
        type: 'bool',
      },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'owner',
    outputs: [
      {
        internalType: 'address',
        name: '',
        type: 'address',
      },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      {
        internalType: 'address[]',
        name: '_tokens',
        type: 'address[]',
      },
    ],
    name: 'removeFromWhitelist',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [],
    name: 'renounceOwnership',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      {
        internalType: 'uint256',
        name: '',
        type: 'uint256',
      },
      {
        internalType: 'uint256',
        name: '',
        type: 'uint256',
      },
    ],
    name: 'rootHistory',
    outputs: [
      {
        internalType: 'bool',
        name: '',
        type: 'bool',
      },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      {
        components: [
          {
            components: [
              {
                internalType: 'uint256',
                name: 'x',
                type: 'uint256',
              },
              {
                internalType: 'uint256',
                name: 'y',
                type: 'uint256',
              },
            ],
            internalType: 'struct G1Point',
            name: 'alpha1',
            type: 'tuple',
          },
          {
            components: [
              {
                internalType: 'uint256[2]',
                name: 'x',
                type: 'uint256[2]',
              },
              {
                internalType: 'uint256[2]',
                name: 'y',
                type: 'uint256[2]',
              },
            ],
            internalType: 'struct G2Point',
            name: 'beta2',
            type: 'tuple',
          },
          {
            components: [
              {
                internalType: 'uint256[2]',
                name: 'x',
                type: 'uint256[2]',
              },
              {
                internalType: 'uint256[2]',
                name: 'y',
                type: 'uint256[2]',
              },
            ],
            internalType: 'struct G2Point',
            name: 'gamma2',
            type: 'tuple',
          },
          {
            components: [
              {
                internalType: 'uint256[2]',
                name: 'x',
                type: 'uint256[2]',
              },
              {
                internalType: 'uint256[2]',
                name: 'y',
                type: 'uint256[2]',
              },
            ],
            internalType: 'struct G2Point',
            name: 'delta2',
            type: 'tuple',
          },
          {
            components: [
              {
                internalType: 'uint256',
                name: 'x',
                type: 'uint256',
              },
              {
                internalType: 'uint256',
                name: 'y',
                type: 'uint256',
              },
            ],
            internalType: 'struct G1Point[2]',
            name: 'ic',
            type: 'tuple[2]',
          },
        ],
        internalType: 'struct VerifyingKey',
        name: '_vKey',
        type: 'tuple',
      },
    ],
    name: 'setVKeyLarge',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      {
        components: [
          {
            components: [
              {
                internalType: 'uint256',
                name: 'x',
                type: 'uint256',
              },
              {
                internalType: 'uint256',
                name: 'y',
                type: 'uint256',
              },
            ],
            internalType: 'struct G1Point',
            name: 'alpha1',
            type: 'tuple',
          },
          {
            components: [
              {
                internalType: 'uint256[2]',
                name: 'x',
                type: 'uint256[2]',
              },
              {
                internalType: 'uint256[2]',
                name: 'y',
                type: 'uint256[2]',
              },
            ],
            internalType: 'struct G2Point',
            name: 'beta2',
            type: 'tuple',
          },
          {
            components: [
              {
                internalType: 'uint256[2]',
                name: 'x',
                type: 'uint256[2]',
              },
              {
                internalType: 'uint256[2]',
                name: 'y',
                type: 'uint256[2]',
              },
            ],
            internalType: 'struct G2Point',
            name: 'gamma2',
            type: 'tuple',
          },
          {
            components: [
              {
                internalType: 'uint256[2]',
                name: 'x',
                type: 'uint256[2]',
              },
              {
                internalType: 'uint256[2]',
                name: 'y',
                type: 'uint256[2]',
              },
            ],
            internalType: 'struct G2Point',
            name: 'delta2',
            type: 'tuple',
          },
          {
            components: [
              {
                internalType: 'uint256',
                name: 'x',
                type: 'uint256',
              },
              {
                internalType: 'uint256',
                name: 'y',
                type: 'uint256',
              },
            ],
            internalType: 'struct G1Point[2]',
            name: 'ic',
            type: 'tuple[2]',
          },
        ],
        internalType: 'struct VerifyingKey',
        name: '_vKey',
        type: 'tuple',
      },
    ],
    name: 'setVKeySmall',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      {
        internalType: 'address',
        name: '',
        type: 'address',
      },
    ],
    name: 'tokenWhitelist',
    outputs: [
      {
        internalType: 'bool',
        name: '',
        type: 'bool',
      },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      {
        components: [
          {
            components: [
              {
                components: [
                  {
                    internalType: 'uint256',
                    name: 'x',
                    type: 'uint256',
                  },
                  {
                    internalType: 'uint256',
                    name: 'y',
                    type: 'uint256',
                  },
                ],
                internalType: 'struct G1Point',
                name: 'a',
                type: 'tuple',
              },
              {
                components: [
                  {
                    internalType: 'uint256[2]',
                    name: 'x',
                    type: 'uint256[2]',
                  },
                  {
                    internalType: 'uint256[2]',
                    name: 'y',
                    type: 'uint256[2]',
                  },
                ],
                internalType: 'struct G2Point',
                name: 'b',
                type: 'tuple',
              },
              {
                components: [
                  {
                    internalType: 'uint256',
                    name: 'x',
                    type: 'uint256',
                  },
                  {
                    internalType: 'uint256',
                    name: 'y',
                    type: 'uint256',
                  },
                ],
                internalType: 'struct G1Point',
                name: 'c',
                type: 'tuple',
              },
            ],
            internalType: 'struct SnarkProof',
            name: '_proof',
            type: 'tuple',
          },
          {
            internalType: 'address',
            name: '_adaptIDcontract',
            type: 'address',
          },
          {
            internalType: 'uint256',
            name: '_adaptIDparameters',
            type: 'uint256',
          },
          {
            internalType: 'uint256',
            name: '_depositAmount',
            type: 'uint256',
          },
          {
            internalType: 'uint256',
            name: '_withdrawAmount',
            type: 'uint256',
          },
          {
            internalType: 'address',
            name: '_tokenField',
            type: 'address',
          },
          {
            internalType: 'address',
            name: '_outputEthAddress',
            type: 'address',
          },
          {
            internalType: 'uint256',
            name: '_treeNumber',
            type: 'uint256',
          },
          {
            internalType: 'uint256',
            name: '_merkleRoot',
            type: 'uint256',
          },
          {
            internalType: 'uint256[]',
            name: '_nullifiers',
            type: 'uint256[]',
          },
          {
            components: [
              {
                internalType: 'uint256',
                name: 'hash',
                type: 'uint256',
              },
              {
                internalType: 'uint256[6]',
                name: 'ciphertext',
                type: 'uint256[6]',
              },
              {
                internalType: 'uint256[2]',
                name: 'senderPubKey',
                type: 'uint256[2]',
              },
            ],
            internalType: 'struct Commitment[3]',
            name: '_commitmentsOut',
            type: 'tuple[3]',
          },
        ],
        internalType: 'struct Transaction[]',
        name: '_transactions',
        type: 'tuple[]',
      },
    ],
    name: 'transact',
    outputs: [],
    stateMutability: 'payable',
    type: 'function',
  },
  {
    inputs: [],
    name: 'transferFee',
    outputs: [
      {
        internalType: 'uint256',
        name: '',
        type: 'uint256',
      },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      {
        internalType: 'address',
        name: 'newOwner',
        type: 'address',
      },
    ],
    name: 'transferOwnership',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [],
    name: 'treasury',
    outputs: [
      {
        internalType: 'address payable',
        name: '',
        type: 'address',
      },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'vKeyLarge',
    outputs: [
      {
        components: [
          {
            internalType: 'uint256',
            name: 'x',
            type: 'uint256',
          },
          {
            internalType: 'uint256',
            name: 'y',
            type: 'uint256',
          },
        ],
        internalType: 'struct G1Point',
        name: 'alpha1',
        type: 'tuple',
      },
      {
        components: [
          {
            internalType: 'uint256[2]',
            name: 'x',
            type: 'uint256[2]',
          },
          {
            internalType: 'uint256[2]',
            name: 'y',
            type: 'uint256[2]',
          },
        ],
        internalType: 'struct G2Point',
        name: 'beta2',
        type: 'tuple',
      },
      {
        components: [
          {
            internalType: 'uint256[2]',
            name: 'x',
            type: 'uint256[2]',
          },
          {
            internalType: 'uint256[2]',
            name: 'y',
            type: 'uint256[2]',
          },
        ],
        internalType: 'struct G2Point',
        name: 'gamma2',
        type: 'tuple',
      },
      {
        components: [
          {
            internalType: 'uint256[2]',
            name: 'x',
            type: 'uint256[2]',
          },
          {
            internalType: 'uint256[2]',
            name: 'y',
            type: 'uint256[2]',
          },
        ],
        internalType: 'struct G2Point',
        name: 'delta2',
        type: 'tuple',
      },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'vKeySmall',
    outputs: [
      {
        components: [
          {
            internalType: 'uint256',
            name: 'x',
            type: 'uint256',
          },
          {
            internalType: 'uint256',
            name: 'y',
            type: 'uint256',
          },
        ],
        internalType: 'struct G1Point',
        name: 'alpha1',
        type: 'tuple',
      },
      {
        components: [
          {
            internalType: 'uint256[2]',
            name: 'x',
            type: 'uint256[2]',
          },
          {
            internalType: 'uint256[2]',
            name: 'y',
            type: 'uint256[2]',
          },
        ],
        internalType: 'struct G2Point',
        name: 'beta2',
        type: 'tuple',
      },
      {
        components: [
          {
            internalType: 'uint256[2]',
            name: 'x',
            type: 'uint256[2]',
          },
          {
            internalType: 'uint256[2]',
            name: 'y',
            type: 'uint256[2]',
          },
        ],
        internalType: 'struct G2Point',
        name: 'gamma2',
        type: 'tuple',
      },
      {
        components: [
          {
            internalType: 'uint256[2]',
            name: 'x',
            type: 'uint256[2]',
          },
          {
            internalType: 'uint256[2]',
            name: 'y',
            type: 'uint256[2]',
          },
        ],
        internalType: 'struct G2Point',
        name: 'delta2',
        type: 'tuple',
      },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      {
        components: [
          {
            components: [
              {
                internalType: 'uint256',
                name: 'x',
                type: 'uint256',
              },
              {
                internalType: 'uint256',
                name: 'y',
                type: 'uint256',
              },
            ],
            internalType: 'struct G1Point',
            name: 'a',
            type: 'tuple',
          },
          {
            components: [
              {
                internalType: 'uint256[2]',
                name: 'x',
                type: 'uint256[2]',
              },
              {
                internalType: 'uint256[2]',
                name: 'y',
                type: 'uint256[2]',
              },
            ],
            internalType: 'struct G2Point',
            name: 'b',
            type: 'tuple',
          },
          {
            components: [
              {
                internalType: 'uint256',
                name: 'x',
                type: 'uint256',
              },
              {
                internalType: 'uint256',
                name: 'y',
                type: 'uint256',
              },
            ],
            internalType: 'struct G1Point',
            name: 'c',
            type: 'tuple',
          },
        ],
        internalType: 'struct SnarkProof',
        name: '_proof',
        type: 'tuple',
      },
      {
        internalType: 'address',
        name: '_adaptIDcontract',
        type: 'address',
      },
      {
        internalType: 'uint256',
        name: '_adaptIDparameters',
        type: 'uint256',
      },
      {
        internalType: 'uint256',
        name: '_depositAmount',
        type: 'uint256',
      },
      {
        internalType: 'uint256',
        name: '_withdrawAmount',
        type: 'uint256',
      },
      {
        internalType: 'address',
        name: '_tokenField',
        type: 'address',
      },
      {
        internalType: 'address',
        name: '_outputEthAddress',
        type: 'address',
      },
      {
        internalType: 'uint256',
        name: '_treeNumber',
        type: 'uint256',
      },
      {
        internalType: 'uint256',
        name: '_merkleRoot',
        type: 'uint256',
      },
      {
        internalType: 'uint256[]',
        name: '_nullifiers',
        type: 'uint256[]',
      },
      {
        components: [
          {
            internalType: 'uint256',
            name: 'hash',
            type: 'uint256',
          },
          {
            internalType: 'uint256[6]',
            name: 'ciphertext',
            type: 'uint256[6]',
          },
          {
            internalType: 'uint256[2]',
            name: 'senderPubKey',
            type: 'uint256[2]',
          },
        ],
        internalType: 'struct Commitment[3]',
        name: '_commitmentsOut',
        type: 'tuple[3]',
      },
    ],
    name: 'verifyProof',
    outputs: [
      {
        internalType: 'bool',
        name: '',
        type: 'bool',
      },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'withdrawFee',
    outputs: [
      {
        internalType: 'uint256',
        name: '',
        type: 'uint256',
      },
    ],
    stateMutability: 'view',
    type: 'function',
  },
];
