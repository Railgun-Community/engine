import { RailgunWallet } from '../wallet/railgun-wallet';
import { Prover, ProverProgressCallback } from '../prover/prover';
import {
  ByteLength,
  formatToByteLength,
  hexlify,
  hexToBigInt,
  nToHex,
  randomHex,
} from '../utils/bytes';
import { AdaptID, OutputType, TokenType } from '../models/formatted-types';
import {
  DEFAULT_TOKEN_SUB_ID,
  MEMO_SENDER_RANDOM_NULL,
  UnshieldFlag,
} from '../models/transaction-constants';
import { getNoteBlindingKeys, getSharedSymmetricKey } from '../utils/keys-utils';
import { UnshieldNote } from '../note/unshield-note';
import { TXO } from '../models/txo-types';
import { Memo } from '../note/memo';
import { Chain } from '../models/engine-types';
import { TransactNote } from '../note/transact-note';
import { PrivateInputs, Proof, PublicInputs } from '../models/prover-types';
import {
  BoundParamsStruct,
  CommitmentCiphertextStruct,
  CommitmentPreimageStruct,
  TransactionStruct,
} from '../typechain-types/contracts/logic/RailgunSmartWallet';
import { hashBoundParams } from './bound-params';

class Transaction {
  private adaptID: AdaptID;

  private chain: Chain;

  private tokenAddress: string;

  private outputs: TransactNote[] = [];

  private unshieldNote: UnshieldNote = UnshieldNote.empty();

  private unshieldFlag: bigint = UnshieldFlag.NO_UNSHIELD;

  private tokenType: TokenType;

  private tokenSubID: bigint;

  private spendingTree: number;

  private utxos: TXO[];

  /**
   * Create ERC20Transaction Object
   * @param tokenAddress - token address, unformatted
   * @param tokenType - enum of token type
   * @param chain - chain type/id of network
   * @param spendingTree - tree index to spend from
   * @param utxos - UTXOs to spend from
   */
  constructor(
    tokenAddress: string,
    tokenType: TokenType,
    chain: Chain,
    spendingTree: number,
    utxos: TXO[],
    adaptID: AdaptID,
    tokenSubID: bigint = DEFAULT_TOKEN_SUB_ID,
  ) {
    this.tokenAddress = formatToByteLength(tokenAddress, ByteLength.UINT_256);
    this.tokenType = tokenType;
    this.chain = chain;
    this.spendingTree = spendingTree;
    this.utxos = utxos;
    this.adaptID = adaptID;
    this.tokenSubID = tokenSubID;
  }

  setOutputs(outputs: TransactNote[]) {
    if (this.outputs.length > 2) {
      throw new Error('Can not add more than 2 outputs.');
    }
    this.outputs = outputs;
  }

  unshield(unshieldAddress: string, value: bigint, allowOverride?: boolean) {
    if (this.unshieldFlag !== UnshieldFlag.NO_UNSHIELD) {
      throw new Error('You may only call .unshield once for a given transaction.');
    }

    this.unshieldNote = new UnshieldNote(unshieldAddress, value, this.tokenAddress, this.tokenType);
    this.unshieldFlag = allowOverride ? UnshieldFlag.OVERRIDE : UnshieldFlag.UNSHIELD;
  }

  get unshieldValue() {
    return this.unshieldNote ? this.unshieldNote.value : BigInt(0);
  }

