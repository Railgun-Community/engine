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

## API

There are many APIs that can be imported via `import { } from '@railgun-community/engine'` but the most important is `RailgunEngine`.

### General

Constructors

- `RailgunEngine.initForWallet()` (static method) creates an instance
- `RailgunEngine.initForPOINode()` (static method) creates an instance

Others

- `RailgunEngine.setEngineDebugger()` (static method)
- `railgunEngine.loadNetwork()` (instance method)
- `railgunEngine.unload()` (instance method)

### Wallet management

RAILGUN Wallet

- `railgunEngine.createWalletFromMnemonic()` (instance method)
- `railgunEngine.loadExistingWallet()` (instance method)

View-only RAILGUN Wallet

- `railgunEngine.createViewOnlyWalletFromShareableViewingKey()` (instance method)
- `railgunEngine.loadExistingViewOnlyWallet()` (instance method)

Teardown

- `railgunEngine.unloadWallet()` (instance method)
- `railgunEngine.deleteWallet()` (instance method)

### Scanning

"Scanning" consists of algorithms that fetch smart contract data to (re)build merkletree data structures, while also attempting to decrypt notes on the merkletrees, in order to calculate wallet balances.

- `railgunEngine.scanContractHistory()` (instance method)
- `railgunEngine.emitScanEventHistoryComplete()` (instance method)
- `railgunEngine.syncRailgunTransactionsV2()` (instance method)
- `railgunEngine.fullRescanUTXOMerkletreesAndWallets()` (instance method)
- `railgunEngine.fullResetTXIDMerkletreesV2()` (instance method)
- `railgunEngine.resetRailgunTxidsAfterTxidIndex()` (instance method)

### Getters

Merkletrees

- `railgunEngine.getUTXOMerkletree()` (instance method)
- `railgunEngine.getTXIDMerkletree()` (instance method)

Others

- `railgunEngine.getLatestRailgunTxidData()` (instance method)
- `railgunEngine.getCompletedTxidFromNullifiers()` (instance method)
- `railgunEngine.getAllShieldCommitments()` (instance method)

### Utilities

- `Mnemonic.generate()` (static method)
- `Mnemonic.validate()` (static method)
- `Mnemonic.toSeed()` (static method)
- `Mnemonic.toEntropy()` (static method)
- `Mnemonic.fromEntropy()` (static method)
- `Mnemonic.to0xPrivateKey()` (static method)
- `Mnemonic.to0xAddress()` (static method)
- `BlindedCommitment.getForUnshield()` (static method)
- `BlindedCommitment.getForShieldOrTransact()` (static method)
- `ByteUtils.u8ToBigInt()` (static method)
- `ByteUtils.hexToBigInt()` (static method)
- `ByteUtils.nToBytes()` (static method)
- `ByteUtils.nToHex()` (static method)
- `ByteUtils.bytesToN()` (static method)
- `ByteUtils.hexStringToBytes()` (static method)
- `ByteUtils.randomHex()` (static method)
- `ByteUtils.hexlify()` (static method)
- `ByteUtils.arrayify()` (static method)
- `ByteUtils.formatToByteLength()` (static method)
- `ByteUtils.hexToBytes()` (static method)
- `getGlobalTreePosition()`
- `convertTransactionStructToCommitmentSummary()`
- `encryptJSONDataWithSharedKey()`
- `tryDecryptJSONDataWithSharedKey()`
- `getPublicViewingKey()`

### Types

- `AddressData` for encoding 0zk addresses
- `SpendingPublicKey`
- `SpendingKeyPair`
- `ViewingKeyPair`
- `MerklerootValidator`
- `MerkletreeLeaf`
- `InvalidMerklerootDetails`
- `MerkletreesMetadata`
- `POINodeInterface`

## Developing

### Install nodejs

- [Via NVM (recommended)](https://github.com/nvm-sh/nvm)
- [Via installer](https://nodejs.org)

### Install modules

`npm install` OR `yarn`

### Build TypeScript

`npm build` OR `yarn build`

### Run unit tests

`npm test-V2` OR `yarn test-V2`

### Run all tests, including contract integration tests (requires Hardhat setup below)

`npm run test-hardhat-V2` OR `yarn test-hardhat-V2`

### Hardhat setup

Clone the contracts repo

`git clone git@github.com:Railgun-Privacy/contract.git`

Start hardhat node from the contract repo and leave it running

`npm run node`

In another terminal deploy the contracts to the hardhat node network

`npm run deploy`

The default test config should work fine here as addresses are deterministic on the hardhat node network. If you are running your own test setup you will need to use the config override file. Copy `test/configOverrides.test.ts.example` to `test/configOverrides.test.ts` and enter your own values.

You can run subsequent test runs against the same hardhat node deployment as the testing suite will use snapshots to restore hardhat back to the initial state after each test. If for some reason the testing suite is interrupted before it can restore to snapshot you will need to terminate the hardhat node process, restart it, and run the deploy test script again.

In some situations it will be useful to recompile the contract from scratch. In that case, first run `npm run clean` and then `npm run compile`, after which it is safe to re-run the node and deploy script.
