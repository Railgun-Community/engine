import BN from 'bn.js';
import { AbiCoder, solidityPack } from 'ethers/lib/utils';
import {
  bytes,
  hash,
  babyjubjub,
  encryption,
} from '../utils';
import { ByteLength } from '../utils/bytes';
import { Ciphertext } from '../utils/encryption';

export type ERC20NoteSerialized = {
  ypubkey: string,
  sign: boolean;
  random: string,
  value: string,
  token: string,
};

class ERC20Note {
  ypubkey: string;

  sign: boolean;

  random: string;

  value: string;

  token: string;

  /**
   * Create Note object from values
   * @param ypubkey - spending public key
   * @param random - note randomness
   * @param amount - note amount
   * @param token - note token ID
   */
  constructor(
    ypubkey: bytes.BytesData,
    sign: boolean,
    random: bytes.BytesData,
    value: bytes.BytesData,
    token: bytes.BytesData,
  ) {
    this.ypubkey = bytes.hexlify(bytes.padToLength(ypubkey, ByteLength.UINT_256));
    this.sign = sign;
    this.random = bytes.hexlify(bytes.padToLength(random, ByteLength.UINT_128));
    this.value = bytes.hexlify(bytes.padToLength(value, ByteLength.UINT_120));
    this.token = bytes.hexlify(bytes.padToLength(token, ByteLength.Address));
  }

  /**
   * Get note hash
   */
  get hash(): string {
    const abiCoder = new AbiCoder();
    return hash.poseidon([
      this.ypubkey,
      abiCoder.encode(['bool', 'uint120', 'uint128',], [this.sign, this.value, this.random,]),
      '01',// getTokenField(this.token)
    ]);
  }

  /**
   * AES-256-CTR encrypts note data
   * @param sharedKey - key to encrypt with
   */
  encrypt(sharedKey: bytes.BytesData): Ciphertext {
    // Encrypt in order and return
    return encryption.aes.ctr.encrypt([
      ...babyjubjub.unpackPoint(this.pubkey),
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
      pubkey: bytes.hexlify(this.pubkey, forContract),
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
      bytes.hexlify(noteData.pubkey),
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
