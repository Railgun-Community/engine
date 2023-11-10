import { ContractTransaction, Log, Provider, TransactionRequest } from 'ethers';
import { PoseidonMerkleVerifier } from '../../abi/typechain';
import {
  ShieldCiphertextStruct,
  ShieldRequestStruct,
  TokenDataStructOutput,
} from '../../abi/typechain/RailgunSmartWallet';
import {
  EventsCommitmentListener,
  EventsNullifierListener,
  EventsRailgunTransactionListenerV3,
  EventsUnshieldListener,
} from '../../models/event-types';
import { ZERO_32_BYTE_VALUE, ZERO_ADDRESS, isDefined } from '../../utils';
import { ContractStore } from '../contract-store';
import { Chain } from '../../models/engine-types';
import { TXIDVersion } from '../../models/poi-types';
import { TransactionStructV2, TransactionStructV3 } from '../../models/transaction-types';
import { RelayAdaptV2Contract } from '../relay-adapt/V2/relay-adapt-v2';
import { PoseidonMerkleAdaptV3Contract } from '../relay-adapt/V3/poseidon-merkle-adapt-v3';
import { TransactionReceiptLog } from '../../models/formatted-types';
import { PoseidonMerkleVerifierContract } from './V3/poseidon-merkle-verifier';

export class RailgunVersionedSmartContracts {
  private static zeroUnshieldChangeCiphertext: ShieldCiphertextStruct = {
    encryptedBundle: [ZERO_32_BYTE_VALUE, ZERO_32_BYTE_VALUE, ZERO_32_BYTE_VALUE],
    shieldKey: ZERO_32_BYTE_VALUE,
  };

  static getAccumulator(txidVersion: TXIDVersion, chain: Chain) {
    switch (txidVersion) {
      case TXIDVersion.V2_PoseidonMerkle: {
        const contractV2 = ContractStore.getRailgunSmartWalletContract(chain);
        return contractV2;
      }
      case TXIDVersion.V3_PoseidonMerkle: {
        const contractV3PoseidonMerkleAccumulator =
          ContractStore.getPoseidonMerkleAccumulatorV3Contract(chain);
        return contractV3PoseidonMerkleAccumulator;
      }
    }
    throw new Error('Unsupported txidVersion');
  }

  static getVerifier(txidVersion: TXIDVersion, chain: Chain) {
    switch (txidVersion) {
      case TXIDVersion.V2_PoseidonMerkle: {
        const contractV2 = ContractStore.getRailgunSmartWalletContract(chain);
        return contractV2;
      }
      case TXIDVersion.V3_PoseidonMerkle: {
        const contractV3PoseidonMerkleVerifier =
          ContractStore.getPoseidonMerkleVerifierV3Contract(chain);
        return contractV3PoseidonMerkleVerifier;
      }
    }
    throw new Error('Unsupported txidVersion');
  }

  static getShieldApprovalContract(txidVersion: TXIDVersion, chain: Chain) {
    switch (txidVersion) {
      case TXIDVersion.V2_PoseidonMerkle: {
        const contractV2 = ContractStore.getRailgunSmartWalletContract(chain);
        return contractV2;
      }
      case TXIDVersion.V3_PoseidonMerkle: {
        const contractV3TokenVault = ContractStore.getTokenVaultV3Contract(chain);
        return contractV3TokenVault;
      }
    }
    throw new Error('Unsupported txidVersion');
  }

  static getRelayAdaptContract(txidVersion: TXIDVersion, chain: Chain) {
    switch (txidVersion) {
      case TXIDVersion.V2_PoseidonMerkle: {
        const contractV2 = ContractStore.getRelayAdaptV2Contract(chain);
        return contractV2;
      }
      case TXIDVersion.V3_PoseidonMerkle: {
        const contractV3TokenVault = ContractStore.getRelayAdaptV3Contract(chain);
        return contractV3TokenVault;
      }
    }
    throw new Error('Unsupported txidVersion');
  }

