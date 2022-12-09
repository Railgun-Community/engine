import { Chain } from '../models/engine-types';
import { RailgunSmartWalletContract } from './railgun-smart-wallet/railgun-smart-wallet';
import { RelayAdaptContract } from './relay-adapt/relay-adapt';

export class ContractStore {
  static readonly railgunSmartWalletContracts: RailgunSmartWalletContract[][] = [];

  static readonly relayAdaptContracts: RelayAdaptContract[][] = [];

  static getRailgunSmartWalletContract(chain: Chain): RailgunSmartWalletContract {
    try {
      return this.railgunSmartWalletContracts[chain.type][chain.id];
    } catch {
      throw new Error('No RailgunSmartWalletContract loaded.');
    }
  }

  static getRelayAdaptContract(chain: Chain): RelayAdaptContract {
    try {
      return this.relayAdaptContracts[chain.type][chain.id];
    } catch {
      throw new Error('No RelayAdaptContract loaded.');
    }
  }
}
