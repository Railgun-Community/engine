# @railgun-community/lepton
Wallet framework for Railgun

## Installing
### With NPM
`npm install @railgun-community/lepton`

### With Yarn
`yarn add @railgun-community/lepton`

## Developing
### Install nodejs
- [Via NVM (recommended)](https://github.com/nvm-sh/nvm)
- [Via installer](https://nodejs.org)

### Install modules
`npm install` OR `yarn install`

### Test environment setup
Clone the contracts repo

`git clone git@github.com:Railgun-Privacy/contract.git`

Start hardhat node from the contract repo and leave it running

`npx hardhat node`

In another terminal deploy the contracts to the hardhat node network

`npx hardhat run scripts/deploy_test_all.js ---network localhost`

The default test config should work fine here as addresses are deterministic on the hardhat node network. If you are running your own test setup you will need to use the config override file. Copy `test/configOverrides.test.ts.example` to `test/configOverrides.test.ts` and enter your own values.

You can run subsequent test runs against the same hardhat node deployment as the testing suite will use snapshots to restore hardhat back to the initial state after each test. If for some reason the testing suite is interrupted before it can restore to snapshot you will need to terminate the hardhat node process, restart it, and run the deploy test script again.

### Run mocha tests
`npm test` OR `yarn run test`

### Compile
`npm compile` OR `yarn run compile`

### Clean compile directory
`npm clean` OR `yarn run clean`
