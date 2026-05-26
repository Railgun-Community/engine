import chai from 'chai';
import {
  getEngineTxidSyncBatchSize,
  setEngineTxidSyncBatchSize,
} from '../txid-sync-batch-size';

const { expect } = chai;

describe('txid-sync-batch-size', () => {
  // The knob is process-global; restore the default after each test so
  // unrelated suites that inspect the value aren't perturbed.
  const DEFAULT = 10_000;

  afterEach(() => {
    setEngineTxidSyncBatchSize(DEFAULT);
  });

  it('defaults to 10_000', () => {
    expect(getEngineTxidSyncBatchSize()).to.equal(DEFAULT);
  });

  it('updates when given a positive integer', () => {
    setEngineTxidSyncBatchSize(2_000);
    expect(getEngineTxidSyncBatchSize()).to.equal(2_000);
  });

  it('floors fractional values', () => {
    setEngineTxidSyncBatchSize(1_500.9);
    expect(getEngineTxidSyncBatchSize()).to.equal(1_500);
  });

  it('ignores zero, negative, and non-finite values', () => {
    setEngineTxidSyncBatchSize(500);
    setEngineTxidSyncBatchSize(0);
    expect(getEngineTxidSyncBatchSize()).to.equal(500);
    setEngineTxidSyncBatchSize(-100);
    expect(getEngineTxidSyncBatchSize()).to.equal(500);
    setEngineTxidSyncBatchSize(Number.NaN);
    expect(getEngineTxidSyncBatchSize()).to.equal(500);
    setEngineTxidSyncBatchSize(Number.POSITIVE_INFINITY);
    expect(getEngineTxidSyncBatchSize()).to.equal(500);
  });
});
