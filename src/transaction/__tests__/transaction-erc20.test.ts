import { poseidon } from '@railgun-community/circomlibjs';
import chai, { assert } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import memdown from 'memdown';
import { groth16 } from 'snarkjs';
import { Wallet } from 'ethers';
import {
  Ciphertext,
  CommitmentType,
  LegacyGeneratedCommitment,
  NoteAnnotationData,
  OutputType,
  SenderAnnotationDecrypted,
} from '../../models/formatted-types';
import { Chain, ChainType } from '../../models/engine-types';
import { Memo } from '../../note/memo';
import { ByteLength, ByteUtils } from '../../utils/bytes';
import {
  getNoteBlindingKeys,
  getSharedSymmetricKey,
  signEDDSA,
  verifyEDDSA,
} from '../../utils/keys-utils';
import {
  DECIMALS_18,
  ZERO_ADDRESS,
  getEthersWallet,
  getTestTXIDVersion,
  isV2Test,
  testArtifactsGetter,
} from '../../test/helper.test';
import { Database } from '../../database/database';
import { AddressData } from '../../key-derivation/bech32';
import { TransactNote } from '../../note/transact-note';
import { Prover, SnarkJSGroth16 } from '../../prover/prover';
import { type ExternalSignerConnector, HardwareWallet } from '../../wallet/hardware-wallet';
import { RailgunWallet } from '../../wallet/railgun-wallet';
import { config } from '../../test/config.test';
import { hashBoundParamsV2, hashBoundParamsV3 } from '../bound-params';
import { Proof, TXIDVersion, UnprovedTransactionInputs } from '../../models';
import WalletInfo from '../../wallet/wallet-info';
import { TransactionBatch } from '../transaction-batch';
import { getTokenDataERC20, getTokenDataHashERC20 } from '../../note/note-util';
import { TokenDataGetter } from '../../token/token-data-getter';
import { ContractStore } from '../../contracts/contract-store';
import { RailgunSmartWalletContract } from '../../contracts/railgun-smart-wallet/V2/railgun-smart-wallet';
import { BoundParamsStruct } from '../../abi/typechain/RailgunSmartWallet';
import { PollingJsonRpcProvider } from '../../provider/polling-json-rpc-provider';
import { UTXOMerkletree } from '../../merkletree/utxo-merkletree';
import { AES } from '../../utils/encryption/aes';
import { POI } from '../../poi/poi';
import { PoseidonMerkleVerifier } from '../../abi/typechain';
import { addChainSupportsV3 } from '../../chain/chain';
import { XChaCha20 } from '../../utils/encryption/x-cha-cha-20';
import { MEMO_SENDER_RANDOM_NULL } from '../../models/transaction-constants';
import { ZERO_32_BYTE_VALUE } from '../../utils/constants';

chai.use(chaiAsPromised);
const { expect } = chai;

const txidVersion = getTestTXIDVersion();

let db: Database;
let utxoMerkletree: UTXOMerkletree;
let wallet: RailgunWallet;
let tokenDataGetter: TokenDataGetter;
let chain: Chain;
let ethersWallet: Wallet;
let transactionBatch: TransactionBatch;
let prover: Prover;
let address: AddressData;

const testMnemonic = config.mnemonic;
const testEncryptionKey = config.encryptionKey;

const tokenAddress = '0x5FbDB2315678afecb367f032d93F642f64180aa3';
const tokenData = getTokenDataERC20(tokenAddress);
type makeNoteFn = (value?: bigint) => Promise<TransactNote>;
let makeNote: makeNoteFn;

const shieldLeaf: LegacyGeneratedCommitment = {
  commitmentType: CommitmentType.LegacyGeneratedCommitment,
  hash: '10c139398677d31020ddf97e0c73239710c956a52a7ea082a1e84815582bfb5f',
  txid: '0xc97a2d06ceb87f81752bd58310e4aca822ae18a747e4dde752020e0b308a3aee',
  timestamp: undefined,
  preImage: {
    npk: '1d73bae2faf4ff18e1cd22d22cb9c05bc08878dc8fa4907257ce1a7ad51933f7',
    token: getTokenDataERC20(tokenAddress),
    value: '000000000000021cbfcc6fd98333b5f1',
  },
  encryptedRandom: [
    '0x7797f244fc1c60af03f25cbe9a798080b920733cc2de2456af21ee7c9eb1ca0c',
    '0x118beef50353ab8512be871c0473e219',
  ] as [string, string],
  blockNumber: 0,
  utxoTree: 0,
  utxoIndex: 0,
};

