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
import { AdaptID, NFTTokenData, OutputType, TokenData, TokenType } from '../models/formatted-types';
import { UnshieldFlag } from '../models/transaction-constants';
import { getNoteBlindingKeys, getSharedSymmetricKey } from '../utils/keys-utils';
import { UnshieldNote } from '../note/unshield-note';
import { TXO, UnshieldData } from '../models/txo-types';
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
import { getChainFullNetworkID } from '../chain/chain';
import { UnshieldNoteERC20 } from '../note/erc20/unshield-note-erc20';
import { UnshieldNoteNFT } from '../note/nft/unshield-note-nft';
import { getTokenDataHash } from '../note';

class Transaction {
  private readonly adaptID: AdaptID;

  private readonly chain: Chain;

  private readonly tokenOutputs: TransactNote[] = [];

  private unshieldNote: UnshieldNote = UnshieldNoteERC20.empty();

  private unshieldFlag: bigint = UnshieldFlag.NO_UNSHIELD;

  private readonly tokenData: TokenData;

  private readonly tokenHash: string;

  private readonly spendingTree: number;

  private readonly utxos: TXO[];

  /**
   * Create ERC20Transaction Object
   * @param tokenAddress - token address, unformatted
   * @param tokenType - enum of token type
   * @param chain - chain type/id of network
   * @param spendingTree - tree index to spend from
   * @param utxos - UTXOs to spend from
   */
  constructor(
    chain: Chain,
    tokenData: TokenData,
    spendingTree: number,
    utxos: TXO[],
    tokenOutputs: TransactNote[],
    adaptID: AdaptID,
  ) {
    if (tokenOutputs.length > 2) {
      throw new Error('Can not add more than 2 outputs.');
    }

    this.chain = chain;
    this.tokenData = tokenData;
    this.tokenHash = getTokenDataHash(tokenData);
    this.spendingTree = spendingTree;
    this.utxos = utxos;
    this.tokenOutputs = tokenOutputs;
    this.adaptID = adaptID;
  }

  addUnshieldData(unshieldData: UnshieldData, unshieldValue: bigint) {
    if (this.unshieldFlag !== UnshieldFlag.NO_UNSHIELD) {
      throw new Error('You may only call .unshield once for a given transaction.');
    }

    const tokenHashUnshield = getTokenDataHash(unshieldData.tokenData);
    if (tokenHashUnshield !== this.tokenHash) {
      throw new Error('Unshield token does not match Transaction token.');
    }

    const { tokenData, allowOverride } = unshieldData;
    const { tokenAddress, tokenType, tokenSubID } = tokenData;

    switch (tokenType) {
      case TokenType.ERC20:
        this.unshieldNote = new UnshieldNoteERC20(
          unshieldData.toAddress,
          unshieldValue,
          tokenAddress,
          allowOverride,
        );
        break;
      case TokenType.ERC721:
      case TokenType.ERC1155: {
        const nftTokenData: NFTTokenData = {
          tokenAddress,
          tokenType,
          tokenSubID,
        };
        this.unshieldNote = new UnshieldNoteNFT(
          unshieldData.toAddress,
          nftTokenData,
          allowOverride,
        );
        break;
      }
    }

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
    const merkletree = wallet.merkletrees[this.chain.type][this.chain.id];
    const merkleRoot = await merkletree.getRoot(this.spendingTree);
    const spendingKey = await wallet.getSpendingKeyPair(encryptionKey);
    const nullifyingKey = wallet.getNullifyingKey();
    const senderViewingKeys = wallet.getViewingKeyPair();

    // Check if there's too many outputs
    if (this.tokenOutputs.length > 2) throw new Error('Too many transaction outputs');

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
      this.tokenOutputs.reduce((left, right) => left + right.value, BigInt(0)) + this.unshieldValue;

    const change = totalIn - totalOut;
    if (change < 0) {
      throw new Error('Negative change value - transaction not possible.');
    }

    const allOutputs: (TransactNote | UnshieldNote)[] = [...this.tokenOutputs];

    // Create change output
    allOutputs.push(
      TransactNote.createTransfer(
        wallet.addressKeys, // Receiver
        wallet.addressKeys, // Sender
        randomHex(16),
        change,
        this.tokenData,
        senderViewingKeys,
        true, // showSenderAddressToRecipient
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
      chainID: hexlify(getChainFullNetworkID(this.chain), true),
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
      tokenAddress: hexToBigInt(this.tokenHash),
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

  static async generateTransaction(
    proof: Proof,
    publicInputs: PublicInputs,
    boundParams: BoundParamsStruct,
    unshieldPreimage: CommitmentPreimageStruct,
  ): Promise<TransactionStruct> {
    const formatted = Prover.formatProof(proof);
    const formattedTransaction = {
      proof: formatted,
      merkleRoot: nToHex(publicInputs.merkleRoot, ByteLength.UINT_256, true),
      nullifiers: publicInputs.nullifiers.map((n) => nToHex(n, ByteLength.UINT_256, true)),
      boundParams,
      commitments: publicInputs.commitmentsOut.map((n) => nToHex(n, ByteLength.UINT_256, true)),
      unshieldPreimage: {
        ...unshieldPreimage,
        npk: formatToByteLength(await unshieldPreimage.npk, ByteLength.UINT_256, true),
      },
    };
    return formattedTransaction;
  }
}

export { Transaction };
