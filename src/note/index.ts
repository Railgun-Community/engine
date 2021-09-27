import utils from '../utils';
import { BytesData } from '../utils/bytes';
import { Ciphertext } from '../utils/encryption';

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
  get hash(): string {
    return utils.hash.poseidon([
      ...utils.babyjubjub.unpackPoint(this.publicKey),
      this.random,
      this.amount,
      this.token,
    ]);
  }

  /**
   * AES-256-CTR encrypts note data
   * @param sharedKey - key to encrypt with
   */
  encrypt(sharedKey: BytesData): Ciphertext {
    // Encrypt in order and return
    return utils.encryption.aes.ctr.encrypt([
      ...utils.babyjubjub.unpackPoint(this.publicKey),
      this.random,
      this.amount,
      this.token,
    ], sharedKey);
  }

  /**
   * AES-256-CTR decrypts note data
   * @param encryptedNote - encrypted note data
   * @param sharedKey - key to decrypt with
   */
  static decrypt(encryptedNote: Ciphertext, sharedKey: BytesData): Note {
    // Decrypt values
    const decryptedValues = utils.encryption.aes.ctr.decrypt(encryptedNote, sharedKey);

    // Create new note object and return
    return new Note(
      utils.babyjubjub.packPoint([
        decryptedValues[0],
        decryptedValues[1],
      ]),
      decryptedValues[2],
      decryptedValues[3],
      decryptedValues[4],
    );
  }
}

export default Note;