describe('transaction-erc20', function test() {
  this.timeout(120000);
  this.beforeAll(async () => {
    db = new Database(memdown());
    chain = {
      type: ChainType.EVM,
      id: 1,
    };
    utxoMerkletree = await UTXOMerkletree.create(db, chain, txidVersion, async () => true);
    wallet = await RailgunWallet.fromMnemonic(
      db,
      testEncryptionKey,
      testMnemonic,
      0,
      undefined, // creationBlockNumbers
      new Prover(testArtifactsGetter),
    );
    WalletInfo.setWalletSource('erc20 Wallet');
    ethersWallet = getEthersWallet(testMnemonic);
    prover = new Prover(testArtifactsGetter);
    prover.setSnarkJSGroth16(groth16 as SnarkJSGroth16);
    address = wallet.addressKeys;

    addChainSupportsV3(chain);

    await wallet.loadUTXOMerkletree(txidVersion, utxoMerkletree);

    POI.launchBlocks.set(null, chain, 0);

    // Load fake contract
    ContractStore.railgunSmartWalletContracts.set(
      null,
      chain,
      new RailgunSmartWalletContract(
        config.contracts.proxy,
        new PollingJsonRpcProvider('abc', 1, 500),
        new PollingJsonRpcProvider('abc', 1, 500),
        chain,
      ),
    );

    tokenDataGetter = new TokenDataGetter(db);

    makeNote = async (
      value: bigint = 65n * DECIMALS_18,
      outputType: OutputType = OutputType.Transfer,
    ): Promise<TransactNote> => {
      return TransactNote.createTransfer(
        address,
        undefined,
        value,
        tokenData,
        false, // showSenderAddressToRecipient
        outputType,
        undefined, // memoText
      );
    };
    utxoMerkletree.merklerootValidator = () => Promise.resolve(true);
    await utxoMerkletree.queueLeaves(0, 0, [shieldLeaf]); // start with a shield
    await utxoMerkletree.updateTreesFromWriteQueue();

    let scanProgress = 0;
    await wallet.decryptBalances(
      txidVersion,
      chain,
      (progress: number) => {
        scanProgress = progress;
      },
      false, // deferCompletionCallback
    );
    expect(scanProgress).to.equal(1);

    await wallet.refreshPOIsForTXIDVersion(chain, txidVersion, true);
  });

  beforeEach(async () => {
    transactionBatch = new TransactionBatch(chain);
  });

  it('Should hash bound parameters for V2', async () => {
    const params: BoundParamsStruct = {
      treeNumber: BigInt(0),
      unshield: BigInt(0),
      adaptContract: ByteUtils.formatToByteLength('00', 20, true),
      adaptParams: ByteUtils.formatToByteLength('00', 32, true),
      chainID: chain.id,
      commitmentCiphertext: [
        {
          ciphertext: [
            ByteUtils.formatToByteLength('00', ByteLength.UINT_256, true),
            ByteUtils.formatToByteLength('00', ByteLength.UINT_256, true),
            ByteUtils.formatToByteLength('00', ByteLength.UINT_256, true),
            ByteUtils.formatToByteLength('00', ByteLength.UINT_256, true),
          ],
          memo: ByteUtils.hexlify('00', true),
          blindedReceiverViewingKey: ByteUtils.formatToByteLength('00', ByteLength.UINT_256, true),
          blindedSenderViewingKey: ByteUtils.formatToByteLength('00', ByteLength.UINT_256, true),
          annotationData: ByteUtils.hexlify('00', true),
        },
      ],
      minGasPrice: BigInt(3000),
    };
    const hashed = hashBoundParamsV2(params);
    assert.typeOf(hashed, 'bigint');
    expect(hashed).to.equal(
      7297316625290769368067090402207718021912518614094704642142032948132837136470n,
    );
  });

  it('Should hash bound parameters for V3', async () => {
    const boundParams: PoseidonMerkleVerifier.BoundParamsStruct = {
      local: {
        treeNumber: BigInt(0),
        commitmentCiphertext: [
          {
            ciphertext: `0x${[
              ByteUtils.formatToByteLength('00', ByteLength.UINT_256),
              ByteUtils.formatToByteLength('00', ByteLength.UINT_256),
              ByteUtils.formatToByteLength('00', ByteLength.UINT_256),
              ByteUtils.formatToByteLength('00', ByteLength.UINT_256),
            ].join('')}`,
            blindedReceiverViewingKey: ByteUtils.formatToByteLength(
              '00',
              ByteLength.UINT_256,
              true,
            ),
            blindedSenderViewingKey: ByteUtils.formatToByteLength('00', ByteLength.UINT_256, true),
          },
        ],
      },
      global: {
        minGasPrice: 1n,
        chainID: chain.id,
        senderCiphertext: '0x',
        to: ZERO_ADDRESS,
        data: '0x',
      },
    };
    const hashed = hashBoundParamsV3(boundParams);
    assert.typeOf(hashed, 'bigint');
    expect(hashed).to.equal(
      1042853354636355096886642476862765074115784833677897463840889848516202023630n,
    );
  });

  it('Should encode and decode masterPublicKey', () => {
    const senderMasterPublicKey = address.masterPublicKey;

    const encodedMasterPublicKeyNoSenderRandom = TransactNote.getEncodedMasterPublicKey(
      MEMO_SENDER_RANDOM_NULL,
      1000000000n,
      senderMasterPublicKey,
    );
    const encodedMasterPublicKeyNullSenderRandom = TransactNote.getEncodedMasterPublicKey(
      MEMO_SENDER_RANDOM_NULL,
      1000000000n,
      senderMasterPublicKey,
    );
    const senderRandom = ByteUtils.randomHex(15);
    const encodedMasterPublicKeyWithSenderRandom = TransactNote.getEncodedMasterPublicKey(
      senderRandom,
      1000000000n,
      senderMasterPublicKey,
    );
    expect(encodedMasterPublicKeyNoSenderRandom).to.equal(encodedMasterPublicKeyNullSenderRandom);
    expect(encodedMasterPublicKeyNoSenderRandom).to.not.equal(
      encodedMasterPublicKeyWithSenderRandom,
    );

    expect(1000000000n).to.equal(
      TransactNote.getDecodedMasterPublicKey(
        senderMasterPublicKey,
        encodedMasterPublicKeyNoSenderRandom,
        undefined,
        false,
      ),
    );
    expect(1000000000n).to.equal(
      TransactNote.getDecodedMasterPublicKey(
        senderMasterPublicKey,
        encodedMasterPublicKeyNullSenderRandom,
        MEMO_SENDER_RANDOM_NULL,
        false,
      ),
    );
    expect(1000000000n).to.equal(
      TransactNote.getDecodedMasterPublicKey(
        senderMasterPublicKey,
        encodedMasterPublicKeyWithSenderRandom,
        senderRandom,
        false,
      ),
    );
  });

  it('Should generate ciphertext decryptable by sender and recipient - with memo', async () => {
    const wallet2 = await RailgunWallet.fromMnemonic(
      db,
      testEncryptionKey,
      testMnemonic,
      1,
      undefined, // creationBlockNumbers
      new Prover(testArtifactsGetter),
    );

    const sender = wallet.getViewingKeyPair();
    const receiver = wallet2.getViewingKeyPair();

    const senderRandom = ByteUtils.randomHex(15);
    const noteAnnotationData: NoteAnnotationData = {
      outputType: OutputType.BroadcasterFee,
      senderRandom,
      walletSource: 'erc20 wallet',
    };
    const senderCiphertext: SenderAnnotationDecrypted = {
      outputType: OutputType.BroadcasterFee,
      walletSource: 'erc20 wallet',
    };

    const memoText = 'Some Memo Text';

    const blockNumber = 5;

    const note = TransactNote.createTransfer(
      wallet2.addressKeys,
      wallet.addressKeys,
      100n,
      tokenData,
      false, // showSenderAddressToRecipient
      noteAnnotationData.outputType,
      memoText,
    );

    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-expect-error
    note.senderRandom = senderRandom;

    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore - required to set readonly blockNumber
    note.blockNumber = blockNumber;

    assert.isTrue(note.receiverAddressData.viewingPublicKey === receiver.pubkey);
    const blindingKeys = getNoteBlindingKeys(
      sender.pubkey,
      note.receiverAddressData.viewingPublicKey,
      note.random,
      senderRandom,
    );

    const senderShared = await getSharedSymmetricKey(
      sender.privateKey,
      blindingKeys.blindedReceiverViewingKey,
    );
    const receiverShared = await getSharedSymmetricKey(
      receiver.privateKey,
      blindingKeys.blindedSenderViewingKey,
    );
    assert(senderShared != null);
    assert(receiverShared != null);
    expect(senderShared).to.deep.equal(receiverShared);

    let noteCiphertext;
    let noteMemo;
    let annotationData;
    let encodedMasterPublicKey;

    switch (txidVersion) {
      case TXIDVersion.V2_PoseidonMerkle: {
        const encryptedValues = note.encryptV2(
          txidVersion,
          senderShared,
          wallet.addressKeys.masterPublicKey,
          senderRandom,
          sender.privateKey,
        );
        noteCiphertext = encryptedValues.noteCiphertext;
        noteMemo = encryptedValues.noteMemo;
        annotationData = encryptedValues.annotationData;

        // Make sure masterPublicKey is raw (unencoded) as encodedMasterPublicKey.
        const ciphertextDataWithMemoText = [...noteCiphertext.data, noteMemo];
        const fullCiphertext: Ciphertext = {
          ...noteCiphertext,
          data: ciphertextDataWithMemoText,
        };
        const decryptedValues = AES.decryptGCM(fullCiphertext, senderShared).map((value) =>
          ByteUtils.hexlify(value),
        );
        encodedMasterPublicKey = ByteUtils.hexToBigInt(decryptedValues[0]);
        break;
      }
      case TXIDVersion.V3_PoseidonMerkle: {
        noteCiphertext = note.encryptV3(
          txidVersion,
          senderShared,
          wallet.addressKeys.masterPublicKey,
        );
        noteMemo = '';
        annotationData = Memo.createSenderAnnotationEncryptedV3(
          WalletInfo.walletSource,
          [noteAnnotationData.outputType],
          sender.privateKey,
        );

        // Make sure masterPublicKey is raw (unencoded) as encodedMasterPublicKey.
        const decryptedValues = XChaCha20.decryptChaCha20Poly1305(noteCiphertext, senderShared);
        encodedMasterPublicKey = ByteUtils.hexToBigInt(decryptedValues.substring(0, 64));
        break;
      }
    }

    expect(note.receiverAddressData.masterPublicKey).to.equal(encodedMasterPublicKey);

    const senderDecrypted = await TransactNote.decrypt(
      txidVersion,
      chain,
      wallet.addressKeys,
      noteCiphertext,
      senderShared,
      noteMemo,
      annotationData,
      sender.privateKey,
      blindingKeys.blindedReceiverViewingKey,
      blindingKeys.blindedSenderViewingKey,
      true, // isSentNote
      false, // isLegacyDecryption
      tokenDataGetter,
      blockNumber,
      isV2Test() ? undefined : 0, // transactCommitmentBatchIndex
    );
    expect(senderDecrypted.hash).to.equal(note.hash);
    expect(senderDecrypted.senderAddressData).to.deep.equal(wallet.addressKeys);
    expect(senderDecrypted.receiverAddressData).to.deep.equal(wallet2.addressKeys);

    switch (txidVersion) {
      case TXIDVersion.V2_PoseidonMerkle: {
        expect(Memo.decryptNoteAnnotationData(annotationData, sender.privateKey)).to.deep.equal(
          noteAnnotationData,
        );
        break;
      }
      case TXIDVersion.V3_PoseidonMerkle: {
        const decryptedSenderCiphertext = Memo.decryptSenderCiphertextV3(
          annotationData,
          sender.privateKey,
          0,
        );
        expect(decryptedSenderCiphertext).to.deep.equal(senderCiphertext);
        break;
      }
    }

    expect(senderDecrypted.memoText).to.equal(memoText);
    expect(senderDecrypted.blockNumber).to.equal(blockNumber);

    const receiverDecrypted = await TransactNote.decrypt(
      txidVersion,
      chain,
      wallet2.addressKeys,
      noteCiphertext,
      receiverShared,
      noteMemo,
      annotationData,
      wallet.getViewingKeyPair().privateKey,
      blindingKeys.blindedReceiverViewingKey,
      blindingKeys.blindedSenderViewingKey,
      false, // isSentNote
      false, // isLegacyDecryption
      tokenDataGetter,
      blockNumber,
      isV2Test() ? undefined : 0, // transactCommitmentBatchIndex
    );
    expect(receiverDecrypted.hash).to.equal(note.hash);
    expect(receiverDecrypted.senderAddressData).to.equal(undefined);
    expect(receiverDecrypted.receiverAddressData).to.deep.equal(wallet2.addressKeys);
    expect(receiverDecrypted.memoText).to.equal(memoText);
    expect(receiverDecrypted.blockNumber).to.equal(blockNumber);
  });

  it('Should generate ciphertext decryptable by sender and recipient - no memo', async () => {
    const wallet2 = await RailgunWallet.fromMnemonic(
      db,
      testEncryptionKey,
      testMnemonic,
      1,
      undefined, // creationBlockNumbers
      new Prover(testArtifactsGetter),
    );

    const sender = wallet.getViewingKeyPair();
    const receiver = wallet2.getViewingKeyPair();

    const senderRandom = ByteUtils.randomHex(15);
    const noteAnnotationData: NoteAnnotationData = {
      outputType: OutputType.BroadcasterFee,
      senderRandom,
      walletSource: 'erc20 wallet',
    };
    const senderCiphertext: SenderAnnotationDecrypted = {
      outputType: OutputType.BroadcasterFee,
      walletSource: 'erc20 wallet',
    };

    const memoText = undefined;

    const note = TransactNote.createTransfer(
      wallet2.addressKeys,
      wallet.addressKeys,
      100n,
      tokenData,
      false, // showSenderAddressToRecipient
      noteAnnotationData.outputType,
      memoText,
    );

    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-expect-error
    note.senderRandom = senderRandom;

    assert.isTrue(note.receiverAddressData.viewingPublicKey === receiver.pubkey);
    const blindingKeys = getNoteBlindingKeys(
      sender.pubkey,
      note.receiverAddressData.viewingPublicKey,
      note.random,
      senderRandom,
    );

    const senderShared = await getSharedSymmetricKey(
      sender.privateKey,
      blindingKeys.blindedReceiverViewingKey,
    );
    const receiverShared = await getSharedSymmetricKey(
      receiver.privateKey,
      blindingKeys.blindedSenderViewingKey,
    );
    assert(senderShared != null);
    assert(receiverShared != null);
    expect(senderShared).to.deep.equal(receiverShared);

    let noteCiphertext;
    let noteMemo;
    let annotationData;
    let encodedMasterPublicKey;

    switch (txidVersion) {
      case TXIDVersion.V2_PoseidonMerkle: {
        const encryptedValues = note.encryptV2(
          txidVersion,
          senderShared,
          wallet.addressKeys.masterPublicKey,
          senderRandom,
          sender.privateKey,
        );
        noteCiphertext = encryptedValues.noteCiphertext;
        noteMemo = encryptedValues.noteMemo;
        annotationData = encryptedValues.annotationData;

        // Make sure masterPublicKey is raw (unencoded) as encodedMasterPublicKey.
        const ciphertextDataWithMemoText = [...noteCiphertext.data, noteMemo];
        const fullCiphertext: Ciphertext = {
          ...noteCiphertext,
          data: ciphertextDataWithMemoText,
        };
        const decryptedValues = AES.decryptGCM(fullCiphertext, senderShared).map((value) =>
          ByteUtils.hexlify(value),
        );
        encodedMasterPublicKey = ByteUtils.hexToBigInt(decryptedValues[0]);
        break;
      }
      case TXIDVersion.V3_PoseidonMerkle: {
        noteCiphertext = note.encryptV3(
          txidVersion,
          senderShared,
          wallet.addressKeys.masterPublicKey,
        );
        noteMemo = '';
        annotationData = Memo.createSenderAnnotationEncryptedV3(
          WalletInfo.walletSource,
          [noteAnnotationData.outputType],
          sender.privateKey,
        );

        // Make sure masterPublicKey is raw (unencoded) as encodedMasterPublicKey.
        const decryptedValues = XChaCha20.decryptChaCha20Poly1305(noteCiphertext, senderShared);
        encodedMasterPublicKey = ByteUtils.hexToBigInt(decryptedValues.substring(0, 64));
        break;
      }
    }

    expect(note.receiverAddressData.masterPublicKey).to.equal(encodedMasterPublicKey);

    const senderDecrypted = await TransactNote.decrypt(
      txidVersion,
      chain,
      wallet.addressKeys,
      noteCiphertext,
      senderShared,
      noteMemo,
      annotationData,
      sender.privateKey,
      blindingKeys.blindedReceiverViewingKey,
      blindingKeys.blindedSenderViewingKey,
      true, // isSentNote
      false, // isLegacyDecryption
      tokenDataGetter,
      100, // blockNumber
      isV2Test() ? undefined : 0, // transactCommitmentBatchIndex
    );
    expect(senderDecrypted.hash).to.equal(note.hash);
    expect(senderDecrypted.senderAddressData).to.deep.equal(wallet.addressKeys);
    expect(senderDecrypted.receiverAddressData).to.deep.equal(wallet2.addressKeys);

    switch (txidVersion) {
      case TXIDVersion.V2_PoseidonMerkle: {
        expect(Memo.decryptNoteAnnotationData(annotationData, sender.privateKey)).to.deep.equal(
          noteAnnotationData,
        );
        break;
      }
      case TXIDVersion.V3_PoseidonMerkle: {
        expect(Memo.decryptSenderCiphertextV3(annotationData, sender.privateKey, 0)).to.deep.equal(
          senderCiphertext,
        );
        break;
      }
    }

    expect(senderDecrypted.memoText).to.equal(memoText);

    const receiverDecrypted = await TransactNote.decrypt(
      txidVersion,
      chain,
      wallet2.addressKeys,
      noteCiphertext,
      receiverShared,
      noteMemo,
      annotationData,
      sender.privateKey,
      blindingKeys.blindedReceiverViewingKey,
      blindingKeys.blindedSenderViewingKey,
      false, // isSentNote
      false, // isLegacyDecryption
      tokenDataGetter,
      100, // blockNumber
      isV2Test() ? undefined : 0, // transactCommitmentBatchIndex
    );
    expect(receiverDecrypted.hash).to.equal(note.hash);
    expect(receiverDecrypted.senderAddressData).to.equal(undefined);
    expect(receiverDecrypted.receiverAddressData).to.deep.equal(wallet2.addressKeys);
    expect(receiverDecrypted.memoText).to.equal(memoText);
  });

  it('Should generate ciphertext decryptable by sender and recipient - no senderRandom', async () => {
    const wallet2 = await RailgunWallet.fromMnemonic(
      db,
      testEncryptionKey,
      testMnemonic,
      1,
      undefined, // creationBlockNumbers
      new Prover(testArtifactsGetter),
    );

    const sender = wallet.getViewingKeyPair();
    const receiver = wallet2.getViewingKeyPair();

    const senderRandom = MEMO_SENDER_RANDOM_NULL;
    const noteAnnotationData: NoteAnnotationData = {
      outputType: OutputType.BroadcasterFee,
      senderRandom: MEMO_SENDER_RANDOM_NULL,
      walletSource: 'erc20 wallet',
    };
    const senderCiphertext: SenderAnnotationDecrypted = {
      outputType: OutputType.BroadcasterFee,
      walletSource: 'erc20 wallet',
    };

    const memoText = undefined;

    const note = TransactNote.createTransfer(
      wallet2.addressKeys,
      wallet.addressKeys,
      100n,
      tokenData,
      true, // showSenderAddressToRecipient
      noteAnnotationData.outputType,
      memoText,
    );

    assert.isTrue(note.receiverAddressData.viewingPublicKey === receiver.pubkey);
    const blindingKeys = getNoteBlindingKeys(
      sender.pubkey,
      note.receiverAddressData.viewingPublicKey,
      note.random,
      MEMO_SENDER_RANDOM_NULL,
    );

    const senderShared = await getSharedSymmetricKey(
      sender.privateKey,
      blindingKeys.blindedReceiverViewingKey,
    );
    const receiverShared = await getSharedSymmetricKey(
      receiver.privateKey,
      blindingKeys.blindedSenderViewingKey,
    );
    assert(senderShared != null);
    assert(receiverShared != null);
    expect(senderShared).to.deep.equal(receiverShared);

    let noteCiphertext;
    let noteMemo;
    let annotationData;
    let encodedMasterPublicKey;

    switch (txidVersion) {
      case TXIDVersion.V2_PoseidonMerkle: {
        const encryptedValues = note.encryptV2(
          txidVersion,
          senderShared,
          wallet.addressKeys.masterPublicKey,
          senderRandom,
          sender.privateKey,
        );
        noteCiphertext = encryptedValues.noteCiphertext;
        noteMemo = encryptedValues.noteMemo;
        annotationData = encryptedValues.annotationData;

        // Make sure masterPublicKey is raw (unencoded) as encodedMasterPublicKey.
        const ciphertextDataWithMemoText = [...noteCiphertext.data, noteMemo];
        const fullCiphertext: Ciphertext = {
          ...noteCiphertext,
          data: ciphertextDataWithMemoText,
        };
        const decryptedValues = AES.decryptGCM(fullCiphertext, senderShared).map((value) =>
          ByteUtils.hexlify(value),
        );
        encodedMasterPublicKey = ByteUtils.hexToBigInt(decryptedValues[0]);
        break;
      }
      case TXIDVersion.V3_PoseidonMerkle: {
        noteCiphertext = note.encryptV3(
          txidVersion,
          senderShared,
          wallet.addressKeys.masterPublicKey,
        );
        noteMemo = '';
        annotationData = Memo.createSenderAnnotationEncryptedV3(
          WalletInfo.walletSource,
          [noteAnnotationData.outputType],
          sender.privateKey,
        );

        // Make sure masterPublicKey is raw (unencoded) as encodedMasterPublicKey.
        const decryptedValues = XChaCha20.decryptChaCha20Poly1305(noteCiphertext, senderShared);
        encodedMasterPublicKey = ByteUtils.hexToBigInt(decryptedValues.substring(0, 64));
        break;
      }
    }

    expect(note.receiverAddressData.masterPublicKey).to.not.equal(encodedMasterPublicKey);

    const senderDecrypted = await TransactNote.decrypt(
      txidVersion,
      chain,
      wallet.addressKeys,
      noteCiphertext,
      senderShared,
      noteMemo,
      annotationData,
      wallet.getViewingKeyPair().privateKey,
      blindingKeys.blindedReceiverViewingKey,
      blindingKeys.blindedSenderViewingKey,
      true, // isSentNote
      false, // isLegacyDecryption
      tokenDataGetter,
      100, // blockNumber
      isV2Test() ? undefined : 0, // transactCommitmentBatchIndex
    );
    expect(senderDecrypted.hash).to.equal(note.hash);
    expect(senderDecrypted.senderAddressData).to.deep.equal(wallet.addressKeys);
    expect(senderDecrypted.receiverAddressData).to.deep.equal(wallet2.addressKeys);

    switch (txidVersion) {
      case TXIDVersion.V2_PoseidonMerkle: {
        expect(Memo.decryptNoteAnnotationData(annotationData, sender.privateKey)).to.deep.equal(
          noteAnnotationData,
        );
        break;
      }
      case TXIDVersion.V3_PoseidonMerkle: {
        expect(Memo.decryptSenderCiphertextV3(annotationData, sender.privateKey, 0)).to.deep.equal(
          senderCiphertext,
        );
        break;
      }
    }

    expect(senderDecrypted.memoText).to.equal(memoText);

    const receiverDecrypted = await TransactNote.decrypt(
      txidVersion,
      chain,
      wallet2.addressKeys,
      noteCiphertext,
      receiverShared,
      noteMemo,
      annotationData,
      wallet.getViewingKeyPair().privateKey,
      blindingKeys.blindedReceiverViewingKey,
      blindingKeys.blindedSenderViewingKey,
      false, // isSentNote
      false, // isLegacyDecryption
      tokenDataGetter,
      100, // blockNumber
      isV2Test() ? undefined : 0, // transactCommitmentBatchIndex
    );
    expect(receiverDecrypted.hash).to.equal(note.hash);
    expect(receiverDecrypted.senderAddressData).to.deep.equal(wallet.addressKeys);
    expect(receiverDecrypted.receiverAddressData).to.deep.equal(wallet2.addressKeys);
    expect(receiverDecrypted.memoText).to.equal(memoText);
  });

  it('Should generate a valid signature for hot wallet transaction', async () => {
    transactionBatch.addOutput(await makeNote());
    const spendingSolutionGroups =
      await transactionBatch.generateValidSpendingSolutionGroupsAllOutputs(wallet, txidVersion);
    expect(spendingSolutionGroups.length).to.equal(1);

    const transaction = transactionBatch.generateTransactionForSpendingSolutionGroup(
      spendingSolutionGroups[0],
      TransactionBatch.getChangeOutput(wallet, spendingSolutionGroups[0]),
    );

    const globalBoundParams: PoseidonMerkleVerifier.GlobalBoundParamsStruct = {
      minGasPrice: 0n,
      chainID: chain.id,
      senderCiphertext: '0x',
      to: ZERO_ADDRESS,
      data: '0x',
    };

    const { publicInputs } = await transaction.generateTransactionRequest(
      wallet,
      txidVersion,
      testEncryptionKey,
      globalBoundParams,
    );
    const signature = await wallet.sign(publicInputs, testEncryptionKey);
    const { privateKey, pubkey } = await wallet.getSpendingKeyPair(testEncryptionKey);
    const msg: bigint = poseidon(Object.values(publicInputs).flatMap((x) => x));

    assert.isTrue(verifyEDDSA(msg, signature, pubkey));

    expect(signature).to.deep.equal(signEDDSA(privateKey, msg));

    // Mnemonic-password wallet: the password is supplied (never stored) and must be
    // threaded through sign -> getSpendingKeyPair to derive the correct spending key.
    const mnemonicPassword = 'test mnemonic password';
    const passwordWallet = await RailgunWallet.fromMnemonicWithPassword(
      db,
      testEncryptionKey,
      testMnemonic,
      mnemonicPassword,
      0,
      undefined,
      prover,
    );
    const passwordSpendingKeyPair = await passwordWallet.getSpendingKeyPair(
      testEncryptionKey,
      mnemonicPassword,
    );
    const signatureWithMnemonicPassword = await passwordWallet.sign(
      publicInputs,
      testEncryptionKey,
      mnemonicPassword,
    );

    assert.isTrue(
      verifyEDDSA(msg, signatureWithMnemonicPassword, passwordSpendingKeyPair.pubkey),
    );
    expect(signatureWithMnemonicPassword).to.deep.equal(
      signEDDSA(passwordSpendingKeyPair.privateKey, msg),
    );

    // Signing a mnemonic-password wallet without the password must fail loudly rather
    // than silently derive a different, unrelated key.
    await expect(passwordWallet.sign(publicInputs, testEncryptionKey)).to.be.rejectedWith(
      'Incorrect mnemonic password for wallet.',
    );
    // Supplying a password for a wallet that has none must likewise fail.
    await expect(
      wallet.sign(publicInputs, testEncryptionKey, mnemonicPassword),
    ).to.be.rejectedWith('Incorrect mnemonic password for wallet.');
  });

  it('Should request one hardware wallet batch approval and sign with the returned sub-session', async () => {
    transactionBatch.addOutput(await makeNote(1n));

    const hardwareWallet = await HardwareWallet.fromShareableViewingKey(
      db,
      testEncryptionKey,
      wallet.generateShareableViewingKey(),
      undefined,
      prover,
    );
    await hardwareWallet.loadUTXOMerkletree(txidVersion, utxoMerkletree);
    await hardwareWallet.decryptBalances(txidVersion, chain, () => {}, false);
    await hardwareWallet.refreshPOIsForTXIDVersion(chain, txidVersion, true);

    const signedSubSessions: Optional<string>[] = [];
    const expectedHashes: bigint[] = [];
    let batchApprovalCalls = 0;
    let approvedRequestCount = 0;
    const connector: ExternalSignerConnector = {
      requestBatchApproval: async (requests) => {
        batchApprovalCalls += 1;
        approvedRequestCount = requests.length;
        return 'batch-sub-session';
      },
      sign: async (expectedHash, _publicInputs, subSession) => {
        signedSubSessions.push(subSession);
        expectedHashes.push(expectedHash);
        return signEDDSA(
          (await wallet.getSpendingKeyPair(testEncryptionKey)).privateKey,
          expectedHash,
        );
      },
    };
    hardwareWallet.setConnector(connector);

    const { provedTransactions } = await transactionBatch.generateTransactions(
      prover,
      hardwareWallet,
      txidVersion,
      testEncryptionKey,
      () => {},
      false,
    );

    expect(provedTransactions).to.have.length(1);
    expect(batchApprovalCalls).to.equal(1);
    expect(approvedRequestCount).to.equal(1);
    expect(expectedHashes).to.have.length(1);
    expect(signedSubSessions).to.deep.equal(['batch-sub-session']);
  });

  it('Should sign hardware wallet transactions without a batch approval sub-session when unsupported', async () => {
    transactionBatch.addOutput(await makeNote(1n));

    const hardwareWallet = await HardwareWallet.fromShareableViewingKey(
      db,
      testEncryptionKey,
      wallet.generateShareableViewingKey(),
      undefined,
      prover,
    );
    await hardwareWallet.loadUTXOMerkletree(txidVersion, utxoMerkletree);
    await hardwareWallet.decryptBalances(txidVersion, chain, () => {}, false);
    await hardwareWallet.refreshPOIsForTXIDVersion(chain, txidVersion, true);

    const signedSubSessions: Optional<string>[] = [];
    const connector: ExternalSignerConnector = {
      sign: async (expectedHash, _publicInputs, subSession) => {
        signedSubSessions.push(subSession);
        return signEDDSA(
          (await wallet.getSpendingKeyPair(testEncryptionKey)).privateKey,
          expectedHash,
        );
      },
    };
    hardwareWallet.setConnector(connector);

    const { provedTransactions } = await transactionBatch.generateTransactions(
      prover,
      hardwareWallet,
      txidVersion,
      testEncryptionKey,
      () => {},
      false,
    );

    expect(provedTransactions).to.have.length(1);
    expect(signedSubSessions).to.deep.equal([undefined]);
  });

  it('Should generate validated inputs for transaction batch', async () => {
    transactionBatch.addOutput(await makeNote());
    const spendingSolutionGroups =
      await transactionBatch.generateValidSpendingSolutionGroupsAllOutputs(wallet, txidVersion);
    expect(spendingSolutionGroups.length).to.equal(1);

    const transaction = transactionBatch.generateTransactionForSpendingSolutionGroup(
      spendingSolutionGroups[0],
      TransactionBatch.getChangeOutput(wallet, spendingSolutionGroups[0]),
    );

    const globalBoundParams: PoseidonMerkleVerifier.GlobalBoundParamsStruct = {
      minGasPrice: 0n,
      chainID: chain.id,
      senderCiphertext: '0x',
      to: ZERO_ADDRESS,
      data: '0x',
    };

    const { publicInputs } = await transaction.generateTransactionRequest(
      wallet,
      txidVersion,
      testEncryptionKey,
      globalBoundParams,
    );
    const { nullifiers, commitmentsOut } = publicInputs;
    expect(nullifiers.length).to.equal(1);
    expect(commitmentsOut.length).to.equal(2);

    transactionBatch.addOutput(await makeNote());
    transactionBatch.addOutput(await makeNote());
    transactionBatch.addOutput(await makeNote());
    transactionBatch.addOutput(await makeNote());
    transactionBatch.addOutput(await makeNote());
    await expect(
      transactionBatch.generateTransactions(
        prover,
        wallet,
        txidVersion,
        testEncryptionKey,
        () => {},
        false, // shouldGeneratePreTransactionPOIs
      ),
    ).to.eventually.be.rejectedWith('Can not add more than 5 outputs.');

    transactionBatch.resetOutputs();
    transactionBatch.addOutput(
      TransactNote.createTransfer(
        address,
        undefined,
        6500000000000n,
        getTokenDataERC20('000925cdf66ddf5b88016df1fe915e68eff8f192'),
        false, // showSenderAddressToRecipient
        OutputType.BroadcasterFee,
        undefined, // memoText
      ),
    );

    await expect(
      transactionBatch.generateValidSpendingSolutionGroupsAllOutputs(wallet, txidVersion),
    ).to.eventually.be.rejectedWith(
      'RAILGUN spendable private balance too low for 0x000925cdf66ddf5b88016df1fe915e68eff8f192',
    );

    transactionBatch.resetOutputs();
    transactionBatch.addOutput(await makeNote(21000000000027360000000000n));
    await expect(
      transactionBatch.generateValidSpendingSolutionGroupsAllOutputs(wallet, txidVersion),
    ).to.eventually.be.rejectedWith(
      'RAILGUN spendable private balance too low for 0x5fbdb2315678afecb367f032d93f642f64180aa3',
    );

    transactionBatch.resetOutputs();
    transactionBatch.addOutput(await makeNote(11000000000027360000000000n));
    await expect(
      transactionBatch.generateValidSpendingSolutionGroupsAllOutputs(wallet, txidVersion),
    ).to.eventually.be.rejectedWith(
      'RAILGUN spendable private balance too low for 0x5fbdb2315678afecb367f032d93f642f64180aa3',
    );

    const transaction2 = new TransactionBatch(chain);

    const tokenDataBadAddress = getTokenDataERC20('0x00000000000000000000000000000000000000ff');

    transaction2.addUnshieldData({
      toAddress: ethersWallet.address,
      value: 12n,
      tokenData: tokenDataBadAddress,
    });

    await expect(
      transaction2.generateValidSpendingSolutionGroupsAllOutputs(wallet, txidVersion),
    ).to.eventually.be.rejectedWith(
      'RAILGUN spendable private balance too low for 0x00000000000000000000000000000000000000ff',
    );
  });

  it('Should generate validated inputs for transaction batch - unshield', async () => {
    transactionBatch.addOutput(await makeNote());
    transactionBatch.addUnshieldData({
      toAddress: ethersWallet.address,
      value: 2n,
      tokenData,
    });
    const spendingSolutionGroups =
      await transactionBatch.generateValidSpendingSolutionGroupsAllOutputs(wallet, txidVersion);
    expect(spendingSolutionGroups.length).to.equal(1);

    const transaction = transactionBatch.generateTransactionForSpendingSolutionGroup(
      spendingSolutionGroups[0],
      TransactionBatch.getChangeOutput(wallet, spendingSolutionGroups[0]),
    );
    const globalBoundParams: PoseidonMerkleVerifier.GlobalBoundParamsStruct = {
      minGasPrice: 0n,
      chainID: chain.id,
      senderCiphertext: '0x',
      to: ZERO_ADDRESS,
      data: '0x',
    };
    const { publicInputs } = await transaction.generateTransactionRequest(
      wallet,
      txidVersion,
      testEncryptionKey,
      globalBoundParams,
    );
    const { nullifiers, commitmentsOut } = publicInputs;
    expect(nullifiers.length).to.equal(1);
    expect(commitmentsOut.length).to.equal(3);
  });

  it('Should create transaction proofs and serialized transactions', async () => {
    transactionBatch.addOutput(await makeNote(1n));
    const { provedTransactions: txs } = await transactionBatch.generateTransactions(
      prover,
      wallet,
      txidVersion,
      testEncryptionKey,
      () => {},
      false, // shouldGeneratePreTransactionPOIs
    );
    expect(txs.length).to.equal(1);
    expect(txs[0].nullifiers.length).to.equal(1);
    expect(txs[0].commitments.length).to.equal(2);

    transactionBatch.resetOutputs();
    transactionBatch.addOutput(await makeNote(1715000000000n));

    const { provedTransactions: txs2 } = await transactionBatch.generateTransactions(
      prover,
      wallet,
      txidVersion,
      testEncryptionKey,
      () => {},
      false, // shouldGeneratePreTransactionPOIs
    );
    expect(txs2.length).to.equal(1);
    expect(txs2[0].nullifiers.length).to.equal(1);
  });

  it('Should reject tampered proofs and tampered public inputs in verifyRailgunProof', async () => {
    transactionBatch.addOutput(await makeNote(1n));

    const spendingSolutionGroups =
      await transactionBatch.generateValidSpendingSolutionGroupsAllOutputs(wallet, txidVersion);
    expect(spendingSolutionGroups.length).to.equal(1);

    const tx = transactionBatch.generateTransactionForSpendingSolutionGroup(
      spendingSolutionGroups[0],
      TransactionBatch.getChangeOutput(wallet, spendingSolutionGroups[0]),
    );

    const globalBoundParams: PoseidonMerkleVerifier.GlobalBoundParamsStruct = {
      minGasPrice: 0n,
      chainID: chain.id,
      senderCiphertext: '0x',
      to: ZERO_ADDRESS,
      data: '0x',
    };

    const { publicInputs, privateInputs, boundParams } = await tx.generateTransactionRequest(
      wallet,
      txidVersion,
      testEncryptionKey,
      globalBoundParams,
    );

    const signature = await wallet.sign(publicInputs, testEncryptionKey);
    const signatureArray: [bigint, bigint, bigint] = [
      signature.R8[0],
      signature.R8[1],
      signature.S,
    ];
    const unprovedTransactionInputs: UnprovedTransactionInputs =
      txidVersion === TXIDVersion.V2_PoseidonMerkle
        ? {
            txidVersion: TXIDVersion.V2_PoseidonMerkle,
            privateInputs,
            publicInputs,
            boundParams: boundParams as BoundParamsStruct,
            signature: signatureArray,
          }
        : {
            txidVersion: TXIDVersion.V3_PoseidonMerkle,
            privateInputs,
            publicInputs,
            boundParams: boundParams as PoseidonMerkleVerifier.BoundParamsStruct,
            signature: signatureArray,
          };

    const { proof } = await prover.proveRailgun(
      txidVersion,
      unprovedTransactionInputs,
      () => {},
    );

    const artifacts = await testArtifactsGetter.getArtifacts(publicInputs);

    // A bit-flipped proof must not verify. The modified coordinate almost certainly
    // isn't on the curve, so snarkjs may either return false OR throw during
    // deserialization — both count as rejection.
    const verifyRejects = async (
      tamperedInputs: typeof publicInputs,
      tamperedProof: Proof,
    ): Promise<boolean> => {
      try {
        return !(await prover.verifyRailgunProof(tamperedInputs, tamperedProof, artifacts));
      } catch {
        return true;
      }
    };

    // Sanity check: legitimate proof verifies.
    expect(await prover.verifyRailgunProof(publicInputs, proof, artifacts)).to.equal(true);

    // Flip the lowest bit of pi_a.x.
    const bitFlippedProof: Proof = JSON.parse(JSON.stringify(proof));
    const piAxFlipped = BigInt(bitFlippedProof.pi_a[0]) ^ 1n;
    bitFlippedProof.pi_a[0] = `0x${piAxFlipped.toString(16)}`;
    expect(await verifyRejects(publicInputs, bitFlippedProof)).to.equal(true);

    // Neutral element (point at infinity). A buggy verifier might accept this
    // because e(O, π_b) = e(π_a, O) = 1, leading to a trivial 1 == 1 check.
    // Test both common encodings: all-zero affine and projective (0, 1, 0).
    const zeroProof: Proof = {
      pi_a: ['0x0', '0x0'],
      pi_b: [
        ['0x0', '0x0'],
        ['0x0', '0x0'],
      ],
      pi_c: ['0x0', '0x0'],
    };
    expect(await verifyRejects(publicInputs, zeroProof)).to.equal(true);

    const projectiveIdentityProof = {
      pi_a: ['0x0', '0x1', '0x0'],
      pi_b: [
        ['0x0', '0x0'],
        ['0x1', '0x0'],
        ['0x0', '0x0'],
      ],
      pi_c: ['0x0', '0x1', '0x0'],
    } as unknown as Proof;
    expect(await verifyRejects(publicInputs, projectiveIdentityProof)).to.equal(true);

    // Trivial proof: just the BN254 generators for G1 (π_a, π_c) and G2 (π_b).
    // Every coordinate is on-curve and in-subgroup, so snarkjs runs the full
    // pairing check and must return false (no throw) for a proof that proves nothing.
    const trivialGeneratorProof: Proof = {
      pi_a: ['0x1', '0x2'],
      pi_b: [
        [
          '0x198e9393920d483a7260bfb731fb5d25f1aa493335a9e71297e485b7aef312c2',
          '0x1800deef121f1e76426a00665e5c4479674322d4f75edadd46debd5cd992f6ed',
        ],
        [
          '0x090689d0585ff075ec9e99ad690c3395bc4b313370b38ef355acdadcd122975b',
          '0x12c85ea5db8c6deb4aab71808dcb408fe3d1e7690c43d37b4ce6cc0166fa7daa',
        ],
      ],
      pi_c: ['0x1', '0x2'],
    };
    expect(
      await prover.verifyRailgunProof(publicInputs, trivialGeneratorProof, artifacts),
    ).to.equal(false);

    // Each public input is bound to the proof — tampering any one must fail verification.
    const tamperedMerkleRoot = { ...publicInputs, merkleRoot: publicInputs.merkleRoot + 1n };
    expect(await prover.verifyRailgunProof(tamperedMerkleRoot, proof, artifacts)).to.equal(false);

    const tamperedBoundParamsHash = { ...publicInputs, boundParamsHash: 0n };
    expect(
      await prover.verifyRailgunProof(tamperedBoundParamsHash, proof, artifacts),
    ).to.equal(false);

    const tamperedNullifiers = {
      ...publicInputs,
      nullifiers: publicInputs.nullifiers.map((n) => n + 1n),
    };
    expect(await prover.verifyRailgunProof(tamperedNullifiers, proof, artifacts)).to.equal(false);

    const tamperedCommitments = {
      ...publicInputs,
      commitmentsOut: publicInputs.commitmentsOut.map((c) => c + 1n),
    };
    expect(await prover.verifyRailgunProof(tamperedCommitments, proof, artifacts)).to.equal(false);
  });

  it('Should test transaction proof progress callback final value', async () => {
    transactionBatch.addOutput(await makeNote(1n));
    let loadProgress = 0;
    await transactionBatch.generateTransactions(
      prover,
      wallet,
      txidVersion,
      testEncryptionKey,
      (progress) => {
        loadProgress = progress;
      },
      false, // shouldGeneratePreTransactionPOIs
    );
    expect(loadProgress).to.equal(100);
  });

  it('Should create dummy transaction proofs', async () => {
    transactionBatch.addOutput(await makeNote());
    const txs = await transactionBatch.generateDummyTransactions(
      prover,
      wallet,
      txidVersion,
      testEncryptionKey,
    );
    expect(txs.length).to.equal(1);
    expect(txs[0].nullifiers.length).to.equal(1);
    expect(txs[0].commitments.length).to.equal(2);
  });

  it('Should create dummy transaction proofs with origin shield txid', async () => {
    transactionBatch.addOutput(await makeNote());

    const tokenBalancesForUnshieldToOrigin = await wallet.getTokenBalancesForUnshieldToOrigin(
      txidVersion,
      chain,
      '0xc97a2d06ceb87f81752bd58310e4aca822ae18a747e4dde752020e0b308a3aee',
    );

    expect(tokenBalancesForUnshieldToOrigin[getTokenDataHashERC20(tokenAddress)]?.balance).to.equal(
      9975062344139650872817n, // 000000000000021cbfcc6fd98333b5f1
    );

    const txs = await transactionBatch.generateDummyTransactions(
      prover,
      wallet,
      txidVersion,
      testEncryptionKey,
      '0xc97a2d06ceb87f81752bd58310e4aca822ae18a747e4dde752020e0b308a3aee', // originShieldTxidForSpendabilityOverride
    );
    expect(txs.length).to.equal(1);
    expect(txs[0].nullifiers.length).to.equal(1);
    expect(txs[0].commitments.length).to.equal(2);

    await expect(
      transactionBatch.generateDummyTransactions(
        prover,
        wallet,
        txidVersion,
        testEncryptionKey,
        ZERO_32_BYTE_VALUE, // originShieldTxidForSpendabilityOverride
      ),
    ).to.be.rejectedWith(
      'RAILGUN balance too low for 0x5fbdb2315678afecb367f032d93f642f64180aa3 from shield origin txid 0x0000000000000000000000000000000000000000000000000000000000000000. Amount required: 65000000000000000000. Amount available: 0.',
    );
  });

  this.afterAll(async () => {
    // Clean up database
    wallet.unloadUTXOMerkletree(txidVersion, utxoMerkletree.chain);
    await db.close();
  });
});
