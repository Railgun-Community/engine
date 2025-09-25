import { Signature } from '@railgun-community/circomlibjs';
import msgpack from 'msgpack-lite';
import { PublicInputsRailgun, type ShareableViewingKeyData, type ViewOnlyWalletData } from '../models';
import { ViewOnlyWallet } from './view-only-wallet';
import { Babyjubjub, type SpendingKeyPair, type SpendingPublicKey, type ViewingKeyPair, type WalletNode } from '../key-derivation';
import { ByteLength, ByteUtils, getPublicViewingKey } from '../utils';
import { isDefined } from '../utils/is-defined';
import type { Database } from '../database/database';
import type { Prover } from '../prover/prover';
import { AbstractWallet } from './abstract-wallet';
import { poseidon } from '../utils/poseidon';
import { sha256 } from '../utils/hash';
import { ZERO_ADDRESS } from '../utils/constants';

// import { poseidon } from '../utils/poseidon';


export type WakuConnector = {
  myId: number;

  symmetricKey: string;
  sessionId: string;
  sign: (myId: number, sessionId: string, symmetricKey: string, publicInputs: PublicInputsRailgun, expectedHash: bigint) => Promise<Signature>

}

class MultisigWallet extends AbstractWallet {

  waku: WakuConnector | undefined

  personalPrivateShare: string | undefined

  symmetricKey: string | undefined

  sessionId: string | undefined

  myId: number | undefined;

  spendPubKey: SpendingPublicKey;

  // protected static async createWallet(
  //   id: string,
  //   db: Database,
  //   shareableViewingKey: string,
  //   creationBlockNumbers: Optional<number[][]>,
  //   prover: Prover,
  // ) {
  //   const { viewingPrivateKey, spendingPublicKey } =
  //     AbstractWallet.getKeysFromShareableViewingKey(shareableViewingKey);
  //   const viewingKeyPair: ViewingKeyPair = await ViewOnlyWallet.getViewingKeyPair(
  //     viewingPrivateKey,
  //   );
  //   return new MultisigWallet(
  //     id,
  //     db,
  //     viewingKeyPair,
  //     spendingPublicKey,
  //     creationBlockNumbers,
  //     prover,
  //   );
  // }

//   /**
//  * Create a wallet from mnemonic
//  * @param {Database} db - database
//  * @param {BytesData} encryptionKey - encryption key to use with database
//  * @param {string} shareableViewingKey - encoded keys to load wallet from
//  * @returns {Wallet} Wallet
//  */
//   static async fromShareableViewingKey(
//     db: Database,
//     encryptionKey: string,
//     shareableViewingKey: string,
//     creationBlockNumbers: Optional<number[][]>,
//     prover: Prover,
//   ): Promise<AbstractWallet> {
//     const id = MultisigWallet.generateID(shareableViewingKey);

//     // Write encrypted shareableViewingKey to DB
//     await AbstractWallet.write(db, id, encryptionKey, {
//       shareableViewingKey,
//       creationBlockNumbers,
//     });

//     return this.createWallet(id, db, shareableViewingKey, creationBlockNumbers, prover);
//   }

