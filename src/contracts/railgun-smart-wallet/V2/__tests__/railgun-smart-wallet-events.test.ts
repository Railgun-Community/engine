/// <reference types="../../../../types/global" />
import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import memdown from 'memdown';
import { groth16 } from 'snarkjs';
import {
  isV2Test,
  mockGetLatestValidatedRailgunTxid,
  mockQuickSyncEvents,
  mockQuickSyncRailgunTransactionsV2,
  mockRailgunTxidMerklerootValidator,
  testArtifactsGetter,
} from '../../../../test/helper.test';
import { SnarkJSGroth16 } from '../../../../prover/prover';
import { Chain, ChainType } from '../../../../models/engine-types';
import { RailgunEngine } from '../../../../railgun-engine';
import { PollingJsonRpcProvider } from '../../../../provider/polling-json-rpc-provider';
import { CommitmentEvent } from '../../../../models/event-types';
import { CommitmentType, Nullifier } from '../../../../models/formatted-types';
import { createPollingJsonRpcProviderForListeners } from '../../../../provider/polling-util';
import { TXIDVersion } from '../../../../models/poi-types';
import { RailgunVersionedSmartContracts } from '../../railgun-versioned-smart-contracts';

chai.use(chaiAsPromised);
const { expect } = chai;

let provider: PollingJsonRpcProvider;
let chain: Chain;
let engine: RailgunEngine;

const testHistoricalEventsForRange = async (
  txidVersion: TXIDVersion,
  startBlock: number,
  endBlock: number,
) => {
  let foundShieldEvents = 0;
  let foundTransact = 0;
  let foundNullifiers = 0;
  await RailgunVersionedSmartContracts.getHistoricalEvents(
    txidVersion,
    chain,
    startBlock,
    endBlock,
    async () => startBlock,
    async (txidVersionEvent: TXIDVersion, events: CommitmentEvent[]) => {
      const event = events[0];
      if (event.commitments.length < 1) {
        throw new Error('No parsed commitments found in event');
      }
      expect(txidVersionEvent).to.equal(txidVersion);
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
        case CommitmentType.TransactCommitmentV2:
        case CommitmentType.TransactCommitmentV3:
          foundTransact += 1;
          break;
      }
    },
    async (txidVersionEvent: TXIDVersion, nullifier: Nullifier[]) => {
      expect(txidVersionEvent).to.equal(txidVersion);
      if (nullifier.length) {
        expect(nullifier[0].blockNumber).to.be.a('number');
        expect(nullifier[0].nullifier).to.be.a('string');
        expect(nullifier[0].treeNumber).to.be.a('number');
        expect(nullifier[0].txid).to.be.a('string');
      }
      foundNullifiers += nullifier.length;
    },
    async () => { },
    async () => { },
    async () => { },
  );
  expect(foundShieldEvents).to.be.greaterThanOrEqual(1);
  expect(foundTransact).to.be.greaterThanOrEqual(1);
  expect(foundNullifiers).to.be.greaterThanOrEqual(1);
};

describe('railgun-smart-wallet-events', function runTests() {
  this.timeout(20000);

  beforeEach(async () => {
    engine = await RailgunEngine.initForWallet(
      'Test RSW',
      memdown(),
      testArtifactsGetter,
      mockQuickSyncEvents,
      mockQuickSyncRailgunTransactionsV2,
      mockRailgunTxidMerklerootValidator,
      mockGetLatestValidatedRailgunTxid,
      undefined, // engineDebugger
      undefined, // skipMerkletreeScans
    );

    engine.prover.setSnarkJSGroth16(groth16 as SnarkJSGroth16);

    provider = new PollingJsonRpcProvider('https://eth.llamarpc.com', 1, 100);

    chain = {
      type: ChainType.EVM,
      id: Number((await provider.getNetwork()).chainId),
    };
    const pollingProvider = await createPollingJsonRpcProviderForListeners(provider, chain.id);
    await engine.loadNetwork(
      chain,
      '0xfa7093cdd9ee6932b4eb2c9e1cde7ce00b1fa4b9', // Live ETH proxy
      '0xfa7093cdd9ee6932b4eb2c9e1cde7ce00b1fa4b9', // placeholder
      '0xfa7093cdd9ee6932b4eb2c9e1cde7ce00b1fa4b9', // placeholder
      '0xfa7093cdd9ee6932b4eb2c9e1cde7ce00b1fa4b9', // placeholder
      '0xfa7093cdd9ee6932b4eb2c9e1cde7ce00b1fa4b9', // placeholder
      provider,
      pollingProvider,
      { [TXIDVersion.V2_PoseidonMerkle]: 0, [TXIDVersion.V3_PoseidonMerkle]: 0 },
      0,
      false, // supportsV3
    );
  });

  it('[V2] Should find legacy Pre-V2 events - live ETH event query', async function run() {
    if (!isV2Test()) {
      this.skip();
      return;
    }
    await testHistoricalEventsForRange(TXIDVersion.V2_PoseidonMerkle, 15834900, 15835950);
  }).timeout(20000);

  it('[V2] Should find legacy Pre-Mar-23 events - live ETH event query', async function run() {
    if (!isV2Test()) {
      this.skip();
      return;
    }
    await testHistoricalEventsForRange(TXIDVersion.V2_PoseidonMerkle, 16748340, 16749380);
  }).timeout(20000);

  it('[V2] Should find latest V2 events - live ETH event query', async function run() {
    if (!isV2Test()) {
      this.skip();
      return;
    }
    await testHistoricalEventsForRange(TXIDVersion.V2_PoseidonMerkle, 16820930, 16821940);
  }).timeout(20000);

  afterEach(async () => {
    await engine.unload();
  });
});