  static getHistoricalEvents(
    txidVersion: TXIDVersion,
    chain: Chain,
    initialStartBlock: number,
    latestBlock: number,
    getNextStartBlockFromValidMerkletree: () => Promise<number>,
    eventsCommitmentListener: EventsCommitmentListener,
    eventsNullifierListener: EventsNullifierListener,
    eventsUnshieldListener: EventsUnshieldListener,
    eventsRailgunTransactionsV3Listener: EventsRailgunTransactionListenerV3,
    setLastSyncedBlock: (lastSyncedBlock: number) => Promise<void>,
  ) {
    switch (txidVersion) {
      case TXIDVersion.V2_PoseidonMerkle: {
        const contractV2 = ContractStore.getRailgunSmartWalletContract(chain);
        return contractV2.getHistoricalEvents(
          initialStartBlock,
          latestBlock,
          getNextStartBlockFromValidMerkletree,
          eventsCommitmentListener,
          eventsNullifierListener,
          eventsUnshieldListener,
          setLastSyncedBlock,
        );
      }
      case TXIDVersion.V3_PoseidonMerkle: {
        const contractV3PoseidonMerkleAccumulator =
          ContractStore.getPoseidonMerkleAccumulatorV3Contract(chain);
        return contractV3PoseidonMerkleAccumulator.getHistoricalEvents(
          initialStartBlock,
          latestBlock,
          getNextStartBlockFromValidMerkletree,
          eventsCommitmentListener,
          eventsNullifierListener,
          eventsUnshieldListener,
          eventsRailgunTransactionsV3Listener,
          setLastSyncedBlock,
        );
      }
    }
    throw new Error('Unsupported txidVersion');
  }

  static setTreeUpdateListeners(
    txidVersion: TXIDVersion,
    chain: Chain,
    eventsCommitmentListener: EventsCommitmentListener,
    eventsNullifierListener: EventsNullifierListener,
    eventsUnshieldListener: EventsUnshieldListener,
    eventsRailgunTransactionsV3Listener: EventsRailgunTransactionListenerV3,
    triggerWalletBalanceDecryptions: (txidVersion: TXIDVersion) => Promise<void>,
  ) {
    switch (txidVersion) {
      case TXIDVersion.V2_PoseidonMerkle: {
        const contractV2 = ContractStore.getRailgunSmartWalletContract(chain);
        return contractV2.setTreeUpdateListeners(
          eventsCommitmentListener,
          eventsNullifierListener,
          eventsUnshieldListener,
        );
      }
      case TXIDVersion.V3_PoseidonMerkle: {
        const contractV3PoseidonMerkleAccumulator =
          ContractStore.getPoseidonMerkleAccumulatorV3Contract(chain);
        return contractV3PoseidonMerkleAccumulator.setTreeUpdateListeners(
          eventsCommitmentListener,
          eventsNullifierListener,
          eventsUnshieldListener,
          eventsRailgunTransactionsV3Listener,
          triggerWalletBalanceDecryptions,
        );
      }
    }
    throw new Error('Unsupported txidVersion');
  }

  static fees(
    txidVersion: TXIDVersion,
    chain: Chain,
  ): Promise<{ shield: bigint; unshield: bigint }> {
    switch (txidVersion) {
      case TXIDVersion.V2_PoseidonMerkle: {
        const contractV2 = ContractStore.getRailgunSmartWalletContract(chain);
        return contractV2.fees();
      }
      case TXIDVersion.V3_PoseidonMerkle: {
        const contractTokenVaultV3 = ContractStore.getTokenVaultV3Contract(chain);
        return contractTokenVaultV3.fees();
      }
    }
    throw new Error('Unsupported txidVersion');
  }

  static getNFTTokenData(
    txidVersion: TXIDVersion,
    chain: Chain,
    tokenHash: string,
  ): Promise<TokenDataStructOutput> {
    switch (txidVersion) {
      case TXIDVersion.V2_PoseidonMerkle: {
        const contractV2 = ContractStore.getRailgunSmartWalletContract(chain);
        return contractV2.getNFTTokenData(tokenHash);
      }
      case TXIDVersion.V3_PoseidonMerkle: {
        const contractTokenVaultV3 = ContractStore.getTokenVaultV3Contract(chain);
        return contractTokenVaultV3.getNFTTokenData(tokenHash);
      }
    }
    throw new Error('Unsupported txidVersion');
  }

  static generateShield(
    txidVersion: TXIDVersion,
    chain: Chain,
    shieldRequests: ShieldRequestStruct[],
  ): Promise<ContractTransaction> {
    switch (txidVersion) {
      case TXIDVersion.V2_PoseidonMerkle: {
        const contractV2 = ContractStore.getRailgunSmartWalletContract(chain);
        return contractV2.generateShield(shieldRequests);
      }

      case TXIDVersion.V3_PoseidonMerkle: {
        const contractV3PoseidonMerkleVerifier =
          ContractStore.getPoseidonMerkleVerifierV3Contract(chain);
        const emptyGlobalBoundParams: PoseidonMerkleVerifier.GlobalBoundParamsStruct = {
          minGasPrice: 0n,
          chainID: chain.id,
          senderCiphertext: '0x',
          to: ZERO_ADDRESS,
          data: '0x',
        };
        return contractV3PoseidonMerkleVerifier.generateExecute(
          [],
          shieldRequests,
          emptyGlobalBoundParams,
          this.zeroUnshieldChangeCiphertext,
        );
      }
    }
    throw new Error('Unsupported txidVersion');
  }

