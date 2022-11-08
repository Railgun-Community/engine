import { poseidon, Signature } from 'circomlibjs';
import { Wallet as EthersWallet } from '@ethersproject/wallet';
import chai, { assert } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import memdown from 'memdown';
import { groth16 } from 'snarkjs';
import { BigNumber } from 'ethers';
import {
  Ciphertext,
  CommitmentType,
  LegacyGeneratedCommitment,
  NoteAnnotationData,
  OutputType,
  TokenType,
} from '../../models/formatted-types';
import { Chain, ChainType } from '../../models/engine-types';
import { Memo } from '../../note/memo';
import { TransactionBatch } from '../transaction-batch';
import { ByteLength, formatToByteLength, hexlify, hexToBigInt, randomHex } from '../../utils/bytes';
import {
  getNoteBlindingKeys,
  getSharedSymmetricKey,
  signEDDSA,
  verifyEDDSA,
} from '../../utils/keys-utils';
import { artifactsGetter, DECIMALS_18 } from '../../test/helper.test';
import { Database } from '../../database/database';
import { AddressData } from '../../key-derivation/bech32';
import { MerkleTree } from '../../merkletree/merkletree';
import { TransactNote } from '../../note/transact-note';
import { Prover, Groth16 } from '../../prover/prover';
import { RailgunWallet } from '../../wallet/railgun-wallet';
import { config } from '../../test/config.test';
import { hashBoundParams } from '../bound-params';
import { BoundParamsStruct } from '../../typechain-types/contracts/logic/RailgunSmartWallet';
import { MEMO_SENDER_RANDOM_NULL } from '../../models';
import WalletInfo from '../../wallet/wallet-info';
import { aes } from '../../utils';

chai.use(chaiAsPromised);
const { expect } = chai;

let db: Database;
let merkletree: MerkleTree;
let wallet: RailgunWallet;
let chain: Chain;
let ethersWallet: EthersWallet;
let transactionBatch: TransactionBatch;
let prover: Prover;
let address: AddressData;

const testMnemonic = config.mnemonic;
const testEncryptionKey = config.encryptionKey;

const token = '0x5FbDB2315678afecb367f032d93F642f64180aa3';
const random = randomHex(16);
type makeNoteFn = (value?: bigint) => Promise<TransactNote>;
let makeNote: makeNoteFn;

// const keypairs = [
//   {
//     // Primary 0
//     privateKey: hexStringToBytes('0852ea0ca28847f125cf5c206d8f62d4dc59202477dce90988dc57d5e9b2f144'),
//     pubkey: hexStringToBytes('c95956104f69131b1c269c30688d3afedd0c3a155d270e862ea4c1f89a603a1b'),
//     address: 'rgeth1q8y4j4ssfa53xxcuy6wrq6yd8tld6rp6z4wjwr5x96jvr7y6vqapk0tmp0s',
//   },
//   {
//     // Primary 1
//     privateKey: hexStringToBytes('0d65921bba9cd412064b41cf915266f5d9302e8bcbfd3ed8457ea914edbb01c2'),
//     pubkey: hexStringToBytes('6dd2398c78ea7662655bbce41224012c4948645ba12fc843f9dbb9a6b9e24005'),
//     address: 'rgeth1q9kaywvv0r48vcn9tw7wgy3yqykyjjrytwsjljzrl8dmnf4eufqq2qdalzf',
//   },
//   {
//     // Primary 5
//     privateKey: hexStringToBytes('0a84aed056690cf95db7a35a2f79795f3f6656203a05b35047b7cb7b6f4d27c3'),
//     pubkey: hexStringToBytes('49036a0ebd462c2a7e4311de737a92b6e36bd0c5505c446ec8919dfccc5d448e'),
//     address: 'rgeth1q9ysx6swh4rzc2n7gvgauum6j2mwx67sc4g9c3rwezgemlxvt4zgujlt072',
//   },
//   {
//     // Change 2
//     privateKey: hexStringToBytes('0ad38aeedddc5a9cbc51007ce04d1800a628cc5aea50c5c8fb4cd23c13941500'),
//     pubkey: hexStringToBytes('e4fb4c45e08bf87ba679185d03b0d5de4df67b5079226eff9d7e990a30773e07'),
//     address: 'rgeth1q8j0knz9uz9ls7ax0yv96qas6h0ymanm2pujymhln4lfjz3swulqwn5p63t',
//   },
// ];

