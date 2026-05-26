// One value drives three things that all need to agree:
//   1. The quickSync source caps each callback return at this many txs (so the
//      digest source uses this as its BATCH_SIZE).
//   2. The engine's outer sync loop continues only while the last callback
//      returned exactly this many txs (i.e., a full batch implies "more data
//      remaining"); a partial batch terminates the loop.
//   3. The engine's handleNewRailgunTransactionsV2 flushes its toQueue to DB
//      every N validated txs (durable checkpoint granularity).
//
// All three must use the same N. If the source returns 5_000 but the engine
// expects 10_000 to keep looping, the engine exits prematurely after one
// iteration, slowing multi-batch scans. If the insert flush were larger than
// the download cap, the flush would only ever happen at end-of-batch, defeating
// the checkpoint purpose.
//
// Default 10_000 matches the prior hardcoded behavior. Apps that want tighter
// crash-recovery checkpoints (mobile clients on flaky networks, extension
// popups that may be killed mid-scan) can lower this — e.g. 2_000.

const DEFAULT_TXID_SYNC_BATCH_SIZE = 10_000;

let txidSyncBatchSize = DEFAULT_TXID_SYNC_BATCH_SIZE;

export const setEngineTxidSyncBatchSize = (n: number): void => {
  if (!Number.isFinite(n) || n <= 0) return;
  txidSyncBatchSize = Math.floor(n);
};

export const getEngineTxidSyncBatchSize = (): number => txidSyncBatchSize;
