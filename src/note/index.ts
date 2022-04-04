import BN from "bn.js";
import { bytes, encryption, hash } from "../utils";
import { Ciphertext } from "../utils/encryption";

export type NoteSerialized = {
  npk: string;
  value: string;
  token: string;
  encryptedRandom: string[];
};

class Note {
  masterPublicKey: string;

  random: string;

  value: string;

  token: string;

  /**
   * Create Note object from values
   * @param masterPublicKey - spending public key
   * @param token - note token ID
   * @param random - note randomness
   * @param value - note value
   */
  constructor(
    masterPublicKey: bytes.BytesData,
    token: bytes.BytesData,
    random: bytes.BytesData,
    value: bytes.BytesData
  ) {
    this.masterPublicKey = bytes.hexlify(
      bytes.padToLength(masterPublicKey, 32)
    );
    this.token = bytes.hexlify(bytes.padToLength(token, 32));
    this.random = bytes.hexlify(bytes.padToLength(random, 16));
    this.value = bytes.hexlify(bytes.padToLength(value, 16));
  }

  /**
   * Get note hash
   */
  get hash(): string {
    return hash.poseidon([
      hash.poseidon([this.masterPublicKey, this.random]), // NPK
      this.token,
      this.value
    ]);
  }

  /**
   * AES-256-GCM encrypts note data
   * @param sharedKey - key to encrypt with
   */
  encrypt(sharedKey: bytes.BytesData): Ciphertext {
    // Encrypt in order and return
    return encryption.aes.gcm.encrypt(
      [this.masterPublicKey, this.token, this.random.concat(this.value)],
      sharedKey
    );
  }

  /**
   * AES-256-GCM decrypts note data
   * @param encryptedNote - encrypted note data
   * @param sharedKey - key to decrypt with
   */
  static decrypt(encryptedNote: Ciphertext, sharedKey: bytes.BytesData): Note {
    // Decrypt values
    const decryptedValues = encryption.aes.gcm.decrypt(
      encryptedNote,
      sharedKey
    );

    // Create new note object and return
    return new Note(
      decryptedValues[0],
      decryptedValues[1],
      (decryptedValues[2] as string).substring(0, 16),
      (decryptedValues[2] as string).substring(16, 32)
    );
  }

  /**
   * Gets JSON serialized version of note
   * @param viewingPrivateKey - viewing private key for decryption
   * @param forContract - if we should 0x prefix the hex strings to make them ethers compatible
   * @returns serialized note
   */
  serialize(
    viewingPrivateKey: bytes.BytesData,
    forContract: boolean = false
  ): NoteSerialized {
    const encryptedRandom = encryption.aes.gcm.encrypt(
      [this.random],
      viewingPrivateKey
    );
    const ivTag =
      bytes.hexlify(encryptedRandom.iv, forContract) +
      bytes.hexlify(encryptedRandom.tag);
    const data = bytes.hexlify(encryptedRandom.data[0], forContract);
    return {
      npk: hash.poseidon([this.masterPublicKey, this.random]),
      token: bytes.hexlify(this.token, forContract),
      value: bytes.hexlify(this.value, forContract),
      encryptedRandom: [ivTag, data]
    };
  }

  /**
   * Creates note from serialized note JSON
   * @param noteData - serialized note data
   * @param viewingPrivateKey - viewing private key for decryption
   * @param masterPublicKey - master public key of the user
   * @returns Note
   */
  static deserialize(
    noteData: NoteSerialized,
    viewingPrivateKey: bytes.BytesData,
    masterPublicKey: bytes.BytesData
  ): Note {
    const ciphertext = {
      iv: bytes.hexlify(noteData.encryptedRandom[0]).substring(0, 16),
      tag: bytes.hexlify(noteData.encryptedRandom[0]).substring(16),
      data: [bytes.hexlify(noteData.encryptedRandom[1])]
    };
    const decryptedRandom = encryption.aes.gcm.decrypt(
      ciphertext,
      viewingPrivateKey
    );
    // Call hexlify to ensure all note data isn't 0x prefixed
    return new Note(
      bytes.hexlify(masterPublicKey),
      bytes.hexlify(noteData.token),
      bytes.hexlify(decryptedRandom[0]),
      bytes.hexlify(noteData.value)
    );
  }

  /**
   * Calculates nullifier for a given note
   * @param nullifyingKey - nullifying key
   * @param leafIndex - Index of note's commitment in the Merkle tree
   * @returns nullifier (hex string)
   */
  static getNullifier(
    nullifyingKey: bytes.BytesData,
    leafIndex: number
  ): string {
    return hash.poseidon([nullifyingKey, new BN(leafIndex)]);
  }
}

export { Note };
