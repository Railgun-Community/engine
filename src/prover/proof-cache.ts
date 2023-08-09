import EngineDebug from '../debugger/debugger';
import { Proof, UnprovedTransactionInputs } from '../models/prover-types';
import { stringifySafe } from '../utils';

export class ProofCache {
  private static cache: Record<string, Proof> = {};

  static get(transactionRequest: UnprovedTransactionInputs): Optional<Proof> {
    try {
      const stringified = stringifySafe(transactionRequest);
      return ProofCache.cache[stringified];
    } catch (err) {
      if (err instanceof Error) {
        EngineDebug.error(err);
      }
      return undefined;
    }
  }

  static store(transactionRequest: UnprovedTransactionInputs, proof: Proof) {
    try {
      const stringified = stringifySafe(transactionRequest);
      ProofCache.cache[stringified] = proof;
    } catch (err) {
      if (err instanceof Error) {
        EngineDebug.error(err);
      }
    }
  }
}
