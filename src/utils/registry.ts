import { Chain, TXIDVersion } from '../models';
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

  del(txidVersion: TXIDVersion | null, chain: Chain) {
    delete this.data[txidVersion ?? ANY_TXID_VERSION]?.[chain.type]?.[chain.id];
  }

  forEach(txidVersion: TXIDVersion | null, callback: (value: T) => void) {
    const perChainType = this.data[txidVersion ?? ANY_TXID_VERSION] ?? [];
    perChainType.forEach((perChainID) => {
      perChainID.forEach((value) => {
        if (isDefined(value)) {
          callback(value);
        }
      });
    });
  }

  map<R>(txidVersion: TXIDVersion | null, callback: (value: T) => R): R[] {
    const result: R[] = [];
    this.forEach(txidVersion, (value) => {
      result.push(callback(value));
    });
    return result;
  }
}