  /**
   * @param wallet - wallet to spend from
   * @param encryptionKey - encryption key of wallet
   */
  async generateProverInputs(
    wallet: RailgunWallet,
    encryptionKey: string,
    overallBatchMinGasPrice = 0n,
  ): Promise<{
    inputs: PrivateInputs;
    publicInputs: PublicInputs;
    boundParams: BoundParamsStruct;
  }> {
    const merkletree = wallet.erc20Merkletrees[this.chain.type][this.chain.id];
    const merkleRoot = await merkletree.getRoot(this.spendingTree); // TODO: Is this correct tree?
    const spendingKey = await wallet.getSpendingKeyPair(encryptionKey);
    const nullifyingKey = wallet.getNullifyingKey();
    const senderViewingKeys = wallet.getViewingKeyPair();

    // Check if there's too many outputs
    if (this.outputs.length > 2) throw new Error('Too many transaction outputs');

    // Get values
    const nullifiers: bigint[] = [];
    const pathElements: bigint[][] = [];
    const pathIndices: bigint[] = [];

    const { utxos } = this;

    for (let i = 0; i < utxos.length; i += 1) {
      // Get UTXO
      const utxo = utxos[i];

      // Push spending key and nullifier
      nullifiers.push(TransactNote.getNullifier(nullifyingKey, utxo.position));

      // Push path elements
      // eslint-disable-next-line no-await-in-loop
      const merkleProof = await merkletree.getMerkleProof(this.spendingTree, utxo.position);
      pathElements.push(merkleProof.elements.map((element) => hexToBigInt(element)));

      // Push path indicies
      pathIndices.push(BigInt(utxo.position));
    }

    // Calculate change amount
    const totalIn = utxos.reduce((left, right) => left + right.note.value, BigInt(0));

    const totalOut =
      this.outputs.reduce((left, right) => left + right.value, BigInt(0)) + this.unshieldValue;

    const change = totalIn - totalOut;
    if (change < 0) {
      throw new Error('Negative change value - transaction not possible.');
    }

    const allOutputs: (TransactNote | UnshieldNote)[] = [...this.outputs];

    // Create change output
    const changeSenderRandom = MEMO_SENDER_RANDOM_NULL; // Not needed for change output.
    allOutputs.push(
      TransactNote.create(
        wallet.addressKeys, // Receiver
        wallet.addressKeys, // Sender
        randomHex(16),
        change,
        this.tokenAddress,
        senderViewingKeys,
        changeSenderRandom,
        OutputType.Change,
        undefined, // memoText
      ),
    );

    // Push unshield output if unshield is requested
    if (this.unshieldFlag !== UnshieldFlag.NO_UNSHIELD && this.unshieldNote) {
      allOutputs.push(this.unshieldNote);
    }

    const onlyInternalOutputs = allOutputs.filter(
      (note) => note instanceof TransactNote,
    ) as TransactNote[];

    const viewingPrivateKey = wallet.getViewingKeyPair().privateKey;

    const noteBlindedKeys = await Promise.all(
      onlyInternalOutputs.map((note) => {
        const senderRandom = Memo.decryptSenderRandom(note.annotationData, viewingPrivateKey);
        return getNoteBlindingKeys(
          senderViewingKeys.pubkey,
          note.receiverAddressData.viewingPublicKey,
          note.random,
          senderRandom,
        );
      }),
    );

    // Calculate shared keys using sender privateKey and recipient blinding key.
    const sharedKeys = await Promise.all(
      noteBlindedKeys.map(({ blindedReceiverViewingKey }) =>
        getSharedSymmetricKey(senderViewingKeys.privateKey, blindedReceiverViewingKey),
      ),
    );

    const commitmentCiphertext: CommitmentCiphertextStruct[] = onlyInternalOutputs.map(
      (note, index) => {
        const sharedKey = sharedKeys[index];
        if (!sharedKey) {
          throw new Error('Shared symmetric key is not defined.');
        }

        const senderRandom = Memo.decryptSenderRandom(note.annotationData, viewingPrivateKey);
        const { noteCiphertext, noteMemo } = note.encrypt(
          sharedKey,
          wallet.addressKeys.masterPublicKey,
          senderRandom,
        );
        if (noteCiphertext.data.length !== 3) {
          throw new Error('Note ciphertext data must have length 3.');
        }
        const ciphertext: [string, string, string, string] = [
          hexlify(`${noteCiphertext.iv}${noteCiphertext.tag}`, true),
          hexlify(noteCiphertext.data[0], true),
          hexlify(noteCiphertext.data[1], true),
          hexlify(noteCiphertext.data[2], true),
        ];
        return {
          ciphertext,
          blindedSenderViewingKey: hexlify(noteBlindedKeys[index].blindedSenderViewingKey, true),
          blindedReceiverViewingKey: hexlify(
            noteBlindedKeys[index].blindedReceiverViewingKey,
            true,
          ),
          memo: hexlify(noteMemo, true),
          annotationData: hexlify(note.annotationData, true),
        };
      },
    );

    const boundParams: BoundParamsStruct = {
      treeNumber: this.spendingTree,
      minGasPrice: overallBatchMinGasPrice,
      unshield: this.unshieldFlag,
      chainID: this.chain.id,
      adaptContract: this.adaptID.contract,
      adaptParams: this.adaptID.parameters,
      commitmentCiphertext,
    };

    const commitmentsOut = allOutputs.map((note) => note.hash);

    const publicInputs: PublicInputs = {
      merkleRoot: hexToBigInt(merkleRoot),
      boundParamsHash: hashBoundParams(boundParams),
      nullifiers,
      commitmentsOut,
    };

    const signature = TransactNote.sign(publicInputs, spendingKey.privateKey);

    // Format inputs
    const inputs: PrivateInputs = {
      tokenAddress: hexToBigInt(this.tokenAddress),
      randomIn: utxos.map((utxo) => hexToBigInt(utxo.note.random)),
      valueIn: utxos.map((utxo) => utxo.note.value),
      pathElements,
      leavesIndices: pathIndices,
      valueOut: allOutputs.map((note) => note.value),
      publicKey: spendingKey.pubkey,
      npkOut: allOutputs.map((x) => x.notePublicKey),
      nullifyingKey,
      signature: [...signature.R8, signature.S],
    };

    return {
      inputs,
      publicInputs,
      boundParams,
    };
  }

