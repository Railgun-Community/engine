/// <reference types="../../../types/global" />
import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import memdown from 'memdown';
import { groth16 } from 'snarkjs';
import { JsonRpcProvider } from '@ethersproject/providers';
import { testArtifactsGetter } from '../../../test/helper.test';
import { Groth16 } from '../../../prover/prover';
import { Chain, ChainType } from '../../../models/engine-types';
import { RailgunEngine } from '../../../railgun-engine';
import { RailgunSmartWalletContract } from '../railgun-smart-wallet';
import { ContractStore } from '../../contract-store';

chai.use(chaiAsPromised);
const { expect } = chai;

let provider: JsonRpcProvider;
let chain: Chain;
let engine: RailgunEngine;
let railgunSmartWalletContract: RailgunSmartWalletContract;

describe('Railgun Smart Wallet - Live events', function runTests() {
  this.timeout(10000);

  beforeEach(async () => {
    engine = new RailgunEngine(
      'Test RSW',
      memdown(),
      testArtifactsGetter,
      undefined, // quickSync
      undefined, // engineDebugger
      undefined, // skipMerkletreeScans
    );

    engine.prover.setSnarkJSGroth16(groth16 as Groth16);

    provider = new JsonRpcProvider('https://cloudflare-eth.com');
    chain = {
      type: ChainType.EVM,
      id: (await provider.getNetwork()).chainId,
    };
    await engine.loadNetwork(chain, '0xfa7093cdd9ee6932b4eb2c9e1cde7ce00b1fa4b9', '', provider, 0);
    railgunSmartWalletContract = ContractStore.railgunSmartWalletContracts[chain.type][chain.id];
  });

  it('Should find legacy Pre-V3 Shield event - live ETH event query', async () => {
    let foundShieldEvents = 0;
    await railgunSmartWalletContract.getHistoricalEvents(
      chain,
      15834900,
      15834950,
      async () => 15834900,
      async () => {
        foundShieldEvents += 1;
      },
      async () => {},
      async () => {},
      async () => {},
    );
    expect(foundShieldEvents).to.equal(1);
  }).timeout(10000);

  it('Should find legacy Pre-Mar-23 Shield event - live ETH event query', async () => {
    let foundShieldEvents = 0;
    await railgunSmartWalletContract.getHistoricalEvents(
      chain,
      16748340,
      16748380,
      async () => 16748340,
      async () => {
        foundShieldEvents += 1;
      },
      async () => {},
      async () => {},
      async () => {},
    );
    expect(foundShieldEvents).to.equal(1);
  }).timeout(10000);

  it('Should find newest Shield event - live ETH event query', async () => {
    let foundShieldEvents = 0;
    await railgunSmartWalletContract.getHistoricalEvents(
      chain,
      16820930,
      16820940,
      async () => 16820930,
      async () => {
        foundShieldEvents += 1;
      },
      async () => {},
      async () => {},
      async () => {},
    );
    expect(foundShieldEvents).to.equal(1);
  }).timeout(10000);

  afterEach(async () => {
    engine.unload();
  });
});