  static generateTransact(
    txidVersion: TXIDVersion,
    chain: Chain,
    transactions: (TransactionStructV2 | TransactionStructV3)[],
  ): Promise<ContractTransaction> {
    switch (txidVersion) {
      case TXIDVersion.V2_PoseidonMerkle: {
        const contractV2 = ContractStore.getRailgunSmartWalletContract(chain);
        return contractV2.generateTransact(transactions as TransactionStructV2[]);
      }

      case TXIDVersion.V3_PoseidonMerkle: {
        const transactionsV3: PoseidonMerkleVerifier.TransactionStruct[] =
          RailgunVersionedSmartContracts.convertToV3TransactStructs(
            transactions as TransactionStructV3[],
          );
        if (!transactions.length) {
          throw new Error('No transactions to transact');
        }
        const globalBoundParams = (transactions[0] as TransactionStructV3).boundParams.global;
        const contractV3PoseidonMerkleVerifier =
          ContractStore.getPoseidonMerkleVerifierV3Contract(chain);
        return contractV3PoseidonMerkleVerifier.generateExecute(
          transactionsV3,
          [],
          globalBoundParams,
          this.zeroUnshieldChangeCiphertext,
        );
      }
    }
    throw new Error('Unsupported txidVersion');
  }

  private static convertToV3TransactStructs(
    transactions: TransactionStructV3[],
  ): PoseidonMerkleVerifier.TransactionStruct[] {
    return transactions.map((transaction) => ({
      proof: transaction.proof,
      merkleRoot: transaction.merkleRoot,
      nullifiers: transaction.nullifiers,
      commitments: transaction.commitments,
      unshieldPreimage: transaction.unshieldPreimage,
      boundParams: {
        treeNumber: transaction.boundParams.local.treeNumber,
        commitmentCiphertext: transaction.boundParams.local.commitmentCiphertext,
      },
    }));
  }

