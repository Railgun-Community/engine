import BN from 'bn.js';
import { ERC20Note } from '../note';
import { hash, bytes } from '../utils';

export type AdaptID = {
  contract: bytes.BytesData,
  parameters: bytes.BytesData,
}

class ERC20Transaction {
  adaptID: AdaptID = {
    contract: '00',
    parameters: '00',
  };

  token: string;

  outputs: ERC20Note[] = [];

  deposit: BN = new BN(0);

  withdraw: BN = new BN(0);

  /**
   * Create ERC20Transaction Object
   * @param token - token of transaction
   */
  constructor(token: string) {
    this.token = token;
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
}

export { ERC20Transaction };
