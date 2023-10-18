/// <reference types="../../../types/global" />
import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import memdown from 'memdown';
import { groth16 } from 'snarkjs';
import {
  mockGetLatestValidatedRailgunTxid,
  mockQuickSyncEvents,
  mockQuickSyncRailgunTransactions,
  mockRailgunTxidMerklerootValidator,
  testArtifactsGetter,
} from '../../../test/helper.test';
import { SnarkJSGroth16 } from '../../../prover/prover';
import { Chain, ChainType } from '../../../models/engine-types';
import { RailgunEngine } from '../../../railgun-engine';
import { RailgunSmartWalletContract } from '../railgun-smart-wallet';
import { ContractStore } from '../../contract-store';
import { PollingJsonRpcProvider } from '../../../provider/polling-json-rpc-provider';
import { CommitmentEvent } from '../../../models/event-types';
import { CommitmentType, Nullifier } from '../../../models/formatted-types';
import { createPollingJsonRpcProviderForListeners } from '../../../provider/polling-util';
import { TXIDVersion } from '../../../models/poi-types';

chai.use(chaiAsPromised);
const { expect } = chai;

let provider: PollingJsonRpcProvider;
let chain: Chain;
let engine: RailgunEngine;
let railgunSmartWalletContract: RailgunSmartWalletContract;

const testHistoricalEventsForRange = async (startBlock: number, endBlock: number) => {
  let foundShieldEvents = 0;
  let foundTransact = 0;
  let foundNullifiers = 0;
  await railgunSmartWalletContract.getHistoricalEvents(
    chain,
    startBlock,
    endBlock,
    async () => startBlock,
    async (txidVersion: TXIDVersion, event: CommitmentEvent) => {
      if (event.commitments.length < 1) {
        throw new Error('No parsed commitments found in event');
      }
      expect(txidVersion).to.equal(TXIDVersion.V2_PoseidonMerkle);
      expect(event.txid).to.be.a('string');
      expect(event.blockNumber).to.be.a('number');
      expect(event.startPosition).to.be.a('number');
      expect(event.treeNumber).to.be.a('number');
      expect(event.commitments[0].blockNumber).to.be.a('number');
      expect(event.commitments[0].commitmentType).to.be.a('string');
      expect(event.commitments[0].hash).to.be.a('string');
      expect(event.commitments[0].txid).to.be.a('string');
      expect(event.commitments[0].timestamp).to.equal(undefined);
      const { commitmentType } = event.commitments[0];
      switch (commitmentType) {
        case CommitmentType.LegacyGeneratedCommitment:
        case CommitmentType.ShieldCommitment:
          foundShieldEvents += 1;
          break;
        case CommitmentType.LegacyEncryptedCommitment:
        case CommitmentType.TransactCommitment:
          foundTransact += 1;
          break;
      }
    },
    async (txidVersion: TXIDVersion, nullifier: Nullifier[]) => {
      expect(txidVersion).to.equal(TXIDVersion.V2_PoseidonMerkle);
      if (nullifier.length) {
        expect(nullifier[0].blockNumber).to.be.a('number');
        expect(nullifier[0].nullifier).to.be.a('string');
        expect(nullifier[0].treeNumber).to.be.a('number');
        expect(nullifier[0].txid).to.be.a('string');
      }
      foundNullifiers += nullifier.length;
    },
    async () => {},
    async () => {},
  );
  expect(foundShieldEvents).to.be.greaterThanOrEqual(1);
  expect(foundTransact).to.be.greaterThanOrEqual(1);
  expect(foundNullifiers).to.be.greaterThanOrEqual(1);
};

describe('railgun-smart-wallet-events', function runTests() {
  this.timeout(20000);

  beforeEach(async () => {
    engine = RailgunEngine.initForWallet(
      'Test RSW',
      memdown(),
      testArtifactsGetter,
      mockQuickSyncEvents,
      mockQuickSyncRailgunTransactions,
      mockRailgunTxidMerklerootValidator,
      mockGetLatestValidatedRailgunTxid,
      undefined, // engineDebugger
      undefined, // skipMerkletreeScans
    );

    engine.prover.setSnarkJSGroth16(groth16 as SnarkJSGroth16);

    provider = new PollingJsonRpcProvider('https://rpc.ankr.com/eth', 1, 100);

    chain = {
      type: ChainType.EVM,
      id: Number((await provider.getNetwork()).chainId),
    };
    const fakeRelayAdaptContract = '0xfa7093cdd9ee6932b4eb2c9e1cde7ce00b1fa4b9';
    const pollingProvider = await createPollingJsonRpcProviderForListeners(provider, chain.id);
    await engine.loadNetwork(
      chain,
      '0xfa7093cdd9ee6932b4eb2c9e1cde7ce00b1fa4b9', // Live ETH proxy
      fakeRelayAdaptContract,
      provider,
      pollingProvider,
      { [TXIDVersion.V2_PoseidonMerkle]: 0 },
      0,
    );
    railgunSmartWalletContract = ContractStore.railgunSmartWalletContracts[chain.type][chain.id];
  });

  it('Should find legacy Pre-V3 events - live ETH event query', async () => {
    await testHistoricalEventsForRange(15834900, 15835950);
  }).timeout(20000);

  it('Should find legacy Pre-Mar-23 events - live ETH event query', async () => {
    await testHistoricalEventsForRange(16748340, 16749380);
  }).timeout(20000);

  it('Should find latest events - live ETH event query', async () => {
    await testHistoricalEventsForRange(16820930, 16821940);
  }).timeout(20000);

  afterEach(async () => {
    await engine.unload();
  });
});