  static getRelayAdaptContract(txidVersion: TXIDVersion, chain: Chain) {
    switch (txidVersion) {
      case TXIDVersion.V2_PoseidonMerkle: {
        const contractV2 = ContractStore.getRelayAdaptV2Contract(chain);
        return contractV2;
      }
      case TXIDVersion.V3_PoseidonMerkle: {
        const contractV3PoseidonMerkleAccumulator =
          ContractStore.getPoseidonMerkleAdaptV3Contract(chain);
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
    switch (txidVersion) {
      case TXIDVersion.V2_PoseidonMerkle: {
        const contractV2 = ContractStore.getRelayAdaptV2Contract(chain);
        return contractV2.populateShieldBaseToken(shieldRequest);
      }
      case TXIDVersion.V3_PoseidonMerkle: {
        const contractV3PoseidonMerkleAccumulator =
          ContractStore.getPoseidonMerkleVerifierV3Contract(chain);
        return contractV3PoseidonMerkleAccumulator.populateShieldBaseToken(shieldRequest);
      }
    }
    throw new Error('Unsupported txidVersion');
  }

  static populateUnshieldBaseToken(
    txidVersion: TXIDVersion,
    chain: Chain,
    transactions: (TransactionStructV2 | TransactionStructV3)[],
    unshieldAddress: string,
    random31BytesV2Only: Optional<string>,
  ): Promise<ContractTransaction> {
    switch (txidVersion) {
      case TXIDVersion.V2_PoseidonMerkle: {
        const contractV2 = ContractStore.getRelayAdaptV2Contract(chain);
        if (!isDefined(random31BytesV2Only)) {
          throw new Error('Must have random31Bytes for populateUnshieldBaseToken');
        }
        return contractV2.populateUnshieldBaseToken(
          transactions as TransactionStructV2[],
          unshieldAddress,
          random31BytesV2Only,
        );
      }
      case TXIDVersion.V3_PoseidonMerkle: {
        const contractV3PoseidonMerkleVerifier =
          ContractStore.getPoseidonMerkleVerifierV3Contract(chain);
        return contractV3PoseidonMerkleVerifier.populateUnshieldBaseToken(
          transactions as TransactionStructV3[],
          unshieldAddress,
        );
      }
    }
    throw new Error('Unsupported txidVersion');
  }

  static populateV2CrossContractCalls(
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
        return contractV2.populateV2CrossContractCalls(
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
        throw new Error(
          'Not possible: populateV2CrossContractCalls for V3. Pass cross-contract calls into TransactionBatch:generateTransactions instead.',
        );
      }
    }
    throw new Error('Unsupported txidVersion');
  }

  static getRelayAdaptV2ParamsUnshieldBaseToken(
    txidVersion: TXIDVersion,
    chain: Chain,
    dummyUnshieldTransactions: (TransactionStructV2 | TransactionStructV3)[],
    unshieldAddress: string,
    random31Bytes: string,
  ): Promise<string> {
    switch (txidVersion) {
      case TXIDVersion.V2_PoseidonMerkle: {
        const contractV2 = ContractStore.getRelayAdaptV2Contract(chain);
        return contractV2.getRelayAdaptV2ParamsUnshieldBaseToken(
          dummyUnshieldTransactions as TransactionStructV2[],
          unshieldAddress,
          random31Bytes,
        );
      }
      case TXIDVersion.V3_PoseidonMerkle: {
        throw new Error('Not possible: getRelayAdaptV2ParamsUnshieldBaseToken for V3.');
      }
    }
    throw new Error('Unsupported txidVersion');
  }

  static getRelayAdaptV2ParamsCrossContractCalls(
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
        return contractV2.getRelayAdaptV2ParamsCrossContractCalls(
          dummyUnshieldTransactions as TransactionStructV2[],
          crossContractCalls,
          relayShieldRequests,
          random,
          isRelayerTransaction,
          minGasLimit,
        );
      }
      case TXIDVersion.V3_PoseidonMerkle: {
        throw new Error('Not implemented: getRelayAdaptV2ParamsCrossContractCalls for V3.');
      }
    }
    throw new Error('Unsupported txidVersion');
  }

  static getRelayAdaptV3Calldata(
    txidVersion: TXIDVersion,
    chain: Chain,
    calls: ContractTransaction[],
  ): { to: string; data: string } {
    switch (txidVersion) {
      case TXIDVersion.V2_PoseidonMerkle: {
        return { to: ZERO_ADDRESS, data: '0x' };
      }
      case TXIDVersion.V3_PoseidonMerkle: {
        if (calls.length === 0) {
          return { to: ZERO_ADDRESS, data: '0x' };
        }
        return {
          to: RailgunVersionedSmartContracts.getRelayAdaptContract(txidVersion, chain).address,
          data: PoseidonMerkleAdaptV3Contract.getRelayAdaptV3Calldata(calls),
        };
      }
    }
    throw new Error('Unsupported txidVersion');
  }

  static estimateGasWithErrorHandler(
    txidVersion: TXIDVersion,
    provider: Provider,
    transaction: ContractTransaction | TransactionRequest,
  ) {
    switch (txidVersion) {
      case TXIDVersion.V2_PoseidonMerkle: {
        return RelayAdaptV2Contract.estimateGasWithErrorHandler(provider, transaction);
      }
      case TXIDVersion.V3_PoseidonMerkle: {
        return PoseidonMerkleVerifierContract.estimateGasWithErrorHandler(provider, transaction);
      }
    }
    throw new Error('Unsupported txidVersion');
  }

  static getRelayAdaptCallError(
    txidVersion: TXIDVersion,
    receiptLogs: TransactionReceiptLog[] | readonly Log[],
  ) {
    switch (txidVersion) {
      case TXIDVersion.V2_PoseidonMerkle: {
        return RelayAdaptV2Contract.getRelayAdaptCallError(receiptLogs);
      }
      case TXIDVersion.V3_PoseidonMerkle: {
        return PoseidonMerkleVerifierContract.getRelayAdaptCallError(receiptLogs);
      }
    }
    throw new Error('Unsupported txidVersion');
  }

  static parseRelayAdaptReturnValue(txidVersion: TXIDVersion, data: string) {
    switch (txidVersion) {
      case TXIDVersion.V2_PoseidonMerkle: {
        return RelayAdaptV2Contract.parseRelayAdaptReturnValue(data);
      }
      case TXIDVersion.V3_PoseidonMerkle: {
        return PoseidonMerkleVerifierContract.parseRelayAdaptReturnValue(data);
      }
    }
    throw new Error('Unsupported txidVersion');
  }
}
