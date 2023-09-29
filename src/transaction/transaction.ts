import { RailgunWallet } from '../wallet/railgun-wallet';
import { Prover, ProverProgressCallback } from '../prover/prover';
import { ByteLength, formatToByteLength, hexlify, hexToBigInt, nToHex } from '../utils/bytes';
import { AdaptID, NFTTokenData, OutputType, TokenData, TokenType } from '../models/formatted-types';
import { UnshieldFlag } from '../models/transaction-constants';
import { getNoteBlindingKeys, getSharedSymmetricKey } from '../utils/keys-utils';
import { UnshieldNote } from '../note/unshield-note';
import { TXO, UnshieldData } from '../models/txo-types';
import { Memo } from '../note/memo';
import { Chain } from '../models/engine-types';
import { TransactNote } from '../note/transact-note';
import {
  UnprovedTransactionInputs,
  Proof,
  PublicInputsRailgun,
  RailgunTransactionRequest,
  PrivateInputsRailgun,
} from '../models/prover-types';
import {
  BoundParamsStruct,
  CommitmentCiphertextStruct,
  CommitmentPreimageStruct,
  TransactionStruct,
} from '../abi/typechain/RailgunSmartWallet';
import { hashBoundParams } from './bound-params';
import { getChainFullNetworkID } from '../chain/chain';
import { UnshieldNoteERC20 } from '../note/erc20/unshield-note-erc20';
import { UnshieldNoteNFT } from '../note/nft/unshield-note-nft';
import { getTokenDataHash } from '../note';
import { calculateTotalSpend } from '../solutions/utxos';
import { isDefined } from '../utils/is-defined';
import { TXIDVersion } from '../models';

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
    if (tokenOutputs.length > 4) {
      // Leave room for optional 5th change output.
      throw new Error('Can not add more than 4 outputs.');
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

    this.unshieldFlag =
      isDefined(allowOverride) && allowOverride ? UnshieldFlag.OVERRIDE : UnshieldFlag.UNSHIELD;
  }

  get unshieldValue() {
    return isDefined(this.unshieldNote) ? this.unshieldNote.value : BigInt(0);
  }

  /**
   * @param wallet - wallet to spend from
   * @param encryptionKey - encryption key of wallet
   */
  async generateTransactionRequest(
    wallet: RailgunWallet,
    txidVersion: TXIDVersion,
    encryptionKey: string,
    overallBatchMinGasPrice = 0n,
  ): Promise<RailgunTransactionRequest> {
    const merkletree = wallet.getUTXOMerkletree(txidVersion, this.chain);
    const merkleRoot = await merkletree.getRoot(this.spendingTree);
    const spendingKey = await wallet.getSpendingKeyPair(encryptionKey);
    const nullifyingKey = wallet.getNullifyingKey();
    const senderViewingKeys = wallet.getViewingKeyPair();

    if (this.tokenOutputs.length > 4) {
      // Leave room for optional 5th change output.
      // TODO: Support circuits 1x10 and 1x13.
      throw new Error('Cannot create a transaction with >4 non-change outputs.');
    }

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

      // Push path indices
      pathIndices.push(BigInt(utxo.position));
    }

    const allOutputs: (TransactNote | UnshieldNote)[] = [...this.tokenOutputs];

    const totalIn = calculateTotalSpend(utxos);
    const totalOutputNoteValues = TransactNote.calculateTotalNoteValues(this.tokenOutputs);
    const totalOut = totalOutputNoteValues + this.unshieldValue;

    const change = totalIn - totalOut;
    if (change < 0n) {
      throw new Error('Negative change value - transaction not possible.');
    }

    const requiresChangeOutput = change > 0n;
    if (requiresChangeOutput) {
      // Add change output
      allOutputs.push(
        TransactNote.createTransfer(
          wallet.addressKeys, // Receiver
          wallet.addressKeys, // Sender
          change,
          this.tokenData,
          senderViewingKeys,
          true, // showSenderAddressToRecipient
          OutputType.Change,
          undefined, // memoText
        ),
      );
    }

    // Push unshield output if unshield is requested
    const hasUnshield =
      this.unshieldFlag !== UnshieldFlag.NO_UNSHIELD && isDefined(this.unshieldNote);
    if (hasUnshield) {
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

    const publicInputs: PublicInputsRailgun = {
      merkleRoot: hexToBigInt(merkleRoot),
      boundParamsHash: hashBoundParams(boundParams),
      nullifiers,
      commitmentsOut: allOutputs.map((note) => note.hash),
    };

    const privateInputs: PrivateInputsRailgun = {
      tokenAddress: hexToBigInt(this.tokenHash),
      randomIn: utxos.map((utxo) => hexToBigInt(utxo.note.random)),
      valueIn: utxos.map((utxo) => utxo.note.value),
      pathElements,
      leavesIndices: pathIndices,
      valueOut: allOutputs.map((note) => note.value),
      publicKey: spendingKey.pubkey,
      npkOut: allOutputs.map((x) => x.notePublicKey),
      nullifyingKey,
    };

    const railgunTransactionRequest: RailgunTransactionRequest = {
      privateInputs,
      publicInputs,
      boundParams,
    };

    return railgunTransactionRequest;
  }

  /**
   * Generate proof and return serialized transaction
   * @param prover - prover to use
   * @param wallet - wallet to spend from
   * @param encryptionKey - encryption key for wallet
   * @returns serialized transaction
   */
  async generateProvedTransaction(
    prover: Prover,
    unprovedTransactionInputs: UnprovedTransactionInputs,
    progressCallback: ProverProgressCallback,
  ): Promise<TransactionStruct> {
    const { publicInputs, privateInputs, boundParams } = unprovedTransactionInputs;

    Transaction.assertCanProve(privateInputs);

    const { proof } = await prover.proveRailgun(unprovedTransactionInputs, progressCallback);

    return Transaction.createTransactionStruct(
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
  async generateDummyProvedTransaction(
    prover: Prover,
    transactionRequest: RailgunTransactionRequest,
  ): Promise<TransactionStruct> {
    const { publicInputs, boundParams } = transactionRequest;

    const dummyProof: Proof = prover.dummyProveRailgun(publicInputs);

    return Transaction.createTransactionStruct(
      dummyProof,
      publicInputs,
      boundParams,
      this.unshieldNote.preImage,
    );
  }

  private static assertCanProve(privateInputs: PrivateInputsRailgun) {
    if (
      privateInputs.valueIn.length === 1 &&
      privateInputs.valueOut.length === 1 &&
      privateInputs.valueIn[0] === 0n &&
      privateInputs.valueOut[0] === 0n
    ) {
      throw new Error('Cannot prove transaction with null (zero value) inputs and outputs.');
    }
  }

  private static createTransactionStruct(
    proof: Proof,
    publicInputs: PublicInputsRailgun,
    boundParams: BoundParamsStruct,
    unshieldPreimage: CommitmentPreimageStruct,
  ): TransactionStruct {
    return {
      proof: Prover.formatProof(proof),
      merkleRoot: nToHex(publicInputs.merkleRoot, ByteLength.UINT_256, true),
      nullifiers: publicInputs.nullifiers.map((n) => nToHex(n, ByteLength.UINT_256, true)),
      boundParams,
      commitments: publicInputs.commitmentsOut.map((n) => nToHex(n, ByteLength.UINT_256, true)),
      unshieldPreimage: {
        npk: formatToByteLength(unshieldPreimage.npk, ByteLength.UINT_256, true),
        token: unshieldPreimage.token,
        value: unshieldPreimage.value,
      },
    };
  }
}

export { Transaction };
