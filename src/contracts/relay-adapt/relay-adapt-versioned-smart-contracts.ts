import { ContractTransaction } from 'ethers';
import { ContractStore } from '../contract-store';
import { Chain } from '../../models/engine-types';
import { TXIDVersion } from '../../models/poi-types';
import { ShieldRequestStruct } from '../../abi/typechain/RelayAdapt';
import { TransactionStructV2, TransactionStructV3 } from '../../models';

export class RelayAdaptVersionedSmartContracts {
  static getRelayAdaptContract(txidVersion: TXIDVersion, chain: Chain) {
    switch (txidVersion) {
      case TXIDVersion.V2_PoseidonMerkle: {
        const contractV2 = ContractStore.getRelayAdaptV2Contract(chain);
        return contractV2;
      }
      case TXIDVersion.V3_PoseidonMerkle: {
        const contractV3PoseidonMerkleAccumulator = ContractStore.getRelayAdaptV3Contract(chain);
        return contractV3PoseidonMerkleAccumulator;
      }
    }
    throw new Error('Unsupported txidVersion');
  }

  static populateShieldBaseToken(
    txidVersion: TXIDVersion,
    chain: Chain,
    shieldRequest: ShieldRequestStruct,
  ): Promise<ContractTransaction> {
    return this.getRelayAdaptContract(txidVersion, chain).populateShieldBaseToken(shieldRequest);
  }

  static populateUnshieldBaseToken(
    txidVersion: TXIDVersion,
    chain: Chain,
    transactions: (TransactionStructV2 | TransactionStructV3)[],
    unshieldAddress: string,
    random31Bytes: string,
  ): Promise<ContractTransaction> {
    switch (txidVersion) {
      case TXIDVersion.V2_PoseidonMerkle: {
        const contractV2 = ContractStore.getRelayAdaptV2Contract(chain);
        return contractV2.populateUnshieldBaseToken(
          transactions as TransactionStructV2[],
          unshieldAddress,
          random31Bytes,
        );
      }
      case TXIDVersion.V3_PoseidonMerkle: {
        const contractV3 = ContractStore.getRelayAdaptV3Contract(chain);
        return contractV3.populateUnshieldBaseToken(
          transactions as TransactionStructV2[],
          unshieldAddress,
          random31Bytes,
        );
      }
    }
    throw new Error('Unsupported txidVersion');
  }

  static populateCrossContractCalls(
    txidVersion: TXIDVersion,
    chain: Chain,
    unshieldTransactions: (TransactionStructV2 | TransactionStructV3)[],
    crossContractCalls: ContractTransaction[],
    relayShieldRequests: ShieldRequestStruct[],
    random31Bytes: string,
    isGasEstimate: boolean,
    isRelayerTransaction: boolean,
    minGasLimit?: bigint,
  ): Promise<ContractTransaction> {
    switch (txidVersion) {
      case TXIDVersion.V2_PoseidonMerkle: {
        const contractV2 = ContractStore.getRelayAdaptV2Contract(chain);
        return contractV2.populateCrossContractCalls(
          unshieldTransactions as TransactionStructV2[],
          crossContractCalls,
          relayShieldRequests,
          random31Bytes,
          isGasEstimate,
          isRelayerTransaction,
          minGasLimit,
        );
      }
      case TXIDVersion.V3_PoseidonMerkle: {
        const contractV3 = ContractStore.getRelayAdaptV3Contract(chain);
        return contractV3.populateCrossContractCalls(
          unshieldTransactions as TransactionStructV2[],
          crossContractCalls,
          relayShieldRequests,
          random31Bytes,
          isGasEstimate,
          isRelayerTransaction,
          minGasLimit,
        );
      }
    }
    throw new Error('Unsupported txidVersion');
  }

  static getRelayAdaptParamsUnshieldBaseToken(
    txidVersion: TXIDVersion,
    chain: Chain,
    dummyUnshieldTransactions: (TransactionStructV2 | TransactionStructV3)[],
    unshieldAddress: string,
    random31Bytes: string,
  ): Promise<string> {
    switch (txidVersion) {
      case TXIDVersion.V2_PoseidonMerkle: {
        const contractV2 = ContractStore.getRelayAdaptV2Contract(chain);
        return contractV2.getRelayAdaptParamsUnshieldBaseToken(
          dummyUnshieldTransactions as TransactionStructV2[],
          unshieldAddress,
          random31Bytes,
        );
      }
      case TXIDVersion.V3_PoseidonMerkle: {
        const contractV3 = ContractStore.getRelayAdaptV3Contract(chain);
        return contractV3.getRelayAdaptParamsUnshieldBaseToken(
          dummyUnshieldTransactions as TransactionStructV2[],
          unshieldAddress,
          random31Bytes,
        );
      }
    }
    throw new Error('Unsupported txidVersion');
  }

  static getRelayAdaptParamsCrossContractCalls(
    txidVersion: TXIDVersion,
    chain: Chain,
    dummyUnshieldTransactions: (TransactionStructV2 | TransactionStructV3)[],
    crossContractCalls: ContractTransaction[],
    relayShieldRequests: ShieldRequestStruct[],
    random: string,
    isRelayerTransaction: boolean,
    minGasLimit?: bigint,
  ): Promise<string> {
    switch (txidVersion) {
      case TXIDVersion.V2_PoseidonMerkle: {
        const contractV2 = ContractStore.getRelayAdaptV2Contract(chain);
        return contractV2.getRelayAdaptParamsCrossContractCalls(
          dummyUnshieldTransactions as TransactionStructV2[],
          crossContractCalls,
          relayShieldRequests,
          random,
          isRelayerTransaction,
          minGasLimit,
        );
      }
      case TXIDVersion.V3_PoseidonMerkle: {
        const contractV3 = ContractStore.getRelayAdaptV3Contract(chain);
        return contractV3.getRelayAdaptParamsCrossContractCalls(
          dummyUnshieldTransactions as TransactionStructV2[],
          crossContractCalls,
          relayShieldRequests,
          random,
          isRelayerTransaction,
          minGasLimit,
        );
      }
    }
    throw new Error('Unsupported txidVersion');
  }
}