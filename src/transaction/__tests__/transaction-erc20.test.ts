import { poseidon } from 'circomlibjs';
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
} from '../../models/formatted-types';
import { Chain, ChainType } from '../../models/engine-types';
import { Memo } from '../../note/memo';
import { ByteLength, formatToByteLength, hexlify, hexToBigInt, randomHex } from '../../utils/bytes';
import {
  getNoteBlindingKeys,
  getSharedSymmetricKey,
  signEDDSA,
  verifyEDDSA,
} from '../../utils/keys-utils';
import { DECIMALS_18, getEthersWallet, testArtifactsGetter } from '../../test/helper.test';
import { Database } from '../../database/database';
import { AddressData } from '../../key-derivation/bech32';
import { TransactNote } from '../../note/transact-note';
import { Prover, SnarkJSGroth16 } from '../../prover/prover';
import { RailgunWallet } from '../../wallet/railgun-wallet';
import { config } from '../../test/config.test';
import { hashBoundParams } from '../bound-params';
import { MEMO_SENDER_RANDOM_NULL, TXIDVersion } from '../../models';
import WalletInfo from '../../wallet/wallet-info';
import { TransactionBatch } from '../transaction-batch';
import { getTokenDataERC20 } from '../../note/note-util';
import { TokenDataGetter } from '../../token/token-data-getter';
import { ContractStore } from '../../contracts/contract-store';
import { RailgunSmartWalletContract } from '../../contracts/railgun-smart-wallet/railgun-smart-wallet';
import { BoundParamsStruct } from '../../abi/typechain/RailgunSmartWallet';
import { PollingJsonRpcProvider } from '../../provider/polling-json-rpc-provider';
import { UTXOMerkletree } from '../../merkletree/utxo-merkletree';
import { AES } from '../../utils';

chai.use(chaiAsPromised);
const { expect } = chai;

