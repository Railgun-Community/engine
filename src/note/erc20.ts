import BN from 'bn.js';
import {
  bytes,
  hash,
  babyjubjub,
  encryption,
} from '../utils';
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
  constructor(
    publicKey: bytes.BytesData,
    random: bytes.BytesData,
    amount: bytes.BytesData,
    token: bytes.BytesData,
  ) {
    this.publicKey = bytes.hexlify(bytes.padToLength(publicKey, 32));
    this.random = bytes.hexlify(bytes.padToLength(random, 32));
    this.amount = bytes.hexlify(bytes.padToLength(amount, 32));
    this.token = bytes.hexlify(bytes.padToLength(token, 32));
  }

  /**
   * Get note hash
   */
  get hash(): string {
    return hash.poseidon([
      ...babyjubjub.unpackPoint(this.publicKey),
      this.random,
      this.amount,
      this.token,
    ]);
  }

  /**
   * AES-256-CTR encrypts note data
   * @param sharedKey - key to encrypt with
   */
  encrypt(sharedKey: bytes.BytesData): Ciphertext {
    // Encrypt in order and return
    return encryption.aes.ctr.encrypt([
      ...babyjubjub.unpackPoint(this.publicKey),
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
  static decrypt(encryptedNote: Ciphertext, sharedKey: bytes.BytesData): ERC20Note {
    // Decrypt values
    const decryptedValues = encryption.aes.ctr.decrypt(encryptedNote, sharedKey);

    // Create new note object and return
    return new ERC20Note(
      babyjubjub.packPoint([
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
      publicKey: bytes.hexlify(this.publicKey, forContract),
      random: bytes.hexlify(this.random, forContract),
      amount: bytes.hexlify(this.amount, forContract),
      token: bytes.hexlify(this.token, forContract),
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
      bytes.hexlify(noteData.publicKey),
      bytes.hexlify(noteData.random),
      bytes.hexlify(noteData.amount),
      bytes.hexlify(noteData.token),
    );
  }

  /**
   * Calculates nullifier for a given note
   * @param privateKey - note private key
   * @param tree - tree number
   * @param position - position in tree
   * @returns nullifier (hex string)
   */
  static getNullifier(privateKey: bytes.BytesData, tree: number, position: number): string {
    return hash.poseidon([
      privateKey,
      new BN(tree),
      new BN(position),
    ]);
  }
}

export { ERC20Note };
