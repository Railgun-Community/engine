import { defaultAbiCoder } from 'ethers/lib/utils';
import { Note } from '../note';
import { bytes, hash } from '../utils';
import { Wallet } from '../wallet/wallet';
import { PrivateInputs, PublicInputs, Prover, Proof, ProverProgressCallback } from '../prover';
import { SNARK_PRIME_BIGINT, ZERO_ADDRESS } from '../utils/constants';
import { ByteLength, formatToByteLength, hexlify, hexToBigInt } from '../utils/bytes';
import {
  AdaptID,
  BoundParams,
  Ciphertext,
  CommitmentPreimage,
  OutputCommitmentCiphertext,
  OutputType,
  SerializedTransaction,
  TokenType,
} from '../models/formatted-types';
import { DEFAULT_TOKEN_SUB_ID, WithdrawFlag } from './constants';
import { getEphemeralKeys, getSharedSymmetricKey } from '../utils/keys-utils';
import { ERC20WithdrawNote } from '../note/erc20-withdraw';
import { TXO } from '../models/txo-types';
import { Memo } from '../note/memo';

const abiCoder = defaultAbiCoder;

export function hashBoundParams(boundParams: BoundParams) {
  const hashed = hash.keccak256(
    abiCoder.encode(
      // prettier-ignore
      ['tuple(uint16 treeNumber, uint8 withdraw, address adaptContract, bytes32 adaptParams, tuple(uint256[4] ciphertext, uint256[2] ephemeralKeys, uint256[] memo)[] commitmentCiphertext) _boundParams',],
      [boundParams],
    ),
  );

  return hexToBigInt(hashed) % SNARK_PRIME_BIGINT;
}

class Transaction {
  private adaptID: AdaptID;

  private chainID: number;

  private tokenAddress: string;

  private outputs: Note[] = [];

  private withdrawNote: ERC20WithdrawNote = ERC20WithdrawNote.empty();

  private withdrawFlag: bigint = WithdrawFlag.NO_WITHDRAW;

  private tokenType: TokenType;

  private tokenSubID: bigint = DEFAULT_TOKEN_SUB_ID;

  private spendingTree: number;

  private utxos: TXO[];

  /**
   * Create ERC20Transaction Object
   * @param tokenAddress - token address, unformatted
   * @param tokenType - enum of token type
   * @param chainID - chainID of network transaction will be built for
   * @param spendingTree - tree index to spend from
   * @param utxos - UTXOs to spend from
   */
  constructor(
    tokenAddress: string,
    tokenType: TokenType,
    chainID: number,
    spendingTree: number,
    utxos: TXO[],
    adaptID: AdaptID,
  ) {
    this.tokenAddress = formatToByteLength(tokenAddress, ByteLength.UINT_256);
    this.tokenType = tokenType;
    this.chainID = chainID;
    this.spendingTree = spendingTree;
    this.utxos = utxos;
    this.adaptID = adaptID;
  }

  setOutputs(outputs: Note[]) {
    if (this.outputs.length > 2) {
      throw new Error('Can not add more than 2 outputs.');
    }
    this.outputs = outputs;
  }

  withdraw(withdrawAddress: string, value: bigint, allowOverride?: boolean) {
    if (this.withdrawFlag !== WithdrawFlag.NO_WITHDRAW) {
      throw new Error('You may only call .withdraw once for a given transaction.');
    }

    this.withdrawNote = new ERC20WithdrawNote(withdrawAddress, value, this.tokenAddress);
    this.withdrawFlag = allowOverride ? WithdrawFlag.OVERRIDE : WithdrawFlag.WITHDRAW;
  }

  get withdrawValue() {
    return this.withdrawNote ? this.withdrawNote.value : BigInt(0);
  }

  /**
   * Generates inputs for prover
   * @param wallet - wallet to spend from
   * @param encryptionKey - encryption key of wallet
   */
  async generateInputs(
    wallet: Wallet,
    encryptionKey: string,
  ): Promise<{
    inputs: PrivateInputs;
    publicInputs: PublicInputs;
    boundParams: BoundParams;
  }> {
    const merkleTree = wallet.merkletree[this.chainID];
    const merkleRoot = await merkleTree.getRoot(this.spendingTree); // TODO: Is this correct tree?
    const spendingKey = await wallet.getSpendingKeyPair(encryptionKey);
    const nullifyingKey = wallet.getNullifyingKey();
    const viewingKey = wallet.getViewingKeyPair();

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
      nullifiers.push(Note.getNullifier(nullifyingKey, utxo.position));

      // Push path elements
      // eslint-disable-next-line no-await-in-loop
      const proof = await merkleTree.getProof(this.spendingTree, utxo.position);
      pathElements.push(proof.elements.map((element) => hexToBigInt(element)));

      // Push path indicies
      pathIndices.push(BigInt(utxo.position));
    }

