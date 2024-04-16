import { Chain } from '../models/engine-types';
import { TXIDVersion } from '../models/poi-types';
import { isDefined } from './is-defined';

const ANY_TXID_VERSION = 'any';

/**
 * A simple nested datastructure that holds information per-chain and per
 * RailgunTXIDVersion.
 */
export class Registry<T> {
  private data: { [txidVersion: string]: T[][] };

  constructor() {
    this.data = {};
  }

  set(txidVersion: TXIDVersion | null, chain: Chain, value: T) {
    this.data[txidVersion ?? ANY_TXID_VERSION] ??= [];
    this.data[txidVersion ?? ANY_TXID_VERSION][chain.type] ??= [];
    this.data[txidVersion ?? ANY_TXID_VERSION][chain.type][chain.id] = value;
  }

  has(txidVersion: TXIDVersion | null, chain: Chain): boolean {
    return isDefined(this.get(txidVersion, chain));
  }

  get(txidVersion: TXIDVersion | null, chain: Chain): Optional<T> {
    return this.data[txidVersion ?? ANY_TXID_VERSION]?.[chain.type]?.[chain.id];
  }

  getOrThrow(txidVersion: TXIDVersion | null, chain: Chain): T {
    const value = this.get(txidVersion, chain);
    if (!isDefined(value)) {
      throw new Error(
        `No value found for txidVersion=${String(txidVersion)} and chain=${chain.type}:${chain.id}`,
      );
    }
    return value;
  }

  del(txidVersion: TXIDVersion | null, chain: Chain) {
    delete this.data[txidVersion ?? ANY_TXID_VERSION]?.[chain.type]?.[chain.id];
  }

  forEach(callback: (value: T, txidVersion: TXIDVersion | null, chain: Chain) => void) {
    Object.keys(this.data).forEach((txidVersion) => {
      const declaredTxidVersion: TXIDVersion | null =
        txidVersion === ANY_TXID_VERSION ? null : (txidVersion as TXIDVersion);
      const perChainType = this.data[txidVersion] ?? [];
      perChainType.forEach((perChainID, chainType) => {
        perChainID.forEach((value, chainID) => {
          if (isDefined(value)) {
            const chain = { type: chainType, id: chainID };
            callback(value, declaredTxidVersion, chain);
          }
        });
      });
    });
  }

  map<R>(callback: (value: T, txidVersion: TXIDVersion | null, chain: Chain) => R): R[] {
    const result: R[] = [];
    this.forEach((value, txidVersion, chain) => {
      result.push(callback(value, txidVersion, chain));
    });
    return result;
  }
}
