import utils from '../utils';
import { BytesData } from '../utils/globaltypes';

class Note {
  publicKey: string;

  random: string;

  amount: string;

  token: string;

  /**
   * Create Note object from values
   * @param publicKey - spending public key
   * @param random - note randomness
   * @param amount - note amount
   * @param token - note token ID
   */
  constructor(publicKey: BytesData, random: BytesData, amount: BytesData, token: BytesData) {
    this.publicKey = utils.bytes.hexlify(publicKey);
    this.random = utils.bytes.hexlify(random);
    this.amount = utils.bytes.hexlify(amount);
    this.token = utils.bytes.hexlify(token);
  }

  /**
   * Get note hash
   */
  // get hash(): string {
  //   return utils.hash.poseidon([
  //     ...utils.unpackPoint(this.publicKey),
  //     this.random,
  //     this.amount,
  //     this.token,
  //   ]);
  // }
}

export default Note;
