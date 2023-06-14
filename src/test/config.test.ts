// eslint-disable-next-line import/no-mutable-exports
let config = {
  rpc: 'http://localhost:8545/',
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
    testERC20: '0x202CCe504e04bEd6fC0521238dDf04Bc9E8E15aB',
    testERC721: '0xf4B146FbA71F41E0592668ffbF264F1D186b2Ca8',
    treasuryImplementation: '0xa513E6E4b8f2a923D98304ec87F64353C4D5C853',
    treasuryProxy: '0x8A791620dd6260079BF849Dc5567aDC3F2FdC318',
    voting: '0x0165878A594ca255338adfa4d48449f69242Eb8F',
    weth9: '0x8198f5d8F8CfFE8f9C413d98a0A55aEB8ab9FbB7',
    relayAdapt: '0x0355B7B8cb128fA5692729Ab3AAa199C1753f726',
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
