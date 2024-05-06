import { RailgunWallet } from '../wallet/railgun-wallet';
import { Prover, ProverProgressCallback } from '../prover/prover';
import { ByteLength, ByteUtils } from '../utils/bytes';
import { AdaptID, NFTTokenData, TokenData, TokenType } from '../models/formatted-types';
import { UnshieldFlag } from '../models/transaction-constants';
import { getNoteBlindingKeys, getSharedSymmetricKey } from '../utils/keys-utils';
import { UnshieldNote } from '../note/unshield-note';
import { TXO, UnshieldData } from '../models/txo-types';
import { Chain } from '../models/engine-types';
import { TransactNote } from '../note/transact-note';
import {
  UnprovedTransactionInputs,
  Proof,
  PublicInputsRailgun,
  RailgunTransactionRequest,
  PrivateInputsRailgun,
  RailgunTransactionRequestV2,
  RailgunTransactionRequestV3,
} from '../models/prover-types';
import {
  BoundParamsStruct,
  CommitmentCiphertextStruct as CommitmentCiphertextStructV2,
  CommitmentPreimageStruct,
} from '../abi/typechain/RailgunSmartWallet';
import { hashBoundParamsV2, hashBoundParamsV3 } from './bound-params';
import { getChainFullNetworkID } from '../chain/chain';
import { UnshieldNoteERC20 } from '../note/erc20/unshield-note-erc20';
import { UnshieldNoteNFT } from '../note/nft/unshield-note-nft';
import { getTokenDataHash } from '../note';
import { isDefined } from '../utils/is-defined';
import { TXIDVersion } from '../models/poi-types';
import { PoseidonMerkleAccumulator, PoseidonMerkleVerifier } from '../abi/typechain';
import { TransactionStructV2, TransactionStructV3 } from '../models/transaction-types';

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
    if (tokenOutputs.length > 5) {
      throw new Error('Can not add more than 5 outputs.');
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
    globalBoundParams: PoseidonMerkleVerifier.GlobalBoundParamsStruct,
  ): Promise<RailgunTransactionRequest> {
    const merkletree = wallet.getUTXOMerkletree(txidVersion, this.chain);
    const merkleRoot = await merkletree.getRoot(this.spendingTree);
    const spendingKey = await wallet.getSpendingKeyPair(encryptionKey);
    const nullifyingKey = wallet.getNullifyingKey();
    const senderViewingKeys = wallet.getViewingKeyPair();

    // Get values
    const nullifiers: bigint[] = [];
    const pathElements: bigint[][] = [];
    const pathIndices: bigint[] = [];

    const { utxos } = this;

    for (const utxo of utxos) {
      // Push spending key and nullifier
      nullifiers.push(TransactNote.getNullifier(nullifyingKey, utxo.position));

      // Push path elements
      // eslint-disable-next-line no-await-in-loop
      const merkleProof = await merkletree.getMerkleProof(this.spendingTree, utxo.position);
      pathElements.push(merkleProof.elements.map((element) => ByteUtils.hexToBigInt(element)));

      // Push path indices
      pathIndices.push(BigInt(utxo.position));
    }

    const allOutputs: (TransactNote | UnshieldNote)[] = [...this.tokenOutputs];

    // Push unshield output if unshield is requested
    const hasUnshield =
      this.unshieldFlag !== UnshieldFlag.NO_UNSHIELD && isDefined(this.unshieldNote);
    if (hasUnshield) {
      allOutputs.push(this.unshieldNote);
    }

    if (allOutputs.length > 5) {
      // TODO: Support circuits 1x10 and 1x13.
      throw new Error('Cannot create a transaction with >5 outputs.');
    }

    const onlyInternalOutputs = allOutputs.filter(
      (note) => note instanceof TransactNote,
    ) as TransactNote[];

    const noteBlindedKeys = await Promise.all(
      onlyInternalOutputs.map((note) => {
        if (!isDefined(note.senderRandom)) {
          throw new Error('Sender random is not defined for transact note.');
        }
        return getNoteBlindingKeys(
          senderViewingKeys.pubkey,
          note.receiverAddressData.viewingPublicKey,
          note.random,
          note.senderRandom,
        );
      }),
    );

    // Calculate shared keys using sender privateKey and recipient blinding key.
    const sharedKeys = await Promise.all(
      noteBlindedKeys.map(({ blindedReceiverViewingKey }) =>
        getSharedSymmetricKey(senderViewingKeys.privateKey, blindedReceiverViewingKey),
      ),
    );

    const privateInputs: PrivateInputsRailgun = {
      tokenAddress: ByteUtils.hexToBigInt(this.tokenHash),
      randomIn: utxos.map((utxo) => ByteUtils.hexToBigInt(utxo.note.random)),
      valueIn: utxos.map((utxo) => utxo.note.value),
      pathElements,
      leavesIndices: pathIndices,
      valueOut: allOutputs.map((note) => note.value),
      publicKey: spendingKey.pubkey,
      npkOut: allOutputs.map((x) => x.notePublicKey),
      nullifyingKey,
    };

    switch (txidVersion) {
      case TXIDVersion.V2_PoseidonMerkle: {
        const commitmentCiphertext: CommitmentCiphertextStructV2[] = onlyInternalOutputs.map(
          (note, index) => {
            const sharedKey = sharedKeys[index];
            if (!sharedKey) {
              throw new Error('Shared symmetric key is not defined.');
            }

            const { noteCiphertext, noteMemo, annotationData } = note.encryptV2(
              txidVersion,
              sharedKey,
              wallet.addressKeys.masterPublicKey,
              note.senderRandom,
              wallet.viewingKeyPair.privateKey,
            );
            if (noteCiphertext.data.length !== 3) {
              throw new Error('Note ciphertext data must have length 3.');
            }
            const ciphertext: [string, string, string, string] = [
              ByteUtils.hexlify(`${noteCiphertext.iv}${noteCiphertext.tag}`, true),
              ByteUtils.hexlify(noteCiphertext.data[0], true),
              ByteUtils.hexlify(noteCiphertext.data[1], true),
              ByteUtils.hexlify(noteCiphertext.data[2], true),
            ];
            return {
              ciphertext,
              blindedSenderViewingKey: ByteUtils.hexlify(
                noteBlindedKeys[index].blindedSenderViewingKey,
                true,
              ),
              blindedReceiverViewingKey: ByteUtils.hexlify(
                noteBlindedKeys[index].blindedReceiverViewingKey,
                true,
              ),
              memo: ByteUtils.hexlify(noteMemo, true),
              annotationData: ByteUtils.hexlify(annotationData, true),
            };
          },
        );

        const boundParams: BoundParamsStruct = {
          treeNumber: this.spendingTree,
          minGasPrice: globalBoundParams.minGasPrice,
          unshield: this.unshieldFlag,
          chainID: ByteUtils.hexlify(getChainFullNetworkID(this.chain), true),
          adaptContract: this.adaptID.contract,
          adaptParams: this.adaptID.parameters,
          commitmentCiphertext,
        };

        const publicInputs: PublicInputsRailgun = {
          merkleRoot: ByteUtils.hexToBigInt(merkleRoot),
          boundParamsHash: hashBoundParamsV2(boundParams),
          nullifiers,
          commitmentsOut: allOutputs.map((note) => note.hash),
        };

        const railgunTransactionRequest: RailgunTransactionRequestV2 = {
          txidVersion,
          privateInputs,
          publicInputs,
          boundParams,
        };
        return railgunTransactionRequest;
      }
      case TXIDVersion.V3_PoseidonMerkle: {
        const commitmentCiphertext: PoseidonMerkleAccumulator.CommitmentCiphertextStruct[] =
          onlyInternalOutputs.map((note, index) => {
            const sharedKey = sharedKeys[index];
            if (!sharedKey) {
              throw new Error('Shared symmetric key is not defined.');
            }
            if (!isDefined(note.senderRandom)) {
              throw new Error('Note must have senderRandom for V3 encryption');
            }

            const noteCiphertext = note.encryptV3(
              txidVersion,
              sharedKey,
              wallet.addressKeys.masterPublicKey,
            );
            const ciphertext: string = ByteUtils.prefix0x(
              `${noteCiphertext.nonce}${noteCiphertext.bundle}`,
            );
            return {
              ciphertext,
              blindedSenderViewingKey: ByteUtils.formatToByteLength(
                noteBlindedKeys[index].blindedSenderViewingKey,
                ByteLength.UINT_256,
                true,
              ),
              blindedReceiverViewingKey: ByteUtils.formatToByteLength(
                noteBlindedKeys[index].blindedReceiverViewingKey,
                ByteLength.UINT_256,
                true,
              ),
            };
          });

        const boundParams: PoseidonMerkleVerifier.BoundParamsStruct = {
          local: {
            treeNumber: this.spendingTree,
            commitmentCiphertext,
          },
          global: globalBoundParams,
        };

        const publicInputs: PublicInputsRailgun = {
          merkleRoot: ByteUtils.hexToBigInt(merkleRoot),
          boundParamsHash: hashBoundParamsV3(boundParams),
          nullifiers,
          commitmentsOut: allOutputs.map((note) => note.hash),
        };

        const railgunTransactionRequest: RailgunTransactionRequestV3 = {
          txidVersion,
          privateInputs,
          publicInputs,
          boundParams,
        };
        return railgunTransactionRequest;
      }
    }
    throw new Error('Invalid txidVersion.');
  }

  /**
   * Generate proof and return serialized transaction
   * @param prover - prover to use
   * @param wallet - wallet to spend from
   * @param encryptionKey - encryption key for wallet
   * @returns serialized transaction
   */
  async generateProvedTransaction(
    txidVersion: TXIDVersion,
    prover: Prover,
    unprovedTransactionInputs: UnprovedTransactionInputs,
    progressCallback: ProverProgressCallback,
  ): Promise<TransactionStructV2 | TransactionStructV3> {
    const { publicInputs, privateInputs, boundParams } = unprovedTransactionInputs;

    Transaction.assertCanProve(privateInputs);

    const { proof } = await prover.proveRailgun(
      txidVersion,
      unprovedTransactionInputs,
      progressCallback,
    );

    switch (unprovedTransactionInputs.txidVersion) {
      case TXIDVersion.V2_PoseidonMerkle: {
        return Transaction.createTransactionStructV2(
          unprovedTransactionInputs.txidVersion,
          proof,
          publicInputs,
          boundParams as BoundParamsStruct,
          this.unshieldNote.preImage,
        );
      }
      case TXIDVersion.V3_PoseidonMerkle: {
        return Transaction.createTransactionStructV3(
          unprovedTransactionInputs.txidVersion,
          proof,
          publicInputs,
          boundParams as PoseidonMerkleVerifier.BoundParamsStruct,
          this.unshieldNote.preImage,
        );
      }
    }
    throw new Error('Invalid txidVersion.');
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
  ): Promise<TransactionStructV2 | TransactionStructV3> {
    const { publicInputs, boundParams } = transactionRequest;

    const dummyProof: Proof = prover.dummyProveRailgun(publicInputs);

    switch (transactionRequest.txidVersion) {
      case TXIDVersion.V2_PoseidonMerkle: {
        return Transaction.createTransactionStructV2(
          transactionRequest.txidVersion,
          dummyProof,
          publicInputs,
          boundParams as BoundParamsStruct,
          this.unshieldNote.preImage,
        );
      }
      case TXIDVersion.V3_PoseidonMerkle: {
        return Transaction.createTransactionStructV3(
          transactionRequest.txidVersion,
          dummyProof,
          publicInputs,
          boundParams as PoseidonMerkleVerifier.BoundParamsStruct,
          this.unshieldNote.preImage,
        );
      }
    }
    throw new Error('Invalid txidVersion.');
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

  private static createTransactionStructV2(
    txidVersion: TXIDVersion.V2_PoseidonMerkle,
    proof: Proof,
    publicInputs: PublicInputsRailgun,
    boundParams: BoundParamsStruct,
    unshieldPreimage: CommitmentPreimageStruct,
  ): TransactionStructV2 {
    return {
      txidVersion,
      proof: Prover.formatProof(proof),
      merkleRoot: ByteUtils.nToHex(publicInputs.merkleRoot, ByteLength.UINT_256, true),
      nullifiers: publicInputs.nullifiers.map((n) =>
        ByteUtils.nToHex(n, ByteLength.UINT_256, true),
      ),
      boundParams,
      commitments: publicInputs.commitmentsOut.map((n) =>
        ByteUtils.nToHex(n, ByteLength.UINT_256, true),
      ),
      unshieldPreimage: {
        npk: ByteUtils.formatToByteLength(unshieldPreimage.npk, ByteLength.UINT_256, true),
        token: unshieldPreimage.token,
        value: unshieldPreimage.value,
      },
    };
  }

  private static createTransactionStructV3(
    txidVersion: TXIDVersion.V3_PoseidonMerkle,
    proof: Proof,
    publicInputs: PublicInputsRailgun,
    boundParams: PoseidonMerkleVerifier.BoundParamsStruct,
    unshieldPreimage: CommitmentPreimageStruct,
  ): TransactionStructV3 {
    return {
      txidVersion,
      proof: Prover.formatProof(proof),
      merkleRoot: ByteUtils.nToHex(publicInputs.merkleRoot, ByteLength.UINT_256, true),
      nullifiers: publicInputs.nullifiers.map((n) =>
        ByteUtils.nToHex(n, ByteLength.UINT_256, true),
      ),
      boundParams,
      commitments: publicInputs.commitmentsOut.map((n) =>
        ByteUtils.nToHex(n, ByteLength.UINT_256, true),
      ),
      unshieldPreimage: {
        npk: ByteUtils.formatToByteLength(unshieldPreimage.npk, ByteLength.UINT_256, true),
        token: unshieldPreimage.token,
        value: unshieldPreimage.value,
      },
    };
  }

  static getLocalBoundParams(transaction: TransactionStructV2 | TransactionStructV3) {
    switch (transaction.txidVersion) {
      case TXIDVersion.V2_PoseidonMerkle:
        return transaction.boundParams;
      case TXIDVersion.V3_PoseidonMerkle:
        return transaction.boundParams.local;
    }
    throw new Error('Invalid txidVersion.');
  }
}

export { Transaction };
