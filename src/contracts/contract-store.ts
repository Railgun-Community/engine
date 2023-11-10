import { Chain } from '../models/engine-types';
import { RailgunSmartWalletContract } from './railgun-smart-wallet/V2/railgun-smart-wallet';
import { PoseidonMerkleAccumulatorContract } from './railgun-smart-wallet/V3/poseidon-merkle-accumulator';
import { PoseidonMerkleVerifierContract } from './railgun-smart-wallet/V3/poseidon-merkle-verifier';
import { TokenVaultContract } from './railgun-smart-wallet/V3/token-vault-contract';
import { RelayAdaptV2Contract } from './relay-adapt/V2/relay-adapt-v2';
import { PoseidonMerkleAdaptV3Contract } from './relay-adapt/V3/poseidon-merkle-adapt-v3';

export class ContractStore {
  static readonly railgunSmartWalletV2Contracts: RailgunSmartWalletContract[][] = [];

  static readonly relayAdaptV2Contracts: RelayAdaptV2Contract[][] = [];

  static readonly poseidonMerkleAccumulatorV3Contracts: PoseidonMerkleAccumulatorContract[][] = [];

  static readonly poseidonMerkleVerifierV3Contracts: PoseidonMerkleVerifierContract[][] = [];

  static readonly tokenVaultV3Contracts: TokenVaultContract[][] = [];

  static readonly poseidonMerkleAdaptV3Contracts: PoseidonMerkleAdaptV3Contract[][] = [];

  static getRailgunSmartWalletContract(chain: Chain): RailgunSmartWalletContract {
    try {
      return this.railgunSmartWalletV2Contracts[chain.type][chain.id];
    } catch (cause) {
      throw new Error('No RailgunSmartWalletContract loaded.', { cause });
    }
  }

  static getRelayAdaptV2Contract(chain: Chain): RelayAdaptV2Contract {
    try {
      return this.relayAdaptV2Contracts[chain.type][chain.id];
    } catch (cause) {
      throw new Error('No RelayAdaptV2Contract loaded.', { cause });
    }
  }

  static getPoseidonMerkleAdaptV3Contract(chain: Chain): PoseidonMerkleAdaptV3Contract {
    try {
      return this.poseidonMerkleAdaptV3Contracts[chain.type][chain.id];
    } catch (cause) {
      throw new Error('No PoseidonMerkleAdaptV3Contract loaded.', { cause });
    }
  }

  static getPoseidonMerkleAccumulatorV3Contract(chain: Chain): PoseidonMerkleAccumulatorContract {
    try {
      return this.poseidonMerkleAccumulatorV3Contracts[chain.type][chain.id];
    } catch (cause) {
      throw new Error('No PoseidonMerkleAccumulatorV3Contract loaded.', { cause });
    }
  }

  static getPoseidonMerkleVerifierV3Contract(chain: Chain): PoseidonMerkleVerifierContract {
    try {
      return this.poseidonMerkleVerifierV3Contracts[chain.type][chain.id];
    } catch (cause) {
      throw new Error('No PoseidonMerkleVerifierV3Contract loaded.', { cause });
    }
  }

  static getTokenVaultV3Contract(chain: Chain): TokenVaultContract {
    try {
      return this.tokenVaultV3Contracts[chain.type][chain.id];
    } catch (cause) {
      throw new Error('No TokenVaultV3Contract loaded.', { cause });
    }
  }
}
