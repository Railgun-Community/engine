import { Signature } from 'circomlib';
import { BigIntish, Ciphertext, NoteSerialized } from '../models/transaction-types';
import { encryption, keysUtils } from '../utils';
import {
  ByteLength,
  formatEncryptedRandom,
  formatToByteLength,
  hexlify,
  hexToBigInt,
  nToHex,
} from '../utils/bytes';
import { AddressData } from '../keyderivation/bech32-encode';
import { PublicInputs } from '../prover';

const { poseidon } = keysUtils;

export class Note {
  // viewing public key (VPK) of recipient - ed25519 curve
  viewingPublicKey: Uint8Array;

  // master public key (VPK) of recipient
  masterPublicKey: bigint;

  // token address
  token: string;

  // 16 byte random
  random: string;

  // value to transfer as bigint
  value: bigint;

  /**
   * Create Note object from values
   * @param {BigInt} masterPublicKey - spending public key
   * @param {BigInt} random - note randomness
   * @param {string} token - note token ID
   * @param {BigInt} value - note value
   */
  constructor(address: AddressData, random: string, value: BigIntish, token: string) {
    this.masterPublicKey = address.masterPublicKey;
    this.viewingPublicKey = address.viewingPublicKey;
    this.token = formatToByteLength(token, 20, false);
    this.random = formatToByteLength(random, 16, false);
    this.value = BigInt(value);
  }

  get valueHex(): string {
    return nToHex(this.value, ByteLength.UINT_128);
  }

  get notePublicKey(): bigint {
    return poseidon([this.masterPublicKey, hexToBigInt(this.random)]);
  }

  /**
   * Get note hash
   * @returns {bigint} hash
   */
  get hash(): bigint {
    return poseidon([this.notePublicKey, hexToBigInt(this.token), this.value]);
  }

  /**
   * Sign a transaction
   *
   * @param {bigint} merkleRoot - transaction merkle root
   * @param {bigint} boundParamsHash - transaction bound parameters hash
   * @param {Array<bigint>} nullifiers - transaction nullifiers
   * @param {Array<bigint>} commitmentsOut - transaction commitments
   * @returns {object} signature
   */
  static sign(publicInputs: PublicInputs, spendingKeyPrivate: Uint8Array): Signature {
    const entries = Object.values(publicInputs).flatMap((x) => x);
    const msg = poseidon(entries);
    return keysUtils.signEDDSA(spendingKeyPrivate, msg);
  }

  /**
   * AES-256-GCM encrypts note data
   * @param sharedKey - key to encrypt with
   */
  encrypt(sharedKey: Uint8Array): Ciphertext {
    const { masterPublicKey, token, random, value } = this.format(false);
    // Encrypt in order and return
    return encryption.aes.gcm.encrypt([masterPublicKey, token, `${random}${value}`], sharedKey);
  }

  /**
   * AES-256-GCM decrypts note data
   * @param encryptedNote - encrypted note data
   * @param sharedKey - key to decrypt with
   */
  static decrypt(encryptedNote: Ciphertext, sharedKey: Uint8Array): Note {
    // Decrypt values
    const decryptedValues = encryption.aes.gcm
      .decrypt(encryptedNote, sharedKey)
      .map((value) => hexlify(value));

    const address = {
      masterPublicKey: hexToBigInt(decryptedValues[0]),
      viewingPublicKey: new Uint8Array([]), // dummy
    };
    // Create new note object and return
    return new Note(
      address,
      decryptedValues[2].substring(0, 32),
      hexToBigInt(decryptedValues[2].substring(32, 96)),
      decryptedValues[1],
    );
  }

  format(prefix: boolean = false) {
    return {
      masterPublicKey: nToHex(this.masterPublicKey, ByteLength.UINT_256, prefix),
      npk: nToHex(this.notePublicKey, ByteLength.UINT_256, prefix),
      token: formatToByteLength(this.token, ByteLength.Address, prefix),
      value: formatToByteLength(this.valueHex, ByteLength.UINT_128, prefix),
      random: formatToByteLength(this.random, ByteLength.UINT_128, prefix),
    };
  }

  /**
   * Gets JSON serialized version of note
   * @param viewingPrivateKey - viewing private key for decryption
   * @param forContract - if we should 0x prefix the hex strings to make them ethers compatible
   * @returns serialized note
   */
  serialize(viewingPrivateKey: Uint8Array, prefix?: boolean): NoteSerialized {
    const { npk, token, value, random } = this.format(prefix);
    const ciphertext = encryption.aes.gcm.encrypt([random], viewingPrivateKey);
    const [ivTag, data] = formatEncryptedRandom(ciphertext);

    return {
      npk,
      token,
      value,
      encryptedRandom: [ivTag, data].map((v) => hexlify(v, prefix)),
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
    viewingPrivateKey: Uint8Array,
    recipient: AddressData,
  ): Note {
    const encryptedRandom = noteData.encryptedRandom.map((r) => hexlify(r));
    const ciphertext = {
      iv: encryptedRandom[0].substring(0, 32),
      tag: encryptedRandom[0].substring(32),
      data: [encryptedRandom[1]],
    };
    const decryptedRandom = encryption.aes.gcm.decrypt(ciphertext, viewingPrivateKey);
    const ivTag = decryptedRandom[0];
    // Call hexlify to ensure all note data isn't 0x prefixed
    return new Note(
      recipient,
      hexlify(ivTag),
      hexToBigInt(noteData.value),
      hexlify(noteData.token),
    );
  }

  /**
   * Calculates nullifier for a given note
   * @param nullifyingKey - nullifying key
   * @param leafIndex - Index of note's commitment in the Merkle tree
   * @returns nullifier (hex string)
   */
  static getNullifier(nullifyingKey: bigint, leafIndex: number): bigint {
    return poseidon([nullifyingKey, BigInt(leafIndex)]);
  }
}
