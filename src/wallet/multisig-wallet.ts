import { Signature } from '@railgun-community/circomlibjs';
import msgpack from 'msgpack-lite';
import { PublicInputsRailgun, type ShareableViewingKeyData } from '../models';
import { ViewOnlyWallet } from './view-only-wallet';
import { Babyjubjub, type SpendingPublicKey, type ViewingKeyPair } from '../key-derivation';
import { ByteLength, ByteUtils } from '../utils';
import { isDefined } from '../utils/is-defined';
import type { Database } from '../database/database';
import type { Prover } from '../prover/prover';
import { AbstractWallet } from './abstract-wallet';

// import { poseidon } from '../utils/poseidon';


export type WakuConnector = {

  symmetricKey: string;
  sessionId: string;
  sign: (publicInputs: PublicInputsRailgun, sessionId: string, symmetricKey: string) => Promise<Signature>

}

class MultisigWallet extends ViewOnlyWallet {

  waku: WakuConnector | undefined

  personalPrivateShare: string | undefined

  symmetricKey: string | undefined

  sessionId: string | undefined

  protected static async createWallet(
    id: string,
    db: Database,
    shareableViewingKey: string,
    creationBlockNumbers: Optional<number[][]>,
    prover: Prover,
  ) {
    const { viewingPrivateKey, spendingPublicKey } =
      AbstractWallet.getKeysFromShareableViewingKey(shareableViewingKey);
    const viewingKeyPair: ViewingKeyPair = await ViewOnlyWallet.getViewingKeyPair(
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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async setConnector(waku: WakuConnector){
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment
    this.waku = waku
    // generateSymmetric key
    // lets just hash this for ease, we dont need anything 'too over the top' here.
    this.symmetricKey = waku.symmetricKey
    this.sessionId = waku.sessionId
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
      !isDefined(this.sessionId)
    ) {
      throw new Error("Waku Connector not properly initialized.")
    }
    // const msg = poseidon([publicInputs.merkleRoot, publicInputs.boundParamsHash, ...publicInputs.nullifiers, ...publicInputs.commitmentsOut]);

    return await this.waku.sign(publicInputs, this.sessionId, this.symmetricKey)
    // throw new Error('Signer not implemented for multisig.');
  }


  // use this prior to 'create-wallet' in wallet -> engine interaction
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
}

export { MultisigWallet };