  constructor(
    id: string,
    db: Database,
    viewingKeyPair: ViewingKeyPair,
    spendingPublicKey: SpendingPublicKey,
    creationBlockNumbers: Optional<number[][]>,
    prover: Prover,
  ){
    super(
      id,
      db,
      viewingKeyPair,
      spendingPublicKey,
      creationBlockNumbers,
      prover
    )
    this.spendPubKey = spendingPublicKey

  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  setConnector(waku: WakuConnector) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment
    this.waku = waku
    // generateSymmetric key
    // lets just hash this for ease, we dont need anything 'too over the top' here.
    this.symmetricKey = waku.symmetricKey
    this.sessionId = waku.sessionId
    this.myId = waku.myId
    console.log("symmetricKey Generated", this.symmetricKey)
    console.log("symmetricKey Generated", this.sessionId)
    // const pubk = await getPublicViewingKey(this.viewingKeyPair.privateKey)
    // const symBytes = await getSharedSymmetricKey(pk, pubk)
    // if(isDefined(symBytes)){

    //   const symmetricKey = ByteUtils.fastBytesToHex(symBytes)
    //   this.symmetricKey = `0x${symmetricKey}`
    //   console.log("symmetricKey Generated", this.symmetricKey)
    //   return
    // }
    // throw new Error('Invalid symmetric key generated')
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-explicit-any
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars, class-methods-use-this
  async sign(publicInputs: PublicInputsRailgun, _encryptionKey: string): Promise<Signature> {

    // og actions
    // const msg = poseidon([publicInputs.merkleRoot, publicInputs.boundParamsHash, ...publicInputs.nullifiers, ...publicInputs.commitmentsOut]);
    // return signEDDSA(spendingKeyPair.privateKey, msg);

    // submit publicInputs to this.waku.sign(publicInputs, symmetricKey)

    // multi-sig flow
    // generate symmetric key from viewingKey 
    // waku-signer will be listening for messages on a 'specific-channel' for this wallet
    // initiator will send publicInputs out in a 'signing-request'
    //  - awaits threshold 'partial-signatures'
    //  - computes final signature & returns to here...

    if (
      !isDefined(this.waku) ||
      !isDefined(this.symmetricKey) ||
      !isDefined(this.sessionId) ||
      !isDefined(this.myId)
    ) {
      throw new Error("Waku Connector not properly initialized.")
    }
    const msg = poseidon([publicInputs.merkleRoot, publicInputs.boundParamsHash, ...publicInputs.nullifiers, ...publicInputs.commitmentsOut]);

    return await this.waku.sign(this.myId, this.sessionId, this.symmetricKey, publicInputs, msg)
    // throw new Error('Signer not implemented for multisig.');
  }


  // // use this prior to 'create-wallet' in wallet -> engine interaction
  static getShareableViewingKey(spendingPublicKey: SpendingPublicKey, viewingPrivateKey: Uint8Array): string {
    const spendingPublicKeyString = Babyjubjub.packPoint(spendingPublicKey).toString('hex');
    // console.log('spendingPublicKey', spendingPublicKeyString)
    const data: ShareableViewingKeyData = {
      vpriv: ByteUtils.formatToByteLength(viewingPrivateKey, ByteLength.UINT_256),
      spub: spendingPublicKeyString,
    };
    console.log('data', data)
    return msgpack.encode(data).toString('hex');
  }
  
  /**
   * Calculate Wallet ID from mnemonic and derivation path index
   * @returns {string} hash of mnemonic and index
   */
  private static generateID(shareableViewingKey: string): string {
    return sha256(shareableViewingKey);
  }

  private static async getViewingKeyPair(viewingPrivateKey: string): Promise<ViewingKeyPair> {
    const vpk = ByteUtils.hexStringToBytes(viewingPrivateKey);
    return {
      privateKey: vpk,
      pubkey: await getPublicViewingKey(vpk),
    };
  }

  private static async createWallet(
    id: string,
    db: Database,
    shareableViewingKey: string,
    creationBlockNumbers: Optional<number[][]>,
    prover: Prover,
  ) {
    const { viewingPrivateKey, spendingPublicKey } =
      AbstractWallet.getKeysFromShareableViewingKey(shareableViewingKey);

    const viewingKeyPair: ViewingKeyPair = await MultisigWallet.getViewingKeyPair(
      viewingPrivateKey,
    );
    return new MultisigWallet(
      id,
      db,
      viewingKeyPair,
      spendingPublicKey,
      creationBlockNumbers,
      prover,
    );
  }

  /**
   * Create a wallet from mnemonic
   * @param {Database} db - database
   * @param {BytesData} encryptionKey - encryption key to use with database
   * @param {string} shareableViewingKey - encoded keys to load wallet from
   * @returns {Wallet} Wallet
   */
  static async fromShareableViewingKey(
    db: Database,
    encryptionKey: string,
    shareableViewingKey: string,
    creationBlockNumbers: Optional<number[][]>,
    prover: Prover,
  ): Promise<AbstractWallet> {
    const id = MultisigWallet.generateID(shareableViewingKey);

    // Write encrypted shareableViewingKey to DB
    await AbstractWallet.write(db, id, encryptionKey, {
      shareableViewingKey,
      creationBlockNumbers,
    });

    return this.createWallet(id, db, shareableViewingKey, creationBlockNumbers, prover);
  }

  /**
   * Loads wallet data from database and creates wallet object
   * @param {Database} db - database
   * @param {BytesData} encryptionKey - encryption key to use with database
   * @param {string} id - wallet id
   * @returns {Wallet} Wallet
   */
  static async loadExisting(
    db: Database,
    encryptionKey: string,
    id: string,
    prover: Prover,
  ): Promise<AbstractWallet> {
    // Get encrypted shareableViewingKey from DB
    const { shareableViewingKey, creationBlockNumbers } = (await AbstractWallet.read(
      db,
      id,
      encryptionKey,
    )) as ViewOnlyWalletData;
    if (!shareableViewingKey) {
      throw new Error(
        'Incorrect wallet type: ViewOnly wallet requires stored shareableViewingKey.',
      );
    }

    return this.createWallet(id, db, shareableViewingKey, creationBlockNumbers, prover);
  }

  async getSpendingKeyPair(): Promise<SpendingKeyPair>{

    return {
      privateKey: new Uint8Array(32), // not used except for in the wallet.sign() function 
      pubkey: this.spendPubKey
    }
  }

  private async loadSpendingKey(encryptionKey: string): Promise<WalletNode> {
    if(false){
      console.log((this.id))
    }

    return {} as WalletNode
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async getChainAddress(encryptionKey: string): Promise<string> {
    this.getAddress()
      return ZERO_ADDRESS
  }

  // need these 
  /*
    src/services/railgun/wallets/wallets.ts:67:3 - error TS2322: Type 'RailgunWallet | MultisigWallet' is not assignable to type 'RailgunWallet'.
      Type 'MultisigWallet' is missing the following properties from type 'RailgunWallet': getSpendingKeyPair, loadSpendingKey, getChainAddress

    67   return wallet;
        ~~~~~~~~~~~~~~

  */

}

export { MultisigWallet };
