import chai from 'chai';
import memdown from 'memdown';
import { afterEach, beforeEach, describe, it } from 'mocha';
import type { Prover } from '../../prover/prover';
import { Database } from '../../database/database';
import { RailgunEngine } from '../../railgun-engine';
import { type PublicInputsRailgun } from '../../models';
import type { ArtifactGetter } from '../../models/prover-types';
import { HardwareWallet, type ExternalSignerConnector } from '../hardware-wallet';
import { ViewOnlyWallet } from '../view-only-wallet';

const { expect } = chai;

const testArtifactGetter: ArtifactGetter = {
  assertArtifactExists: () => {},
  getArtifacts: async () => {
    throw new Error('Artifacts not used in hardware wallet create/load tests.');
  },
  getArtifactsPOI: async () => {
    throw new Error('POI artifacts not used in hardware wallet create/load tests.');
  },
};

const testEncryptionKey = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const testSharedViewingKey = '82a57670726976d94034326232623861643234306331323630396633623265363865656137613636373330306437373332633335346238373338343266373433313135313836303066a473707562d94061316166356531353935616330303736303734646465653034323737356230363365366434653666313966613632633333323935636336643363646635313165';

describe('hardware-wallet', () => {
  let db: Database;
  let wallet: HardwareWallet;

  beforeEach(async () => {
    db = new Database(memdown());
    wallet = await HardwareWallet.fromShareableViewingKey(
      db,
      testEncryptionKey,
      testSharedViewingKey,
      undefined,
      {} as Prover,
    );
  });

  afterEach(async () => {
    await db.close();
  });

  it('delegates signing to the external signer connector', async () => {
    const publicInputs: PublicInputsRailgun = {
      merkleRoot: 11n,
      boundParamsHash: 12n,
      nullifiers: [13n, 14n],
      commitmentsOut: [15n, 16n],
    };
    const signature = {
      R8: [21n, 22n] as [bigint, bigint],
      S: 23n,
    };
    const received: {
      expectedHash?: bigint;
      publicInputs?: PublicInputsRailgun;
      subSession?: string;
    } = {};

    const connector: ExternalSignerConnector = {
      sign: async (expectedHash, connectorPublicInputs, connectorSubSession) => {
        received.expectedHash = expectedHash;
        received.publicInputs = connectorPublicInputs;
        received.subSession = connectorSubSession;
        return signature;
      },
    };

    wallet.setConnector(connector);

    const result = await wallet.sign(publicInputs, 'batch-sub-session');

    expect(result).to.deep.equal(signature);
    expect(received.expectedHash).to.be.a('bigint');
    expect(received.publicInputs).to.deep.equal(publicInputs);
    expect(received.subSession).to.equal('batch-sub-session');
  });

  it('treats batch approval as optional', async () => {
    wallet.setConnector({
      sign: async () => ({ R8: [1n, 2n], S: 3n }),
    });

    const result = await wallet.requestBatchApproval([]);

    expect(result).to.equal(undefined);
  });

  it('delegates batch approval when the connector provides it', async () => {
    const requests = [{ transaction: {} }] as const;
    let capturedRequests: readonly unknown[] | undefined;

    wallet.setConnector({
      sign: async () => ({ R8: [1n, 2n], S: 3n }),
      requestBatchApproval: async (connectorRequests) => {
        capturedRequests = connectorRequests;
        return 'batch-sub-session';
      },
    });

    const result = await wallet.requestBatchApproval(requests);

    expect(result).to.equal('batch-sub-session');
    expect(capturedRequests).to.equal(requests);
  });

  it('creates and loads hardware wallets through RailgunEngine', async () => {
    const connector: ExternalSignerConnector = {
      sign: async () => ({ R8: [1n, 2n], S: 3n }),
    };
    const engine = await RailgunEngine.initForWallet(
      'test wallet',
      memdown(),
      testArtifactGetter,
      async () => ({
        commitmentEvents: [],
        unshieldEvents: [],
        nullifierEvents: [],
      }),
      async () => [],
      async () => true,
      async () => ({ txidIndex: undefined, merkleroot: undefined }),
      undefined,
      false,
    );

    try {
      const createdWallet = await engine.createHardwareWalletFromShareableViewingKey(
        testEncryptionKey,
        testSharedViewingKey,
        undefined,
        connector,
      );

      expect(createdWallet.id).to.equal(wallet.id);

      engine.unloadWallet(createdWallet.id);

      const loadedWallet = await engine.loadExistingHardwareWallet(
        testEncryptionKey,
        createdWallet.id,
        connector,
      );

      expect(loadedWallet.id).to.equal(createdWallet.id);
      expect(await loadedWallet.sign({
        merkleRoot: 1n,
        boundParamsHash: 2n,
        nullifiers: [3n],
        commitmentsOut: [4n],
      }, '')).to.deep.equal({ R8: [1n, 2n], S: 3n });
    } finally {
      await engine.db.close();
    }
  });

  it('refreshes the connector when reloading an already loaded hardware wallet', async () => {
    const firstConnector: ExternalSignerConnector = {
      sign: async () => ({ R8: [1n, 2n], S: 3n }),
    };
    const secondConnector: ExternalSignerConnector = {
      sign: async () => ({ R8: [4n, 5n], S: 6n }),
    };
    const engine = await RailgunEngine.initForWallet(
      'test wallet',
      memdown(),
      testArtifactGetter,
      async () => ({
        commitmentEvents: [],
        unshieldEvents: [],
        nullifierEvents: [],
      }),
      async () => [],
      async () => true,
      async () => ({ txidIndex: undefined, merkleroot: undefined }),
      undefined,
      false,
    );

    try {
      const createdWallet = await engine.createHardwareWalletFromShareableViewingKey(
        testEncryptionKey,
        testSharedViewingKey,
        undefined,
        firstConnector,
      );

      const loadedWallet = await engine.loadExistingHardwareWallet(
        testEncryptionKey,
        createdWallet.id,
        secondConnector,
      );

      expect(loadedWallet).to.equal(createdWallet);
      expect(await loadedWallet.sign({
        merkleRoot: 1n,
        boundParamsHash: 2n,
        nullifiers: [3n],
        commitmentsOut: [4n],
      }, '')).to.deep.equal({ R8: [4n, 5n], S: 6n });
    } finally {
      await engine.db.close();
    }
  });

  it('replaces a loaded view-only wallet when loading the hardware wallet for the same ID', async () => {
    const connector: ExternalSignerConnector = {
      sign: async () => ({ R8: [7n, 8n], S: 9n }),
    };
    const engine = await RailgunEngine.initForWallet(
      'test wallet',
      memdown(),
      testArtifactGetter,
      async () => ({
        commitmentEvents: [],
        unshieldEvents: [],
        nullifierEvents: [],
      }),
      async () => [],
      async () => true,
      async () => ({ txidIndex: undefined, merkleroot: undefined }),
      undefined,
      false,
    );

    try {
      const viewOnlyWallet = await engine.createViewOnlyWalletFromShareableViewingKey(
        testEncryptionKey,
        testSharedViewingKey,
        undefined,
      );

      expect(viewOnlyWallet).to.be.instanceOf(ViewOnlyWallet);

      const loadedWallet = await engine.loadExistingHardwareWallet(
        testEncryptionKey,
        viewOnlyWallet.id,
        connector,
      );

      expect(loadedWallet).to.be.instanceOf(HardwareWallet);
      expect(loadedWallet.id).to.equal(viewOnlyWallet.id);
      expect(await loadedWallet.sign({
        merkleRoot: 1n,
        boundParamsHash: 2n,
        nullifiers: [3n],
        commitmentsOut: [4n],
      }, '')).to.deep.equal({ R8: [7n, 8n], S: 9n });
    } finally {
      await engine.db.close();
    }
  });
});