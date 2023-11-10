import { AbiCoder, Contract, ContractTransaction, Provider } from 'ethers';
import { ABIPoseidonMerkleAdapt } from '../../../abi/abi';
import { RelayAdaptHelper } from '../relay-adapt-helper';
import { ShieldRequestStruct } from '../../../abi/typechain/RailgunSmartWallet';
import { PayableOverrides } from '../../../abi/typechain/common';
import { PoseidonMerkleAdapt } from '../../../abi/typechain';

export class PoseidonMerkleAdaptV3Contract {
  private readonly contract: PoseidonMerkleAdapt;

  readonly address: string;

  /**
   * Connect to Railgun instance on network
   * @param relayAdaptV3ContractAddress - address of Railgun relay adapt contract
   * @param provider - Network provider
   */
  constructor(relayAdaptV3ContractAddress: string, provider: Provider) {
    this.address = relayAdaptV3ContractAddress;
    this.contract = new Contract(
      relayAdaptV3ContractAddress,
      ABIPoseidonMerkleAdapt,
      provider,
    ) as unknown as PoseidonMerkleAdapt;
  }

  async populateMulticall(
    calls: ContractTransaction[],
    shieldRequests: ShieldRequestStruct[],
  ): Promise<ContractTransaction> {
    const orderedCalls = await this.getOrderedCallsForCrossContractCalls(calls, shieldRequests);
    return this.populateRelayMulticall(orderedCalls, {});
  }

  private populateRelayTransfers(
    transfersData: PoseidonMerkleAdapt.TokenTransferStruct[],
  ): Promise<ContractTransaction> {
    return this.contract.transfer.populateTransaction(transfersData);
  }

  // eslint-disable-next-line class-methods-use-this
  private async getOrderedCallsForCrossContractCalls(
    crossContractCalls: ContractTransaction[],
    relayShieldRequests: ShieldRequestStruct[],
  ): Promise<ContractTransaction[]> {
    throw new Error('Not implemented.');
    const orderedCallPromises: ContractTransaction[] = [...crossContractCalls];
    if (relayShieldRequests.length) {
      // TODO-V3: Do we need these shield requests?
      // orderedCallPromises.push(await this.populateRelayShields(relayShieldRequests));
    }
    return orderedCallPromises;
  }

  static getRelayAdaptV3Calldata(calls: ContractTransaction[]): string {
    return AbiCoder.defaultAbiCoder().encode(
      ['tuple(address to, bytes data, uint256 value)[] calls'],
      [RelayAdaptHelper.formatCalls(calls)],
    );
  }

  /**
   * Generates Relay multicall given a list of ordered calls.
   * @returns populated transaction
   */
  private async populateRelayMulticall(
    calls: ContractTransaction[],
    overrides: PayableOverrides,
  ): Promise<ContractTransaction> {
    const populatedTransaction = await this.contract.multicall.populateTransaction(
      RelayAdaptHelper.formatCalls(calls),
      overrides,
    );
    return populatedTransaction;
  }
}
