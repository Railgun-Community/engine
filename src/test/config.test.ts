// eslint-disable-next-line import/no-mutable-exports
let config = {
  rpc: 'http://localhost:8545/',
  mnemonic: 'test test test test test test test test test test test junk',
  encryptionKey: '0101010101010101010101010101010101010101010101010101010101010101',
  contracts: {
    delegator: '0x0165878A594ca255338adfa4d48449f69242Eb8F',
    governorRewardsImplementation: '',
    governorRewardsProxy: '',
    implementation: '0xA51c1fc2f0D1a1b8494Ed1FE312d7C3a78Ed91C0',
    proxy: '0xB7f8BC63BbcaD18155201308C8f3540b07f84F5e',
    proxyAdmin: '0x8A791620dd6260079BF849Dc5567aDC3F2FdC318',
    rail: '0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0',
    nft: '0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9',
    staking: '0x5FC8d32690cc91D4c39d9d3abcBD16989F875707',
    treasuryImplementation: '0x2279B7A0a67DB372996a5FaB50D91eAA73d2eBe6',
    treasuryProxy: '0x610178dA211FEF7D417bC0e6FeD39F05609AD788',
    voting: '0xa513E6E4b8f2a923D98304ec87F64353C4D5C853',
    weth9: '0xc5a5C42992dECbae36851359345FE25997F5C42d',
    relayAdapt: '0x67d269191c92Caf3cD7723F116c85e6E9bf55933',
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
