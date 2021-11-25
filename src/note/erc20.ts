import utils from '../utils';
import { BytesData } from '../utils/bytes';
import { Ciphertext } from '../utils/encryption';

export type ERC20NoteSerialized = {
  publicKey: string,
  random: string,
  amount: string,
  token: string,
};

class ERC20Note {
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
  static decrypt(encryptedNote: Ciphertext, sharedKey: BytesData): ERC20Note {
    // Decrypt values
    const decryptedValues = utils.encryption.aes.ctr.decrypt(encryptedNote, sharedKey);

    // Create new note object and return
    return new ERC20Note(
      utils.babyjubjub.packPoint([
        decryptedValues[0],
        decryptedValues[1],
      ]),
      decryptedValues[2],
      decryptedValues[3],
      decryptedValues[4],
    );
  }

  /**
   * Gets JSON serialized version of note
   * @param forContract - if we should 0x prefix the hex strings to make them ethers compatible
   * @returns serialized note
   */
  serialize(forContract: boolean = false): ERC20NoteSerialized {
    return {
      publicKey: utils.bytes.hexlify(this.publicKey, forContract),
      random: utils.bytes.hexlify(this.random, forContract),
      amount: utils.bytes.hexlify(this.amount, forContract),
      token: utils.bytes.hexlify(this.token, forContract),
    };
  }

  /**
   * Creates note from serialized note JSON
   * @param noteData - serialized note data
   * @returns Note
   */
  static deserialize(noteData: ERC20NoteSerialized): ERC20Note {
    // Call hexlify to ensure all note data isn't 0x prefixed
    return new ERC20Note(
      utils.bytes.hexlify(noteData.publicKey),
      utils.bytes.hexlify(noteData.random),
      utils.bytes.hexlify(noteData.amount),
      utils.bytes.hexlify(noteData.token),
    );
  }
}

export default ERC20Note;
