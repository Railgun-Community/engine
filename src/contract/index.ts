import { Contract, PopulatedTransaction, BigNumber } from 'ethers';
import type { Listener, Provider } from '@ethersproject/abstract-provider';
import utils from '../utils';
import abi from './abi';
import { BytesData } from '../utils/bytes';

class RailgunContract {
  contract: Contract;

  // Contract address
  address: string;

  /**
   * Connect to Railgun instance on network
   * @param address - address of Railgun instance (Proxy contract)
   * @param provider - Network provider
   */
  constructor(address: string, provider: Provider) {
    this.address = address;
    this.contract = new Contract(address, abi, provider);
  }

  /**
   * Get current merkle root
   * @returns merkle root
   */
  async merkleRoot() {
    return utils.bytes.hexlify((await this.contract.functions.merkleRoot())[0].toHexString());
  }

  /**
   * Listens for tree update events
   * @param listener - listener callback
   */
  treeUpdates(listener: Listener) {
    this.contract.on('NewGeneratedCommitment', (
      treeNumber: BigNumber,
      nextLeafIndex: BigNumber,
      hash: BigNumber,
      pubkey: Array<BigNumber>,
      random: BigNumber,
      amount: BigNumber,
      tokenField: string,
    ) => {
      listener({
        tree: treeNumber.toNumber(),
        startingIndex: nextLeafIndex.toNumber(),
        commitments: [{
          hash: utils.bytes.hexlify(hash.toHexString()),
          pubkey: utils.babyjubjub.packPoint(pubkey.map((el) => el.toHexString())),
          random: utils.bytes.hexlify(random.toHexString()),
          amount: utils.bytes.hexlify(amount.toHexString()),
          tokenField: utils.bytes.hexlify(tokenField, true),
        }],
      });
    });
  }

  /**
   * Get generateDeposit populated transaction
   * @param publicKey - public key of node
   * @param random - randomness value of note
   * @param amount - amount of note
   * @param token - token of node
   * @returns Populated transaction
   */
  generateDeposit(
    publicKey: BytesData,
    random: BytesData,
    amount: BytesData,
    token: BytesData,
  ): Promise<PopulatedTransaction> {
    const publicKeyFormatted = utils.babyjubjub.unpackPoint(publicKey).map((el) => `0x${el}`);
    const randomFormatted = utils.bytes.hexlify(random, true);
    const amountFormatted = utils.bytes.hexlify(amount, true);
    const tokenFormatted = utils.bytes.hexlify(token, true);

    return this.contract.populateTransaction.generateDeposit(
      publicKeyFormatted,
      randomFormatted,
      amountFormatted,
      tokenFormatted,
    );
  }
}

export default RailgunContract;
