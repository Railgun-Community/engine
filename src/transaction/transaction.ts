import { defaultAbiCoder } from 'ethers/lib/utils';
import { RailgunWallet } from '../wallet/railgun-wallet';
import {
  PrivateInputs,
  PublicInputs,
  Prover,
  Proof,
  ProverProgressCallback,
} from '../prover/prover';
import { SNARK_PRIME_BIGINT, ZERO_ADDRESS } from '../utils/constants';
import { ByteLength, formatToByteLength, hexlify, hexToBigInt, randomHex } from '../utils/bytes';
import {
  AdaptID,
  BoundParams,
  CommitmentPreimage,
  OutputCommitmentCiphertext,
  OutputType,
  SerializedTransaction,
  TokenType,
} from '../models/formatted-types';
import { DEFAULT_TOKEN_SUB_ID, MEMO_SENDER_BLINDING_KEY_NULL, WithdrawFlag } from './constants';
import { getEphemeralKeys, getSharedSymmetricKey } from '../utils/keys-utils';
import { ERC20WithdrawNote } from '../note/erc20-withdraw';
import { TXO } from '../models/txo-types';
import { Memo } from '../note/memo';
import { Chain } from '../models/engine-types';
import { Note } from '../note/note';
import { keccak256 } from '../utils/hash';

const abiCoder = defaultAbiCoder;

export function hashBoundParams(boundParams: BoundParams) {
  const hashed = keccak256(
    abiCoder.encode(
      [
        'tuple(uint16 treeNumber, uint8 withdraw, address adaptContract, bytes32 adaptParams, tuple(uint256[4] ciphertext, uint256[2] ephemeralKeys, uint256[] memo)[] commitmentCiphertext) _boundParams',
      ],
      [boundParams],
    ),
  );

  return hexToBigInt(hashed) % SNARK_PRIME_BIGINT;
}

class Transaction {
  private adaptID: AdaptID;

  private chain: Chain;

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
  ) {
    this.tokenAddress = formatToByteLength(tokenAddress, ByteLength.UINT_256);
    this.tokenType = tokenType;
    this.chain = chain;
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

    this.withdrawNote = new ERC20WithdrawNote(
      withdrawAddress,
      value,
      this.tokenAddress,
      this.tokenType,
    );
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
    wallet: RailgunWallet,
    encryptionKey: string,
  ): Promise<{
    inputs: PrivateInputs;
    publicInputs: PublicInputs;
    boundParams: BoundParams;
  }> {
    const merkletree = wallet.merkletrees[this.chain.type][this.chain.id];
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
      nullifiers.push(Note.getNullifier(nullifyingKey, utxo.position));

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
      this.outputs.reduce((left, right) => left + right.value, BigInt(0)) + this.withdrawValue;

    const change = totalIn - totalOut;
    if (change < 0) {
      throw new Error('Negative change value - transaction not possible.');
    }

    const allOutputs: (Note | ERC20WithdrawNote)[] = [...this.outputs];

    // Create change output
    const changeSenderBlindingKey = MEMO_SENDER_BLINDING_KEY_NULL; // Not need for change output.
    allOutputs.push(
      Note.create(
        wallet.addressKeys,
        randomHex(16),
        change,
        this.tokenAddress,
        senderViewingKeys,
        changeSenderBlindingKey,
        OutputType.Change,
        undefined, // memoText
      ),
    );

    // Push withdraw output if withdraw is requested
    if (this.withdrawFlag !== WithdrawFlag.NO_WITHDRAW && this.withdrawNote) {
      allOutputs.push(this.withdrawNote);
    }

    const onlyInternalOutputs = allOutputs.filter((note) => note instanceof Note) as Note[];

    const viewingPrivateKey = wallet.getViewingKeyPair().privateKey;

    const notesEphemeralKeys = await Promise.all(
      onlyInternalOutputs.map((note) => {
        const senderBlindingKey = Memo.decryptSenderBlindingKey(note.memoField, viewingPrivateKey);
        return getEphemeralKeys(
          senderViewingKeys.pubkey,
          note.viewingPublicKey,
          note.random,
          senderBlindingKey,
        );
      }),
    );

    // calculate symmetric key using sender privateKey and recipient ephemeral key
    const sharedKeys = await Promise.all(
      notesEphemeralKeys.map((ephemeralKeys) =>
        getSharedSymmetricKey(senderViewingKeys.privateKey, ephemeralKeys[1]),
      ),
    );

    const commitmentCiphertext: OutputCommitmentCiphertext[] = onlyInternalOutputs.map(
      (note, index) => {
        const sharedKey = sharedKeys[index];
        if (!sharedKey) {
          throw new Error('Shared symmetric key is not defined.');
        }

        const { noteCiphertext, noteMemo } = note.encrypt(sharedKey);
        return {
          ciphertext: [`${noteCiphertext.iv}${noteCiphertext.tag}`, ...noteCiphertext.data].map(
            (el) => hexToBigInt(el as string),
          ) as [bigint, bigint, bigint, bigint],
          ephemeralKeys: notesEphemeralKeys[index].map((el) => hexToBigInt(hexlify(el))) as [
            bigint,
            bigint,
          ],
          memo: noteMemo.map((el) => hexToBigInt(el)),
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
    wallet: RailgunWallet,
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
    wallet: RailgunWallet,
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
