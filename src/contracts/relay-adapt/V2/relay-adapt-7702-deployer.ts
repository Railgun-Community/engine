import { Contract, Provider } from 'ethers';
import { ABIRelayAdapt7702Deployer } from '../../../abi/abi';
import { RelayAdapt7702Deployer } from '../../../abi/typechain/RelayAdapt7702Deployer';

export class RelayAdapt7702DeployerContract {
  private readonly contract: RelayAdapt7702Deployer;

  readonly address: string;

  /**
   * Connect to RelayAdapt7702Deployer
   * @param deployerAddress - address of RelayAdapt7702Deployer
   * @param provider - Network provider
   */
  constructor(deployerAddress: string, provider: Provider) {
    this.address = deployerAddress;
    this.contract = new Contract(
      deployerAddress,
      ABIRelayAdapt7702Deployer,
      provider,
    ) as unknown as RelayAdapt7702Deployer;
  }

  async isDeployed(deploymentAddress: string): Promise<boolean> {
    return this.contract.isDeployed(deploymentAddress);
  }
}