    // Calculate change amount
    const totalIn = utxos.reduce((left, right) => left + right.note.value, BigInt(0));

    const totalOut =
      this.outputs.reduce((left, right) => left + right.value, BigInt(0)) + this.withdrawValue;

    const change = totalIn - totalOut;
    if (change < 0) {
      throw new Error('Negative change value - transaction not possible.');
    }

    const allOutputs: (Note | ERC20WithdrawNote)[] = [...this.outputs];

    // Create change output
    const changeMemo: string[] = Memo.createMemoField(
      {
        outputType: OutputType.Change,
      },
      viewingKey.privateKey,
    );
    allOutputs.push(
      new Note(wallet.addressKeys, bytes.random(16), change, this.tokenAddress, changeMemo),
    );

    // Push withdraw output if withdraw is requested
    if (this.withdrawFlag !== WithdrawFlag.NO_WITHDRAW && this.withdrawNote) {
      allOutputs.push(this.withdrawNote);
    }

    const onlyInternalOutputs = allOutputs.filter((note) => note instanceof Note) as Note[];

    const notesEphemeralKeys = await Promise.all(
      onlyInternalOutputs.map((note) =>
        getEphemeralKeys(viewingKey.pubkey, note.viewingPublicKey, note.random),
      ),
    );

    // calculate symmetric key using sender privateKey and recipient ephemeral key
    const sharedKeys = await Promise.all(
      notesEphemeralKeys.map((ephemeralKeys) =>
        getSharedSymmetricKey(viewingKey.privateKey, ephemeralKeys[1]),
      ),
    );

    const commitmentCiphertext: OutputCommitmentCiphertext[] = onlyInternalOutputs.map(
      (note, index) => {
        const sharedKey = sharedKeys[index];
        if (!sharedKey) {
          throw new Error('Shared symmetric key is not defined.');
        }

        const ciphertext: Ciphertext = note.encrypt(sharedKey);
        return {
          ciphertext: [`${ciphertext.iv}${ciphertext.tag}`, ...ciphertext.data].map((el) =>
            hexToBigInt(el as string),
          ) as [bigint, bigint, bigint, bigint],
          ephemeralKeys: notesEphemeralKeys[index].map((el) => hexToBigInt(hexlify(el))) as [
            bigint,
            bigint,
          ],
          memo: note.memoField.map((el) => hexToBigInt(el)),
        };
      },
    );
    const boundParams: BoundParams = {
      treeNumber: BigInt(this.spendingTree),
      withdraw: this.withdrawFlag,
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

    const signature = Note.sign(publicInputs, spendingKey.privateKey);

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
    wallet: Wallet,
    encryptionKey: string,
    progressCallback: ProverProgressCallback,
  ): Promise<SerializedTransaction> {
    // Get inputs
    const { inputs, publicInputs, boundParams } = await this.generateInputs(wallet, encryptionKey);

    // Calculate proof
    const { proof } = await prover.prove(publicInputs, inputs, progressCallback);

    const overrideWithdrawAddress = ZERO_ADDRESS;

    return Transaction.generateSerializedTransaction(
      proof,
      publicInputs,
      boundParams,
      overrideWithdrawAddress,
      this.withdrawNote.preImage,
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
    wallet: Wallet,
    encryptionKey: string,
  ): Promise<SerializedTransaction> {
    // Get inputs
    const { publicInputs, boundParams } = await this.generateInputs(wallet, encryptionKey);

    const dummyProof: Proof = await prover.dummyProve(publicInputs);

    const overrideWithdrawAddress = ZERO_ADDRESS;

    return Transaction.generateSerializedTransaction(
      dummyProof,
      publicInputs,
      boundParams,
      overrideWithdrawAddress,
      this.withdrawNote.preImage,
    );
  }

  static generateSerializedTransaction(
    proof: Proof,
    publicInputs: PublicInputs,
    boundParams: BoundParams,
    overrideWithdrawAddress: string,
    withdrawPreimage: CommitmentPreimage,
  ): SerializedTransaction {
    const formatted = Prover.formatProof(proof);
    return {
      proof: formatted,
      merkleRoot: publicInputs.merkleRoot,
      nullifiers: publicInputs.nullifiers,
      boundParams,
      commitments: publicInputs.commitmentsOut,
      withdrawPreimage,
      overrideOutput: overrideWithdrawAddress,
    };
  }
}

export { Transaction };
