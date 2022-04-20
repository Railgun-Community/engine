import BN from 'bn.js';
// @ts-ignore
import { eddsa, poseidon as nPoseidon } from 'circomlibjs';
import { NoteSerialized } from '../transaction/types';
import { encryption } from '../utils';
import {
  arrayify,
  BigIntish,
  formatToByteLength,
  hexlify,
  hexToBigInt,
  nToHex,
} from '../utils/bytes';
import { poseidon } from '../utils/hash';
import { Ciphertext } from '../utils/encryption';
import { AddressData } from '../keyderivation/bech32-encode';

export class Note {
  // viewing public key (VPK) of recipient - ed25519 curve
  viewingPublicKey: string;

  // master public key (VPK) of recipient - babyjubjub curve
  masterPublicKey: string;

  // token address
  token: string;

  // 16 byte random
  random: string;

  // value to transfer as bigint
  value: bigint;

  /**
   * Create Note object from values
   * @param {BigIntish} masterPublicKey - spending public key
   * @param {BigIntish} random - note randomness
   * @param {string} token - note token ID
   * @param {BigIntish} value - note value
   */
  constructor(
    address: AddressData,
    random: string,
    value: BigIntish | BN, // @todo fix tests and remove BN
    token: string,
  ) {
    this.masterPublicKey = formatToByteLength(address.masterPublicKey, 32, false);
    this.viewingPublicKey = formatToByteLength(address.viewingPublicKey, 32, false);
    this.token = formatToByteLength(token, 32, false);
    this.random = formatToByteLength(random, 16, false);
    // @todo remove BN shim
    this.value = value instanceof BN ? hexToBigInt(value.toString('hex')) : BigInt(value);
  }

  get valueHex(): string {
    return formatToByteLength(nToHex(this.value), 16, false);
  }

  get notePublicKey(): string {
    return poseidon([this.masterPublicKey, this.random]);
  }

  /**
   * Get note hash
   * @returns {string} hash as unprefixed hex string
   */
  get hash(): string {
    return poseidon([this.notePublicKey, this.token, this.valueHex]);
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
  static sign(
    merkleRoot: bigint,
    boundParamsHash: bigint,
    nullifiers: bigint[],
    commitmentsOut: bigint[],
    spendingKeyPrivate: string,
  ): [bigint, bigint, bigint] {
    const msg = nPoseidon([merkleRoot, boundParamsHash, ...nullifiers, ...commitmentsOut]);
    const prv = Buffer.from(arrayify(spendingKeyPrivate));

    const { R8, S } = eddsa.signPoseidon(prv, msg);
    return [R8[0] as bigint, R8[1] as bigint, S as bigint];
  }

  /**
   * AES-256-GCM encrypts note data
   * @param sharedKey - key to encrypt with
   */
  encrypt(sharedKey: string): Ciphertext {
    // Encrypt in order and return
    return encryption.aes.gcm.encrypt(
      [this.masterPublicKey, this.token, `${this.random}${this.valueHex}`],
      sharedKey,
    );
  }

  /**
   * AES-256-GCM decrypts note data
   * @param encryptedNote - encrypted note data
   * @param sharedKey - key to decrypt with
   */
  static decrypt(encryptedNote: Ciphertext, sharedKey: string): Note {
    // Decrypt values
    const decryptedValues = encryption.aes.gcm
      .decrypt(encryptedNote, sharedKey)
      .map((value) => hexlify(value));

    const address = {
      masterPublicKey: decryptedValues[0],
      viewingPublicKey: sharedKey, // @todo placeholder
    };
    // Create new note object and return
    return new Note(
      address,
      decryptedValues[2].substring(0, 32),
      hexToBigInt(decryptedValues[2].substring(32, 96)),
      decryptedValues[1],
    );
  }

  /**
   * Gets JSON serialized version of note
   * @param viewingPrivateKey - viewing private key for decryption
   * @param forContract - if we should 0x prefix the hex strings to make them ethers compatible
   * @returns serialized note
   */
  serialize(viewingPrivateKey: string, prefix?: boolean): NoteSerialized {
    const encryptedRandom = encryption.aes.gcm.encrypt([this.random], viewingPrivateKey);
    const ivTag = `${hexlify(encryptedRandom.iv, true)}${hexlify(encryptedRandom.tag, false)}`;
    const data = hexlify(encryptedRandom.data[0], true);

    return {
      npk: hexlify(this.notePublicKey, prefix),
      token: hexlify(this.token, prefix),
      value: hexlify(this.valueHex, prefix),
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
    viewingPrivateKey: string,
    recipient: AddressData,
  ): Note {
    const encryptedRandom = noteData.encryptedRandom.map((r) => hexlify(r));
    const ciphertext = {
      iv: encryptedRandom[0].substring(0, 32),
      tag: encryptedRandom[0].substring(32),
      data: [encryptedRandom[1]],
    };
    const decryptedRandom = encryption.aes.gcm.decrypt(ciphertext, viewingPrivateKey);
    // Call hexlify to ensure all note data isn't 0x prefixed
    return new Note(
      recipient,
      hexlify(decryptedRandom[0]),
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
  static getNullifier(nullifyingKey: string, leafIndex: number): string {
    return poseidon([nullifyingKey, hexlify(leafIndex.toString(16))]);
  }
}