const txidVersion = TXIDVersion.V2_PoseidonMerkle;

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
    wallet.loadUTXOMerkletree(txidVersion, utxoMerkletree);

    // Load fake contract
    ContractStore.railgunSmartWalletContracts[chain.type] = [];
    ContractStore.railgunSmartWalletContracts[chain.type][chain.id] =
      new RailgunSmartWalletContract(
        config.contracts.proxy,
        new PollingJsonRpcProvider('abc', 1, 500),
        new PollingJsonRpcProvider('abc', 1, 500),
        chain,
      );

    tokenDataGetter = new TokenDataGetter(db, chain);

    makeNote = async (
      value: bigint = 65n * DECIMALS_18,
      outputType: OutputType = OutputType.Transfer,
    ): Promise<TransactNote> => {
      return TransactNote.createTransfer(
        address,
        undefined,
        value,
        tokenData,
        wallet.getViewingKeyPair(),
        false, // showSenderAddressToRecipient
        outputType,
        undefined, // memoText
      );
    };
    utxoMerkletree.merklerootValidator = () => Promise.resolve(true);
    await utxoMerkletree.queueLeaves(0, 0, [shieldLeaf]); // start with a shield
    await utxoMerkletree.updateTreesFromWriteQueue();

    let scanProgress = 0;
    await wallet.scanBalances(txidVersion, chain, (progress: number) => {
      scanProgress = progress;
    });
    expect(scanProgress).to.equal(1);
  });

  beforeEach(async () => {
    transactionBatch = new TransactionBatch(chain);
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
      minGasPrice: BigInt(3000),
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
      new Prover(testArtifactsGetter),
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

    const blockNumber = 5;

    const note = TransactNote.createTransfer(
      wallet2.addressKeys,
      wallet.addressKeys,
      100n,
      tokenData,
      wallet.getViewingKeyPair(),
      false, // showSenderAddressToRecipient
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
    const decryptedValues = AES.decryptGCM(fullCiphertext, senderShared).map((value) =>
      hexlify(value),
    );
    const encodedMasterPublicKey = hexToBigInt(decryptedValues[0]);
    expect(note.receiverAddressData.masterPublicKey).to.equal(encodedMasterPublicKey);

    const senderDecrypted = await TransactNote.decrypt(
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
      tokenDataGetter,
      blockNumber,
    );
    expect(senderDecrypted.hash).to.equal(note.hash);
    expect(senderDecrypted.senderAddressData).to.deep.equal(wallet.addressKeys);
    expect(senderDecrypted.receiverAddressData).to.deep.equal(wallet2.addressKeys);
    expect(
      Memo.decryptNoteAnnotationData(senderDecrypted.annotationData, sender.privateKey),
    ).to.deep.equal(noteAnnotationData);
    expect(senderDecrypted.memoText).to.equal(memoText);
    expect(senderDecrypted.blockNumber).to.equal(blockNumber);

    const receiverDecrypted = await TransactNote.decrypt(
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
      tokenDataGetter,
      blockNumber,
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

    const senderRandom = randomHex(15);
    const noteAnnotationData: NoteAnnotationData = {
      outputType: OutputType.RelayerFee,
      senderRandom,
      walletSource: 'erc20 wallet',
    };

    const memoText = undefined;

    const note = TransactNote.createTransfer(
      wallet2.addressKeys,
      wallet.addressKeys,
      100n,
      tokenData,
      wallet.getViewingKeyPair(),
      false, // showSenderAddressToRecipient
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
    const decryptedValues = AES.decryptGCM(fullCiphertext, senderShared).map((value) =>
      hexlify(value),
    );
    const encodedMasterPublicKey = hexToBigInt(decryptedValues[0]);
    expect(note.receiverAddressData.masterPublicKey).to.equal(encodedMasterPublicKey);

    const senderDecrypted = await TransactNote.decrypt(
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
      tokenDataGetter,
      100, // blockNumber
    );
    expect(senderDecrypted.hash).to.equal(note.hash);
    expect(senderDecrypted.senderAddressData).to.deep.equal(wallet.addressKeys);
    expect(senderDecrypted.receiverAddressData).to.deep.equal(wallet2.addressKeys);
    expect(
      Memo.decryptNoteAnnotationData(senderDecrypted.annotationData, sender.privateKey),
    ).to.deep.equal(noteAnnotationData);
    expect(senderDecrypted.memoText).to.equal(memoText);

    const receiverDecrypted = await TransactNote.decrypt(
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
      tokenDataGetter,
      100, // blockNumber
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
      outputType: OutputType.RelayerFee,
      senderRandom: MEMO_SENDER_RANDOM_NULL,
      walletSource: 'erc20 wallet',
    };

    const memoText = undefined;

    const note = TransactNote.createTransfer(
      wallet2.addressKeys,
      wallet.addressKeys,
      100n,
      tokenData,
      wallet.getViewingKeyPair(),
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
    const decryptedValues = AES.decryptGCM(fullCiphertext, senderShared).map((value) =>
      hexlify(value),
    );
    const encodedMasterPublicKey = hexToBigInt(decryptedValues[0]);
    expect(note.receiverAddressData.masterPublicKey).to.not.equal(encodedMasterPublicKey);

    const senderDecrypted = await TransactNote.decrypt(
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
      tokenDataGetter,
      100, // blockNumber
    );
    expect(senderDecrypted.hash).to.equal(note.hash);
    expect(senderDecrypted.senderAddressData).to.deep.equal(wallet.addressKeys);
    expect(senderDecrypted.receiverAddressData).to.deep.equal(wallet2.addressKeys);
    expect(
      Memo.decryptNoteAnnotationData(senderDecrypted.annotationData, sender.privateKey),
    ).to.deep.equal(noteAnnotationData);
    expect(senderDecrypted.memoText).to.equal(memoText);

    const receiverDecrypted = await TransactNote.decrypt(
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
      tokenDataGetter,
      100, // blockNumber
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
    );
    const { publicInputs } = await transaction.generateTransactionRequest(
      wallet,
      txidVersion,
      testEncryptionKey,
    );
    const signature = await wallet.sign(publicInputs, testEncryptionKey);
    const { privateKey, pubkey } = await wallet.getSpendingKeyPair(testEncryptionKey);
    const msg: bigint = poseidon(Object.values(publicInputs).flatMap((x) => x));

    assert.isTrue(verifyEDDSA(msg, signature, pubkey));

    expect(signature).to.deep.equal(signEDDSA(privateKey, msg));
  });

  it('Should generate validated inputs for transaction batch', async () => {
    transactionBatch.addOutput(await makeNote());
    const spendingSolutionGroups =
      await transactionBatch.generateValidSpendingSolutionGroupsAllOutputs(wallet, txidVersion);
    expect(spendingSolutionGroups.length).to.equal(1);

    const transaction = transactionBatch.generateTransactionForSpendingSolutionGroup(
      spendingSolutionGroups[0],
    );
    const { publicInputs } = await transaction.generateTransactionRequest(
      wallet,
      txidVersion,
      testEncryptionKey,
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
      ),
    ).to.eventually.be.rejectedWith('Can not add more than 4 outputs.');

    transactionBatch.resetOutputs();
    transactionBatch.addOutput(
      TransactNote.createTransfer(
        address,
        undefined,
        6500000000000n,
        getTokenDataERC20('000925cdf66ddf5b88016df1fe915e68eff8f192'),
        wallet.getViewingKeyPair(),
        false, // showSenderAddressToRecipient
        OutputType.RelayerFee,
        undefined, // memoText
      ),
    );

    await expect(
      transactionBatch.generateValidSpendingSolutionGroupsAllOutputs(wallet, txidVersion),
    ).to.eventually.be.rejectedWith(
      'RAILGUN private token balance too low for 0x000925cdf66ddf5b88016df1fe915e68eff8f192',
    );

    transactionBatch.resetOutputs();
    transactionBatch.addOutput(await makeNote(21000000000027360000000000n));
    await expect(
      transactionBatch.generateValidSpendingSolutionGroupsAllOutputs(wallet, txidVersion),
    ).to.eventually.be.rejectedWith(
      'RAILGUN private token balance too low for 0x5fbdb2315678afecb367f032d93f642f64180aa3',
    );

    transactionBatch.resetOutputs();
    transactionBatch.addOutput(await makeNote(11000000000027360000000000n));
    await expect(
      transactionBatch.generateValidSpendingSolutionGroupsAllOutputs(wallet, txidVersion),
    ).to.eventually.be.rejectedWith(
      'RAILGUN private token balance too low for 0x5fbdb2315678afecb367f032d93f642f64180aa3',
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
      'RAILGUN private token balance too low for 0x00000000000000000000000000000000000000ff',
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
    );
    const { publicInputs } = await transaction.generateTransactionRequest(
      wallet,
      txidVersion,
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
      txidVersion,
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
      txidVersion,
      testEncryptionKey,
      () => {},
    );
    expect(txs2.length).to.equal(1);
    expect(txs2[0].nullifiers.length).to.equal(1);
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

  this.afterAll(async () => {
    // Clean up database
    wallet.unloadUTXOMerkletree(txidVersion, utxoMerkletree.chain);
    await db.close();
  });
});
