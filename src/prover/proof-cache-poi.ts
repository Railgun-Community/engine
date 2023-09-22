import EngineDebug from '../debugger/debugger';
import { Proof } from '../models/prover-types';
import { stringifySafe } from '../utils';

export class ProofCachePOI {
  private static cache: Map<string, Proof> = new Map();

  static get(blindedCommitmentsIn: string[], blindedCommitmentsOut: string[]): Optional<Proof> {
    try {
      const stringified = stringifySafe({ blindedCommitmentsIn, blindedCommitmentsOut });
      return ProofCachePOI.cache.get(stringified);
    } catch (err) {
      if (err instanceof Error) {
        EngineDebug.error(err);
      }
      return undefined;
    }
  }

  static store(blindedCommitmentsIn: string[], blindedCommitmentsOut: string[], proof: Proof) {
    try {
      const stringified = stringifySafe({ blindedCommitmentsIn, blindedCommitmentsOut });
      ProofCachePOI.cache.set(stringified, proof);
    } catch (err) {
      if (err instanceof Error) {
        EngineDebug.error(err);
      }
    }
  }
}
