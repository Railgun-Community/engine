// eslint-disable-next-line import/no-mutable-exports
let config = {
  rpc: 'http://localhost:8545/',
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
    testERC20: '0x67d269191c92Caf3cD7723F116c85e6E9bf55933',
    testERC721: '0xE6E340D132b5f46d1e472DebcD681B2aBc16e57E',
    treasuryImplementation: '0xa513E6E4b8f2a923D98304ec87F64353C4D5C853',
    treasuryProxy: '0x8A791620dd6260079BF849Dc5567aDC3F2FdC318',
    voting: '0x0165878A594ca255338adfa4d48449f69242Eb8F',
    weth9: '0x09635F643e140090A9A8Dcd712eD6285858ceBef',
    relayAdapt: '0xc5a5C42992dECbae36851359345FE25997F5C42d',
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
