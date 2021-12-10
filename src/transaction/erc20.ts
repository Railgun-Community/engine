import BN from 'bn.js';
import { ERC20Note } from '../note';
import { hash, bytes } from '../utils';
import { Wallet } from '../wallet';
// import type { ERC20Inputs } from '../prover';

export type AdaptID = {
  contract: bytes.BytesData,
  parameters: bytes.BytesData,
}

class ERC20Transaction {
  adaptID: AdaptID = {
    contract: '00',
    parameters: '00',
  };

  chainID: number;

  token: string;

  outputs: ERC20Note[] = [];

  deposit: BN = new BN(0);

  withdraw: BN = new BN(0);

  /**
   * Create ERC20Transaction Object
   * @param token - token of transaction
   */
  constructor(token: string, chainID: number) {
    this.token = token;
    this.chainID = chainID;
  }

  /**
   * Gets adaptID hash
   */
  get adaptIDhash() {
    return hash.sha256(bytes.combine([
      bytes.padToLength(this.adaptID.contract, 32),
      bytes.padToLength(this.adaptID.parameters, 32),
    ]));
  }

  /**
   * Generates inputs for prover
   * @param wallet - wallet to spend from
   * @param encryptionKey - encryption key of wallet
   */
  generateInputs(wallet: Wallet, encryptionKey: bytes.BytesData) {
    const UTXOs = wallet.TXOs(this.chainID);
    console.log(encryptionKey);
    console.log(UTXOs);
  }
}

export { ERC20Transaction };
