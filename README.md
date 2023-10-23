[![Unit Tests](https://github.com/Railgun-Community/engine/actions/workflows/unit-tests.yml/badge.svg?branch=main)](https://github.com/Railgun-Community/engine/actions)
[![Integration Tests](https://github.com/Railgun-Community/engine/actions/workflows/integration-tests.yml/badge.svg?branch=main)](https://github.com/Railgun-Community/engine/actions)

# RAILGUN Engine SDK

Wallet framework for RAILGUN smart contracts and private balances on Ethereum and more.

Read about RAILGUN: www.railgun.org

For simple implementations, use [RAILGUN Wallet SDK](https://github.com/Railgun-Community/wallet).

## Installing

### With NPM

`npm install @railgun-community/engine`

### With Yarn

`yarn add @railgun-community/engine`

## Developing

### Install nodejs

- [Via NVM (recommended)](https://github.com/nvm-sh/nvm)
- [Via installer](https://nodejs.org)

### Install modules

`npm install` OR `yarn`

### Compile TypeScript

`npm compile` OR `yarn compile`

### Run unit tests

`npm test` OR `yarn test`

### Run all tests, including contract integration tests (requires Hardhat setup below)

`npm run test-hardhat` OR `yarn test-hardhat`

### Hardhat setup

Clone the contracts repo

`git clone git@github.com:Railgun-Privacy/contract.git`

Start hardhat node from the contract repo and leave it running

`npx hardhat node`

In another terminal deploy the contracts to the hardhat node network

`npx hardhat deploy:test --network localhost`

The default test config should work fine here as addresses are deterministic on the hardhat node network. If you are running your own test setup you will need to use the config override file. Copy `test/configOverrides.test.ts.example` to `test/configOverrides.test.ts` and enter your own values.

You can run subsequent test runs against the same hardhat node deployment as the testing suite will use snapshots to restore hardhat back to the initial state after each test. If for some reason the testing suite is interrupted before it can restore to snapshot you will need to terminate the hardhat node process, restart it, and run the deploy test script again.
