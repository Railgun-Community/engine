import { poseidon } from 'circomlibjs';
import { bytesToHex } from 'ethereum-cryptography/utils';
import { ShieldCiphertext, TokenData } from '../models/formatted-types';
import { AES, getPublicViewingKey, getSharedSymmetricKey } from '../utils';
import { ByteLength, combine, hexlify, hexToBigInt, nToHex } from '../utils/bytes';
import { assertValidNoteRandom, assertValidNoteToken, getTokenDataHash } from './note-util';
import { ShieldRequestStruct } from '../abi/typechain/RailgunSmartWallet';

export abstract class ShieldNote {
  readonly masterPublicKey: bigint;

  readonly random: string;

  readonly value: bigint;

  readonly tokenData: TokenData;

  readonly tokenHash: string;

  readonly notePublicKey: bigint;

  constructor(masterPublicKey: bigint, random: string, value: bigint, tokenData: TokenData) {
    assertValidNoteRandom(random);
    assertValidNoteToken(tokenData, value);

    this.masterPublicKey = masterPublicKey;
    this.random = random;
    this.tokenData = tokenData;
    this.tokenHash = getTokenDataHash(tokenData);
    this.value = value;
    this.notePublicKey = ShieldNote.getNotePublicKey(masterPublicKey, random);
  }

  /**
   * Used to generate a shieldPrivateKey by signing this message with public wallet.
   * After shielding, the shieldPrivateKey can then be used to get the 0zk address of the receiver.
   */
  static getShieldPrivateKeySignatureMessage() {
    // DO NOT MODIFY THIS CONSTANT.
    return 'RAILGUN_SHIELD';
  }

  static getNotePublicKey(masterPublicKey: bigint, random: string): bigint {
    return poseidon([masterPublicKey, hexToBigInt(random)]);
  }

  static getShieldNoteHash(
    notePublicKey: bigint,
    tokenHash: string,
    valueAfterFee: bigint,
  ): bigint {
    return poseidon([notePublicKey, hexToBigInt(tokenHash), valueAfterFee]);
  }

  static decryptRandom(encryptedBundle: [string, string, string], sharedKey: Uint8Array): string {
    const hexlified0 = hexlify(encryptedBundle[0]);
    const hexlified1 = hexlify(encryptedBundle[1]);
    const decrypted = AES.decryptGCM(
      {
        iv: hexlified0.slice(0, 32),
        tag: hexlified0.slice(16, 64),
        data: [hexlified1.slice(0, 32)],
      },
      sharedKey,
    )[0];
    return hexlify(decrypted);
  }

  /**
   * Gets JSON serialized version of note
   * @param viewingPrivateKey - viewing private key for decryption
   * @param forContract - if we should 0x prefix the hex strings to make them ethers compatible
   * @returns serialized note
   */
  async serialize(
    shieldPrivateKey: Uint8Array,
    receiverViewingPublicKey: Uint8Array,
  ): Promise<ShieldRequestStruct> {
    // Get shared key
    const sharedKey = await getSharedSymmetricKey(shieldPrivateKey, receiverViewingPublicKey);
    if (!sharedKey) {
      throw new Error('Could not generated shared symmetric key for shielding.');
    }

    // Encrypt random
    const encryptedRandom = AES.encryptGCM([this.random], sharedKey);

    // Encrypt receiver public key
    const encryptedReceiver = AES.encryptCTR(
      [bytesToHex(receiverViewingPublicKey)],
      shieldPrivateKey,
    );

    const shieldKey = bytesToHex(await getPublicViewingKey(shieldPrivateKey));

    // Construct ciphertext
    const ciphertext: ShieldCiphertext = {
      encryptedBundle: [
        hexlify(`${encryptedRandom.iv}${encryptedRandom.tag}`, true),
        hexlify(combine([...encryptedRandom.data, encryptedReceiver.iv]), true),
        hexlify(combine(encryptedReceiver.data), true),
      ],
      shieldKey: hexlify(shieldKey, true),
    };

    return {
      preimage: {
        npk: nToHex(this.notePublicKey, ByteLength.UINT_256, true),
        token: this.tokenData,
        value: this.value,
      },
      ciphertext,
    };
  }
}
