import { Signature } from '@railgun-community/circomlibjs';
import { PublicInputsRailgun, type ViewOnlyWalletData } from '../models';
import { Database } from '../database/database';
import { SpendingKeyPair, SpendingPublicKey, ViewingKeyPair } from '../key-derivation/wallet-node';
import { ByteUtils } from '../utils/bytes';
import { sha256 } from '../utils/hash';
import { getPublicViewingKey } from '../utils/keys-utils';
import { AbstractWallet } from './abstract-wallet';
import { RailgunWallet } from './railgun-wallet';
import { Prover } from '../prover/prover';
import { isDefined } from '../utils/is-defined';
import { poseidon } from '../utils/poseidon';

export type ExternalSignerConnectorSignFn = (
  expectedHash: bigint,
  publicInputs?: PublicInputsRailgun,
  subSession?: string,
) => Promise<Signature>;

export type ExternalSignerConnector = {
  sign: ExternalSignerConnectorSignFn;
  requestBatchApproval?: (
    requests: readonly unknown[],
  ) => Promise<string>;
};

class HardwareWallet extends RailgunWallet {
  private connector: ExternalSignerConnector | undefined;

  private readonly storedSpendingPublicKey: SpendingPublicKey;

  constructor(
    id: string,
    db: Database,
    viewingKeyPair: ViewingKeyPair,
    spendingPublicKey: SpendingPublicKey,
    creationBlockNumbers: Optional<number[][]>,
    prover: Prover,
  ) {
    super(id, db, viewingKeyPair, spendingPublicKey, creationBlockNumbers, prover);
    this.storedSpendingPublicKey = spendingPublicKey;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async getSpendingKeyPair(_encryptionKey: string): Promise<SpendingKeyPair> {
    return {
      privateKey: new Uint8Array(32),
      pubkey: this.storedSpendingPublicKey,
    };
  }

  setConnector(connector: ExternalSignerConnector) {
    this.connector = connector;
  }

  async requestBatchApproval(
    requests: readonly unknown[],
  ): Promise<Optional<string>> {
    return this.connector?.requestBatchApproval?.(requests);
  }

  async sign(publicInputs: PublicInputsRailgun, subSession: string): Promise<Signature> {
    if (!isDefined(this.connector)) {
      throw new Error('External signer connector not initialized.');
    }
    const expectedHash = poseidon([
      publicInputs.merkleRoot,
      publicInputs.boundParamsHash,
      ...publicInputs.nullifiers,
      ...publicInputs.commitmentsOut,
    ]);
    return this.connector.sign(
      expectedHash,
      publicInputs,
      subSession.length ? subSession : undefined,
    );
  }

  private static generateHardwareID(shareableViewingKey: string): string {
    return sha256(shareableViewingKey);
  }

  private static async getHardwareViewingKeyPair(viewingPrivateKey: string): Promise<ViewingKeyPair> {
    const vpk = ByteUtils.hexStringToBytes(viewingPrivateKey);
    return {
      privateKey: vpk,
      pubkey: await getPublicViewingKey(vpk),
    };
  }

  private static async createHardwareWallet(
    id: string,
    db: Database,
    shareableViewingKey: string,
    creationBlockNumbers: Optional<number[][]>,
    prover: Prover,
  ) {
    const { viewingPrivateKey, spendingPublicKey } =
      AbstractWallet.getKeysFromShareableViewingKey(shareableViewingKey);
    const viewingKeyPair: ViewingKeyPair = await HardwareWallet.getHardwareViewingKeyPair(
      viewingPrivateKey,
    );
    return new HardwareWallet(
      id,
      db,
      viewingKeyPair,
      spendingPublicKey,
      creationBlockNumbers,
      prover,
    );
  }

  static async fromShareableViewingKey(
    db: Database,
    encryptionKey: string,
    shareableViewingKey: string,
    creationBlockNumbers: Optional<number[][]>,
    prover: Prover,
  ): Promise<HardwareWallet> {
    const id = HardwareWallet.generateHardwareID(shareableViewingKey);
    await AbstractWallet.write(db, id, encryptionKey, {
      shareableViewingKey,
      creationBlockNumbers,
    });
    return this.createHardwareWallet(id, db, shareableViewingKey, creationBlockNumbers, prover);
  }

  static async loadExisting(
    db: Database,
    encryptionKey: string,
    id: string,
    prover: Prover,
  ): Promise<HardwareWallet> {
    const { shareableViewingKey, creationBlockNumbers } = (await AbstractWallet.read(
      db,
      id,
      encryptionKey,
    )) as ViewOnlyWalletData;
    if (!shareableViewingKey) {
      throw new Error(
        'Incorrect wallet type: Hardware wallet requires stored shareableViewingKey.',
      );
    }

    return this.createHardwareWallet(id, db, shareableViewingKey, creationBlockNumbers, prover);
  }
}

export { HardwareWallet };