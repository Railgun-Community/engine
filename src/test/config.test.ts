// eslint-disable-next-line import/no-mutable-exports
let config = {
  rpc: 'http://127.0.0.1:8545/',
  chainId: 31337,
  mnemonic: 'test test test test test test test test test test test junk',
  encryptionKey: '0101010101010101010101010101010101010101010101010101010101010101',
  contracts: {
    delegator: '0x5FC8d32690cc91D4c39d9d3abcBD16989F875707',
    governorRewardsImplementation: '',
    governorRewardsProxy: '',
    implementation: '0xB7f8BC63BbcaD18155201308C8f3540b07f84F5e',
    proxy: '0x610178dA211FEF7D417bC0e6FeD39F05609AD788',
    proxyAdmin: '0x2279B7A0a67DB372996a5FaB50D91eAA73d2eBe6',
    rail: '0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0',
    staking: '0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9',
    testERC20: '0x276C216D241856199A83bf27b2286659e5b877D3',
    testERC721: '0x3347B4d90ebe72BeFb30444C9966B2B990aE9FcB',
    treasuryImplementation: '0xa513E6E4b8f2a923D98304ec87F64353C4D5C853',
    treasuryProxy: '0x8A791620dd6260079BF849Dc5567aDC3F2FdC318',
    voting: '0x0165878A594ca255338adfa4d48449f69242Eb8F',
    weth9: '0xA7c59f010700930003b33aB25a7a0679C860f29c',
    relayAdapt: '0xfaAddC93baf78e89DCf37bA67943E1bE8F37Bb8c',
    relayAdapt7702: '0xB23994e75a0F1dFaF3A339B2b08BF13e06082A82',
    adapt7702Deployer: '0x3155755b79aA083bd953911C92705B7aA82a18F9',

    // V3
    poseidonMerkleAccumulatorV3: '0x2B0d36FACD61B71CC05ab8F3D2355ec3631C0dd5',
    poseidonMerkleVerifierV3: '0xfbC22278A96299D91d41C453234d97b4F5Eb9B2d',
    tokenVaultV3: '0xD84379CEae14AA33C123Af12424A37803F885889',
  },
};

try {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, global-require, @typescript-eslint/no-var-requires
  const { overrides } = require('./config-overrides.test');
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  config = { ...config, ...overrides };
  // eslint-disable-next-line no-empty
} catch {}

export { config };