const shieldLeaf: LegacyGeneratedCommitment = {
  commitmentType: CommitmentType.LegacyGeneratedCommitment,
  hash: '10c139398677d31020ddf97e0c73239710c956a52a7ea082a1e84815582bfb5f',
  txid: '0xc97a2d06ceb87f81752bd58310e4aca822ae18a747e4dde752020e0b308a3aee',
  preImage: {
    npk: '1d73bae2faf4ff18e1cd22d22cb9c05bc08878dc8fa4907257ce1a7ad51933f7',
    token: {
      tokenAddress: '0x5fbdb2315678afecb367f032d93f642f64180aa3',
      tokenType: TokenType.ERC20,
      tokenSubID: '0x0000000000000000000000000000000000000000',
    },
    value: '000000000000021cbfcc6fd98333b5f1',
  },
  encryptedRandom: [
    '0x7797f244fc1c60af03f25cbe9a798080b920733cc2de2456af21ee7c9eb1ca0c',
    '0x118beef50353ab8512be871c0473e219',
  ] as [string, string],
  blockNumber: 0,
};

describe('Transaction/ERC20', function test() {
  this.timeout(120000);
  this.beforeAll(async () => {
    db = new Database(memdown());
    chain = {
      type: ChainType.EVM,
      id: 1,
    };
    merkletree = new MerkleTree(db, chain, 'erc20', async () => true);
    wallet = await RailgunWallet.fromMnemonic(
      db,
      testEncryptionKey,
      testMnemonic,
      0,
      undefined, // creationBlockNumbers
    );
    WalletInfo.setWalletSource('erc20 Wallet');
    ethersWallet = EthersWallet.fromMnemonic(testMnemonic);
    prover = new Prover(artifactsGetter);
    prover.setSnarkJSGroth16(groth16 as Groth16);
    address = wallet.addressKeys;
    wallet.loadERC20Merkletree(merkletree);
    makeNote = async (
      value: bigint = 65n * DECIMALS_18,
      outputType: OutputType = OutputType.Transfer,
    ): Promise<TransactNote> => {
      return TransactNote.create(
        address,
        undefined,
        random,
        value,
        token,
        wallet.getViewingKeyPair(),
        false, // showSenderAddress
        outputType,
        undefined, // memoText
      );
    };
    merkletree.validateRoot = () => Promise.resolve(true);
    await merkletree.queueLeaves(0, 0, [shieldLeaf]); // start with a shield
    await merkletree.updateTrees();

    let scanProgress = 0;
    await wallet.scanBalances(chain, (progress: number) => {
      scanProgress = progress;
    });
    expect(scanProgress).to.equal(1);
  });

  beforeEach(async () => {
    transactionBatch = new TransactionBatch(token, TokenType.ERC20, chain);
  });

  it('Should hash bound parameters', async () => {
    const params: BoundParamsStruct = {
      treeNumber: BigInt(0),
      unshield: BigInt(0),
      adaptContract: formatToByteLength('00', 20, true),
      adaptParams: formatToByteLength('00', 32, true),
      chainID: chain.id,
      commitmentCiphertext: [
        {
          ciphertext: [
            formatToByteLength('00', ByteLength.UINT_256, true),
            formatToByteLength('00', ByteLength.UINT_256, true),
            formatToByteLength('00', ByteLength.UINT_256, true),
            formatToByteLength('00', ByteLength.UINT_256, true),
          ],
          memo: hexlify('00', true),
          blindedReceiverViewingKey: formatToByteLength('00', ByteLength.UINT_256, true),
          blindedSenderViewingKey: formatToByteLength('00', ByteLength.UINT_256, true),
          annotationData: hexlify('00', true),
        },
      ],
      minGasPrice: BigNumber.from(3000),
    };
    const hashed = hashBoundParams(params);
    assert.typeOf(hashed, 'bigint');
    expect(hashed).to.equal(
      7297316625290769368067090402207718021912518614094704642142032948132837136470n,
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
    const senderRandom = randomHex(15);
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
    );

    const sender = wallet.getViewingKeyPair();
    const receiver = wallet2.getViewingKeyPair();

    const senderRandom = randomHex(15);
    const noteAnnotationData: NoteAnnotationData = {
      outputType: OutputType.RelayerFee,
      senderRandom,
      walletSource: 'erc20 wallet',
    };

    const memoText = 'Some Memo Text';

    const note = TransactNote.create(
      wallet2.addressKeys,
      wallet.addressKeys,
      random,
      100n,
      token,
      wallet.getViewingKeyPair(),
      false, // showSenderAddress
      noteAnnotationData.outputType,
      memoText,
    );
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore - required to set senderRandom outside this function
    note.annotationData = Memo.createEncryptedNoteAnnotationData(
      noteAnnotationData.outputType,
      senderRandom,
      wallet.getViewingKeyPair().privateKey,
    );

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

    const { noteCiphertext, noteMemo } = note.encrypt(
      senderShared,
      wallet.addressKeys.masterPublicKey,
      senderRandom,
    );

    // Make sure masterPublicKey is raw (unencoded) as encodedMasterPublicKey.
    const ciphertextDataWithMemoText = [...noteCiphertext.data, noteMemo];
    const fullCiphertext: Ciphertext = {
      ...noteCiphertext,
      data: ciphertextDataWithMemoText,
    };
    const decryptedValues = aes.gcm
      .decrypt(fullCiphertext, senderShared)
      .map((value) => hexlify(value));
    const encodedMasterPublicKey = hexToBigInt(decryptedValues[0]);
    expect(note.receiverAddressData.masterPublicKey).to.equal(encodedMasterPublicKey);

    const senderDecrypted = TransactNote.decrypt(
      wallet.addressKeys,
      noteCiphertext,
      senderShared,
      noteMemo,
      note.annotationData,
      blindingKeys.blindedReceiverViewingKey,
      blindingKeys.blindedSenderViewingKey,
      senderRandom,
      true, // isSentNote
      false, // isLegacyDecryption
    );
    expect(senderDecrypted.hash).to.equal(note.hash);
    expect(senderDecrypted.senderAddressData).to.deep.equal(wallet.addressKeys);
    expect(senderDecrypted.receiverAddressData).to.deep.equal(wallet2.addressKeys);
    expect(
      Memo.decryptNoteAnnotationData(senderDecrypted.annotationData, sender.privateKey),
    ).to.deep.equal(noteAnnotationData);
    expect(senderDecrypted.memoText).to.equal(memoText);

    const receiverDecrypted = TransactNote.decrypt(
      wallet2.addressKeys,
      noteCiphertext,
      receiverShared,
      noteMemo,
      note.annotationData,
      blindingKeys.blindedReceiverViewingKey,
      blindingKeys.blindedSenderViewingKey,
      undefined, // senderRandom
      false, // isSentNote
      false, // isLegacyDecryption
    );
    expect(receiverDecrypted.hash).to.equal(note.hash);
    expect(receiverDecrypted.senderAddressData).to.equal(undefined);
    expect(receiverDecrypted.receiverAddressData).to.deep.equal(wallet2.addressKeys);
    expect(receiverDecrypted.memoText).to.equal(memoText);
  });

  it('Should generate ciphertext decryptable by sender and recipient - no memo', async () => {
    const wallet2 = await RailgunWallet.fromMnemonic(
      db,
      testEncryptionKey,
      testMnemonic,
      1,
      undefined, // creationBlockNumbers
    );

    const sender = wallet.getViewingKeyPair();
    const receiver = wallet2.getViewingKeyPair();

    const senderRandom = randomHex(15);
    const noteAnnotationData: NoteAnnotationData = {
      outputType: OutputType.RelayerFee,
      senderRandom,
      walletSource: 'erc20 wallet',
    };

    const memoText = undefined;

    const note = TransactNote.create(
      wallet2.addressKeys,
      wallet.addressKeys,
      random,
      100n,
      token,
      wallet.getViewingKeyPair(),
      false, // showSenderAddress
      noteAnnotationData.outputType,
      memoText,
    );
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore - required to set senderRandom outside this function
    note.annotationData = Memo.createEncryptedNoteAnnotationData(
      noteAnnotationData.outputType,
      senderRandom,
      wallet.getViewingKeyPair().privateKey,
    );

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

    const { noteCiphertext, noteMemo } = note.encrypt(
      senderShared,
      address.masterPublicKey,
      senderRandom,
    );

    // Make sure masterPublicKey is raw (unencoded) as encodedMasterPublicKey.
    const ciphertextDataWithMemoText = [...noteCiphertext.data, noteMemo];
    const fullCiphertext: Ciphertext = {
      ...noteCiphertext,
      data: ciphertextDataWithMemoText,
    };
    const decryptedValues = aes.gcm
      .decrypt(fullCiphertext, senderShared)
      .map((value) => hexlify(value));
    const encodedMasterPublicKey = hexToBigInt(decryptedValues[0]);
    expect(note.receiverAddressData.masterPublicKey).to.equal(encodedMasterPublicKey);

    const senderDecrypted = TransactNote.decrypt(
      wallet.addressKeys,
      noteCiphertext,
      senderShared,
      noteMemo,
      note.annotationData,
      blindingKeys.blindedReceiverViewingKey,
      blindingKeys.blindedSenderViewingKey,
      senderRandom,
      true, // isSentNote
      false, // isLegacyDecryption
    );
    expect(senderDecrypted.hash).to.equal(note.hash);
    expect(senderDecrypted.senderAddressData).to.deep.equal(wallet.addressKeys);
    expect(senderDecrypted.receiverAddressData).to.deep.equal(wallet2.addressKeys);
    expect(
      Memo.decryptNoteAnnotationData(senderDecrypted.annotationData, sender.privateKey),
    ).to.deep.equal(noteAnnotationData);
    expect(senderDecrypted.memoText).to.equal(memoText);

    const receiverDecrypted = TransactNote.decrypt(
      wallet2.addressKeys,
      noteCiphertext,
      receiverShared,
      noteMemo,
      note.annotationData,
      blindingKeys.blindedReceiverViewingKey,
      blindingKeys.blindedSenderViewingKey,
      undefined, // senderRandom
      false, // isSentNote
      false, // isLegacyDecryption
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
    );

    const sender = wallet.getViewingKeyPair();
    const receiver = wallet2.getViewingKeyPair();

    const senderRandom = MEMO_SENDER_RANDOM_NULL;
    const noteAnnotationData: NoteAnnotationData = {
      outputType: OutputType.RelayerFee,
      senderRandom: MEMO_SENDER_RANDOM_NULL,
      walletSource: 'erc20 wallet',
    };

    const memoText = undefined;

    const note = TransactNote.create(
      wallet2.addressKeys,
      wallet.addressKeys,
      random,
      100n,
      token,
      wallet.getViewingKeyPair(),
      true, // showSenderAddress
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

    const { noteCiphertext, noteMemo } = note.encrypt(
      senderShared,
      address.masterPublicKey,
      senderRandom,
    );

    // Make sure masterPublicKey is encoded as encodedMasterPublicKey.
    const ciphertextDataWithMemoText = [...noteCiphertext.data, noteMemo];
    const fullCiphertext: Ciphertext = {
      ...noteCiphertext,
      data: ciphertextDataWithMemoText,
    };
    const decryptedValues = aes.gcm
      .decrypt(fullCiphertext, senderShared)
      .map((value) => hexlify(value));
    const encodedMasterPublicKey = hexToBigInt(decryptedValues[0]);
    expect(note.receiverAddressData.masterPublicKey).to.not.equal(encodedMasterPublicKey);

    const senderDecrypted = TransactNote.decrypt(
      wallet.addressKeys,
      noteCiphertext,
      senderShared,
      noteMemo,
      note.annotationData,
      blindingKeys.blindedReceiverViewingKey,
      blindingKeys.blindedSenderViewingKey,
      senderRandom,
      true, // isSentNote
      false, // isLegacyDecryption
    );
    expect(senderDecrypted.hash).to.equal(note.hash);
    expect(senderDecrypted.senderAddressData).to.deep.equal(wallet.addressKeys);
    expect(senderDecrypted.receiverAddressData).to.deep.equal(wallet2.addressKeys);
    expect(
      Memo.decryptNoteAnnotationData(senderDecrypted.annotationData, sender.privateKey),
    ).to.deep.equal(noteAnnotationData);
    expect(senderDecrypted.memoText).to.equal(memoText);

    const receiverDecrypted = TransactNote.decrypt(
      wallet2.addressKeys,
      noteCiphertext,
      receiverShared,
      noteMemo,
      note.annotationData,
      blindingKeys.blindedReceiverViewingKey,
      blindingKeys.blindedSenderViewingKey,
      undefined, // senderRandom
      false, // isSentNote
      false, // isLegacyDecryption
    );
    expect(receiverDecrypted.hash).to.equal(note.hash);
    expect(receiverDecrypted.senderAddressData).to.deep.equal(wallet.addressKeys);
    expect(receiverDecrypted.receiverAddressData).to.deep.equal(wallet2.addressKeys);
    expect(receiverDecrypted.memoText).to.equal(memoText);
  });

  it('Should generate a valid signature for transaction', async () => {
    transactionBatch.addOutput(await makeNote());
    const spendingSolutionGroups = await transactionBatch.generateValidSpendingSolutionGroups(
      wallet,
    );
    expect(spendingSolutionGroups.length).to.equal(1);

    const transaction = transactionBatch.generateTransactionForSpendingSolutionGroup(
      spendingSolutionGroups[0],
    );
    const { inputs, publicInputs } = await transaction.generateProverInputs(
      wallet,
      testEncryptionKey,
    );
    const { signature } = inputs;
    const { privateKey, pubkey } = await wallet.getSpendingKeyPair(testEncryptionKey);
    const msg: bigint = poseidon(Object.values(publicInputs).flatMap((x) => x));
    const sig: Signature = { R8: [signature[0], signature[1]], S: signature[2] };

    assert.isTrue(verifyEDDSA(msg, sig, pubkey));

    expect(sig).to.deep.equal(signEDDSA(privateKey, msg));
  });

  it('Should generate validated inputs for transaction batch', async () => {
    transactionBatch.addOutput(await makeNote());
    const spendingSolutionGroups = await transactionBatch.generateValidSpendingSolutionGroups(
      wallet,
    );
    expect(spendingSolutionGroups.length).to.equal(1);

    const transaction = transactionBatch.generateTransactionForSpendingSolutionGroup(
      spendingSolutionGroups[0],
    );
    const { publicInputs } = await transaction.generateProverInputs(wallet, testEncryptionKey);
    const { nullifiers, commitmentsOut } = publicInputs;
    expect(nullifiers.length).to.equal(1);
    expect(commitmentsOut.length).to.equal(2);

    transactionBatch.addOutput(await makeNote());
    transactionBatch.addOutput(await makeNote());
    await expect(
      transactionBatch.generateTransactions(prover, wallet, testEncryptionKey, () => {}),
    ).to.eventually.be.rejectedWith('Too many transaction outputs');

    transactionBatch.resetOutputs();
    transactionBatch.addOutput(
      TransactNote.create(
        address,
        undefined,
        random,
        6500000000000n,
        '000925cdf66ddf5b88016df1fe915e68eff8f192',
        wallet.getViewingKeyPair(),
        false, // showSenderAddress
        OutputType.RelayerFee,
        undefined, // memoText
      ),
    );

    await expect(
      transactionBatch.generateValidSpendingSolutionGroups(wallet),
    ).to.eventually.be.rejectedWith('Token address mismatch on output 0');

    transactionBatch.resetOutputs();
    transactionBatch.addOutput(await makeNote(21000000000027360000000000n));
    await expect(
      transactionBatch.generateValidSpendingSolutionGroups(wallet),
    ).to.eventually.be.rejectedWith('Wallet balance too low');

    transactionBatch.resetOutputs();
    transactionBatch.addOutput(await makeNote(11000000000027360000000000n));
    await expect(
      transactionBatch.generateValidSpendingSolutionGroups(wallet),
    ).to.eventually.be.rejectedWith('Wallet balance too low');

    const transaction2 = new TransactionBatch('ff', TokenType.ERC20, chain);

    transaction2.setUnshield(ethersWallet.address, 12n);

    await expect(
      transaction2.generateValidSpendingSolutionGroups(wallet),
    ).to.eventually.be.rejectedWith(
      `No wallet balance for token: 0x00000000000000000000000000000000000000ff`,
    );
  });

  it('Should generate validated inputs for transaction batch - unshield', async () => {
    transactionBatch.addOutput(await makeNote());
    transactionBatch.setUnshield(ethersWallet.address, 2n, true);
    const spendingSolutionGroups = await transactionBatch.generateValidSpendingSolutionGroups(
      wallet,
    );
    expect(spendingSolutionGroups.length).to.equal(1);

    const transaction = transactionBatch.generateTransactionForSpendingSolutionGroup(
      spendingSolutionGroups[0],
    );
    const { publicInputs } = await transaction.generateProverInputs(
      wallet,
      testEncryptionKey,
      0n, // overallBatchMinGasPrice
    );
    const { nullifiers, commitmentsOut } = publicInputs;
    expect(nullifiers.length).to.equal(1);
    expect(commitmentsOut.length).to.equal(3);
  });

  it('Should create transaction proofs and serialized transactions', async () => {
    transactionBatch.addOutput(await makeNote(1n));
    const txs = await transactionBatch.generateTransactions(
      prover,
      wallet,
      testEncryptionKey,
      () => {},
    );
    expect(txs.length).to.equal(1);
    expect(txs[0].nullifiers.length).to.equal(1);
    expect(txs[0].commitments.length).to.equal(2);

    transactionBatch.resetOutputs();
    transactionBatch.addOutput(await makeNote(1715000000000n));

    const txs2 = await transactionBatch.generateTransactions(
      prover,
      wallet,
      testEncryptionKey,
      () => {},
    );
    expect(txs2.length).to.equal(1);
    expect(txs2[0].nullifiers.length).to.equal(1);
  });

  it('Should test transaction proof progress callback final value', async () => {
    transactionBatch.addOutput(await makeNote(1n));
    let loadProgress = 0;
    await transactionBatch.generateTransactions(prover, wallet, testEncryptionKey, (progress) => {
      loadProgress = progress;
    });
    expect(loadProgress).to.equal(100);
  });

  it('Should create dummy transaction proofs', async () => {
    transactionBatch.addOutput(await makeNote());
    const txs = await transactionBatch.generateDummyTransactions(prover, wallet, testEncryptionKey);
    expect(txs.length).to.equal(1);
    expect(txs[0].nullifiers.length).to.equal(1);
    expect(txs[0].commitments.length).to.equal(2);
  });

  // it('Generator', async () => {
  //   const dblocal = new Database(memdown());
  //   const merkletreelocal = new MerkleTree(dblocal, 1, 'erc20', async () => true);
  //   const walletlocal = await Wallet.fromMnemonic(dblocal, testEncryptionKey, testMnemonic);
  //   const proverlocal = new Prover(artifactsGetter);

  //   const note = TransactNote.create(
  //     '0xc95956104f69131b1c269c30688d3afedd0c3a155d270e862ea4c1f89a603a1b',
  //     '0x1e686e7506b0f4f21d6991b4cb58d39e77c31ed0577a986750c8dce8804af5b9',
  //     new BN('11000000000000000000000000', 10),
  //     '5FbDB2315678afecb367f032d93F642f64180aa3',
  //   );

  //   walletlocal.loadTree(merkletreelocal);

  //   const encryptionKey = babyjubjub.ecdh(
  //     '0852ea0ca28847f125cf5c206d8f62d4dc59202477dce90988dc57d5e9b2f144',
  //     '0xc95956104f69131b1c269c30688d3afedd0c3a155d270e862ea4c1f89a603a1b',
  //   );

  //   await merkletreelocal.queueLeaves(0, 0, [
  //     {
  //       hash: note.hash,
  //       txid: '0x1097c636f99f179de275635277e458820485039b0a37088a5d657b999f73b59b',
  //       senderPubKey: '0xc95956104f69131b1c269c30688d3afedd0c3a155d270e862ea4c1f89a603a1b',
  //       ciphertext: note.encrypt(encryptionKey),
  //     },
  //   ]);
  //   await walletlocal.scan(1);

  //   const transactionlocal = new ERC20Transaction('5FbDB2315678afecb367f032d93F642f64180aa3', 1);

  //   transactionlocal.outputs = [
  //     TransactNote.create(
  //       '0xc95956104f69131b1c269c30688d3afedd0c3a155d270e862ea4c1f89a603a1b',
  //       '0x1bcfa32dbb44dc6a26712bc500b6373885b08a7cd73ee433072f1d410aeb4801',
  //       'ffff',
  //       '5FbDB2315678afecb367f032d93F642f64180aa3',
  //     ),
  //   ];

  //   const tx = await transactionlocal.prove(proverlocal, walletlocal, testEncryptionKey);

  //   console.log(JSON.stringify(tx, null, '  '));
  // });

  this.afterAll(() => {
    // Clean up database
    wallet.unloadERC20Merkletree(merkletree.chain);
    db.close();
  });
});