  /**
   * Generate proof and return serialized transaction
   * @param prover - prover to use
   * @param wallet - wallet to spend from
   * @param encryptionKey - encryption key for wallet
   * @returns serialized transaction
   */
  async prove(
    prover: Prover,
    wallet: RailgunWallet,
    encryptionKey: string,
    overallBatchMinGasPrice: bigint,
    progressCallback: ProverProgressCallback,
  ): Promise<TransactionStruct> {
    // Get inputs
    const { inputs, publicInputs, boundParams } = await this.generateProverInputs(
      wallet,
      encryptionKey,
      overallBatchMinGasPrice,
    );

    // Calculate proof
    const { proof } = await prover.prove(publicInputs, inputs, progressCallback);

    return Transaction.generateTransaction(
      proof,
      publicInputs,
      boundParams,
      this.unshieldNote.preImage,
    );
  }

  /**
   * Return serialized transaction with zero'd proof for gas estimates.
   * @param wallet - wallet to spend from
   * @param encryptionKey - encryption key for wallet
   * @returns serialized transaction
   */
  async dummyProve(
    prover: Prover,
    wallet: RailgunWallet,
    encryptionKey: string,
    overallBatchMinGasPrice: bigint,
  ): Promise<TransactionStruct> {
    // Get inputs
    const { publicInputs, boundParams } = await this.generateProverInputs(
      wallet,
      encryptionKey,
      overallBatchMinGasPrice,
    );

    const dummyProof: Proof = await prover.dummyProve(publicInputs);

    return Transaction.generateTransaction(
      dummyProof,
      publicInputs,
      boundParams,
      this.unshieldNote.preImage,
    );
  }

  static generateTransaction(
    proof: Proof,
    publicInputs: PublicInputs,
    boundParams: BoundParamsStruct,
    unshieldPreimage: CommitmentPreimageStruct,
  ): TransactionStruct {
    const formatted = Prover.formatProof(proof);
    return {
      proof: formatted,
      merkleRoot: nToHex(publicInputs.merkleRoot, ByteLength.UINT_256),
      nullifiers: publicInputs.nullifiers.map((n) => nToHex(n, ByteLength.UINT_256)),
      boundParams,
      commitments: publicInputs.commitmentsOut.map((n) => nToHex(n, ByteLength.UINT_256)),
      unshieldPreimage,
    };
  }
}

export { Transaction };
