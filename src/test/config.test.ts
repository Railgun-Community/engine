// eslint-disable-next-line import/no-mutable-exports
let config = {
  rpc: 'http://localhost:8545/',
  mnemonic: 'test test test test test test test test test test test junk',
  encryptionKey: '0101010101010101010101010101010101010101010101010101010101010101',
  contracts: {
    rail: '0x5FbDB2315678afecb367f032d93F642f64180aa3',
    staking: '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512',
    delegator: '0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0',
    voting: '0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9',
    treasury: '0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9',
    implementation: '0x610178dA211FEF7D417bC0e6FeD39F05609AD788',
    proxyAdmin: '0x0165878A594ca255338adfa4d48449f69242Eb8F',
    proxy: '0xa513E6E4b8f2a923D98304ec87F64353C4D5C853',
    weth9: '0x3Aa5ebB10DC797CAC828524e59A333d0A371443c',
    relayAdapt: '0xc6e7DF5E7b4f2A278906862b61205850344D4e7d',
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
