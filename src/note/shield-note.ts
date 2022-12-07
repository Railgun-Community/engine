import { poseidon } from 'circomlibjs';
import { bytesToHex } from 'ethereum-cryptography/utils';
import { ShieldCiphertext, TokenType } from '../models/formatted-types';
import { ShieldRequestStruct } from '../typechain-types/contracts/logic/RailgunSmartWallet';
import { getPublicViewingKey, getSharedSymmetricKey } from '../utils';
import { ByteLength, combine, hexlify, hexToBigInt, nToHex } from '../utils/bytes';
import { ZERO_ADDRESS } from '../utils/constants';
import { aes } from '../utils/encryption';
import { TransactNote } from './transact-note';

export class ShieldNote {
  readonly masterPublicKey: bigint;

  readonly random: string;

  readonly value: bigint;

  readonly tokenAddress: string;

  readonly tokenType: TokenType;

  readonly tokenSubID: string;

  readonly notePublicKey: bigint;

  readonly hash: bigint;

  constructor(
    masterPublicKey: bigint,
    random: string,
    value: bigint,
    tokenAddress: string,
    tokenType: TokenType,
    tokenSubID?: string,
  ) {
    TransactNote.assertValidRandom(random);
    TransactNote.assertValidToken(tokenAddress, tokenType, tokenSubID, value);

    this.masterPublicKey = masterPublicKey;
    this.random = random;
    this.tokenAddress = tokenAddress;
    this.tokenType = tokenType;
    this.tokenSubID = tokenSubID || ZERO_ADDRESS;
    this.value = value;
    this.notePublicKey = this.getNotePublicKey();
    this.hash = this.getHash();
  }

  static ShieldedNFT(
    masterPublicKey: bigint,
    random: string,
    tokenAddress: string,
    tokenID: number,
  ) {
    return new ShieldNote(
      masterPublicKey,
      random,
      ShieldNote.nftNoteValue(),
      tokenAddress,
      TokenType.ERC721,
      ShieldNote.nftTokenIDToSubID(tokenID),
    );
  }

  /**
   * Used to generate a shieldPrivateKey by signing this message with public wallet.
   * After shielding, the shieldPrivateKey can then be used to get the 0zk address of the receiver.
   */
  static getShieldPrivateKeySignatureMessage() {
    // DO NOT MODIFY THIS CONSTANT.
    return 'RAILGUN_SHIELD';
  }

  private static nftTokenIDToSubID(tokenID: number): string {
    return nToHex(BigInt(tokenID), ByteLength.Address, true);
  }

  private static nftNoteValue(): bigint {
    return BigInt(1);
  }

  get tokenData() {
    return {
      tokenAddress: this.tokenAddress,
      tokenType: this.tokenType,
      tokenSubID: this.tokenSubID,
    };
  }

  private getNotePublicKey(): bigint {
    return poseidon([this.masterPublicKey, hexToBigInt(this.random)]);
  }

  /**
   * Get note hash
   */
  private getHash(): bigint {
    return poseidon([this.notePublicKey, hexToBigInt(this.tokenAddress), this.value]);
  }

  static decryptRandom(encryptedBundle: [string, string, string], sharedKey: Uint8Array): string {
    const hexlified0 = hexlify(encryptedBundle[0]);
    const hexlified1 = hexlify(encryptedBundle[1]);
    const decrypted = aes.gcm.decrypt(
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
    const encryptedRandom = aes.gcm.encrypt([this.random], sharedKey);

    // Encrypt receiver public key
    const encryptedReceiver = aes.ctr.encrypt(
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
