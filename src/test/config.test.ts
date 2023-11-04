// eslint-disable-next-line import/no-mutable-exports
let config = {
  rpc: 'http://localhost:8545/',
  chainId: 31337,
  mnemonic: 'test test test test test test test test test test test junk',
  encryptionKey: '0101010101010101010101010101010101010101010101010101010101010101',
  contracts: {
    delegator: '0x2279B7A0a67DB372996a5FaB50D91eAA73d2eBe6',
    governorRewardsImplementation: '',
    governorRewardsProxy: '',
    implementation: '0x9A676e781A523b5d0C0e43731313A708CB607508',
    proxy: '0x0DCd1Bf9A1b36cE34237eEaFef220932846BCD82',
    proxyAdmin: '0xB7f8BC63BbcaD18155201308C8f3540b07f84F5e',
    rail: '0x5FC8d32690cc91D4c39d9d3abcBD16989F875707',
    staking: '0xa513E6E4b8f2a923D98304ec87F64353C4D5C853',
    testERC20: '0x4EE6eCAD1c2Dae9f525404De8555724e3c35d07B',
    testERC721: '0xBEc49fA140aCaA83533fB00A2BB19bDdd0290f25',
    treasuryImplementation: '0x610178dA211FEF7D417bC0e6FeD39F05609AD788',
    treasuryProxy: '0xA51c1fc2f0D1a1b8494Ed1FE312d7C3a78Ed91C0',
    voting: '0x8A791620dd6260079BF849Dc5567aDC3F2FdC318',
    weth9: '0xf4B146FbA71F41E0592668ffbF264F1D186b2Ca8',
    relayAdapt: '0x172076E0166D1F9Cc711C77Adf8488051744980C',
    PoseidonT3: '0x5FbDB2315678afecb367f032d93F642f64180aa3',
    PoseidonT4: '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512',
    DefaultAccount: '0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0',
    DefaultRegistry: '0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9',
    AccessCard: '0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9'
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
