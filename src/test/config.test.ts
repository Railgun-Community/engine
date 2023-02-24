// eslint-disable-next-line import/no-mutable-exports
let config = {
  rpc: 'http://localhost:8545/',
  mnemonic: 'test test test test test test test test test test test junk',
  encryptionKey: '0101010101010101010101010101010101010101010101010101010101010101',
  contracts: {
    delegator: '0x8198f5d8F8CfFE8f9C413d98a0A55aEB8ab9FbB7',
    governorRewardsImplementation: '',
    governorRewardsProxy: '',
    implementation: '0xBEc49fA140aCaA83533fB00A2BB19bDdd0290f25',
    proxy: '0x4EE6eCAD1c2Dae9f525404De8555724e3c35d07B',
    proxyAdmin: '0xf4B146FbA71F41E0592668ffbF264F1D186b2Ca8',
    rail: '0xDC11f7E700A4c898AE5CAddB1082cFfa76512aDD',
    staking: '0x36b58F5C1969B7b6591D752ea6F5486D069010AB',
    testERC20: '0x6C2d83262fF84cBaDb3e416D527403135D757892',
    testERC721: '0xFD6F7A6a5c21A3f503EBaE7a473639974379c351',
    treasuryImplementation: '0x202CCe504e04bEd6fC0521238dDf04Bc9E8E15aB',
    treasuryProxy: '0x172076E0166D1F9Cc711C77Adf8488051744980C',
    voting: '0x0355B7B8cb128fA5692729Ab3AAa199C1753f726',
    weth9: '0x02b0B4EFd909240FCB2Eb5FAe060dC60D112E3a4',
    relayAdapt: '0x638A246F0Ec8883eF68280293FFE8Cfbabe61B44',
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
