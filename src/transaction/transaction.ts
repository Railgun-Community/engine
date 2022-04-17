import { defaultAbiCoder } from 'ethers/lib/utils';
import { Note, WithdrawNote } from '../note';
import { hash, babyjubjub, encryption } from '../utils';
import { Wallet, TXO } from '../wallet';
import type { PrivateInputs, PublicInputs, Prover, Proof } from '../prover';
import { SNARK_PRIME } from '../utils/constants';
import { BigIntish, formatToByteLength, hexToBigInt, nToHex } from '../utils/bytes';
import { findSolutions } from './solutions';
import { AdaptID, BoundParams, CommitmentPreimage, SerializedTransaction } from './types';
import {
  DEFAULT_ERC20_TOKEN_TYPE,
  DEFAULT_TOKEN_SUB_ID,
  NOTE_INPUTS,
  NOTE_OUTPUTS,
  WithdrawFlag,
} from './constants';
import { emptyCommitmentPreimage } from '../note/preimage';
import { depths } from '../merkletree';

const abiCoder = defaultAbiCoder;

function hashBoundParams(boundParams: BoundParams) {
  const hashed = hash.keccak256(
    abiCoder.encode(
      [
        'tuple(uint16 treeNumber, uint8 withdraw, address adaptContract, bytes32 adaptParams, tuple(uint256[4] ciphertext, uint256[2] ephemeralKeys, bytes32[] memo)[] commitmentCiphertext) _boundParams',
      ],
      [boundParams],
    ),
  );

  return hexToBigInt(hashed) % BigInt(SNARK_PRIME.toString(10));
}

class Transaction {
  adaptID: AdaptID = {
    contract: '00',
    parameters: BigInt(0),
  };

  chainID: number;

  token: string;

  notesIn: Note[] = [];

  outputs: Note[] = [];

  // see WithdrawFlag
  withdrawFlag: bigint = WithdrawFlag.NO_WITHDRAW;

  // boundParams.withdraw == 2 means withdraw address is not to self and set in overrideOutput
  overrideOutput: string = '';

  tokenType = DEFAULT_ERC20_TOKEN_TYPE;

  tokenSubID: BigInt = DEFAULT_TOKEN_SUB_ID;

  tree: number;

  withdrawPreimage: CommitmentPreimage;

  /**
   * Create ERC20Transaction Object
   * @param token - token address
   * @param chainID - chainID of network transaction will be built for
   * @param tree - manually specify a tree
   */
  constructor(token: string, chainID: number, tree: number = 0) {
    this.token = token;
    this.chainID = chainID;
    this.tree = tree;
    this.withdrawPreimage = emptyCommitmentPreimage;
  }

  get tokenData() {
    return {
      tokenAddress: formatToByteLength(this.token, 32, false),
      tokenSubID: '00',
      tokenType: '00',
    };
  }

  withdraw(originalAddress: string, value: BigIntish) {
    const note = new WithdrawNote(originalAddress, BigInt(value), this.tokenData);
    this.withdrawPreimage.value = value.toString();
    this.withdrawPreimage = note.serialize();
  }

  set withdrawAddress(value: string) {
    this.overrideOutput = value;
    this.withdrawFlag = WithdrawFlag.OVERRIDE;
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
    const merkleRoot = await merkleTree.getRoot(0);
    const spendingPrivateKey = await wallet.getSpendingPrivateKey(encryptionKey);
    const viewingPrivateKey = await wallet.getViewingPrivateKey();

    // Calculate total required to be supplied by UTXOs
    const totalRequired =
      this.outputs.reduce((left, right) => left + right.value, BigInt(0)) -
      hexToBigInt(this.withdrawPreimage?.value);

    // Check if there's too many outputs
    if (this.outputs.length > 3) throw new Error('Too many outputs specified');

    // Check if output token fields match tokenID for this transaction
    this.outputs.forEach((output, index) => {
      if (output.token !== this.tokenData.tokenAddress)
        throw new Error(`TokenID mismatch on output ${index}`);
    });

    const { log } = console;
    // Get UTXOs sorted by tree
    const balances = await wallet.balancesByTree(this.chainID);
    log(balances);

    const treeSortedBalances = (await wallet.balancesByTree(this.chainID))[this.token] || [];

    // Sum balances
    const balance: bigint = treeSortedBalances.reduce(
      (left, right) => left + right.balance,
      BigInt(0),
    );

    // Check if wallet balance is enough to cover this transaction
    if (totalRequired > balance) throw new Error('Wallet balance too low');

    // Loop through each tree with a balance and attempt to find a spending solution
    const solutions: TXO[][] = treeSortedBalances.map((treeBalance, tree) =>
      findSolutions(this.token, treeBalance, tree, totalRequired),
    );

    // If tree isn't specified, find first tree with a spending solution
    const tree = this.tree || solutions.findIndex((value) => value.length > 0);

    // Check if tree with spending solution exists
    if (tree === -1 || solutions[tree] === undefined)
      throw new Error('Balances need to be consolidated before being able to spend this amount');

    // Check if withdraw address isn't set when it should be
    /*
    if (this.withdraw === WithdrawFlag.WITHDRAW && )
      throw new Error('Withdraw flag indicates withdraw but amount is 0');
    */

    // Check if withdraw address is set when it shouldn't be
    if (!this.withdraw && this.overrideOutput !== undefined)
      throw new Error('Withdraw amount should be set if withdrawAddress is');

    if (this.withdrawFlag === WithdrawFlag.OVERRIDE && this.overrideOutput !== '')
      throw new Error('Withdraw set to override but overrideOutput address not set');

    // Get values
    const nullifiers: bigint[] = [];
    const pathElements: bigint[][] = [];
    const pathIndices: bigint[] = [];

    for (let i = 0; i < solutions[tree].length; i += 1) {
      // Get UTXO
      const utxo = solutions[tree][i];

      // Get private key (or dummy key if dummy note)
      const privateKey = utxo.dummyKey || spendingPrivateKey;

      // Push spending key and nullifier
      nullifiers.push(hexToBigInt(Note.getNullifier(privateKey, utxo.position)));

      // Push path elements
      if (utxo.dummyKey) {
        pathElements.push(new Array(depths.erc20).fill(BigInt(0)));
      } else {
        pathElements.push(
          // eslint-disable-next-line no-await-in-loop
          (await wallet.merkletree[this.chainID].getProof(tree, utxo.position)).elements.map(
            (element) => BigInt(element),
          ),
        );
      }

      // Push path indicies
      pathIndices.push(BigInt(utxo.position));
    }

    // Calculate change amount
    const totalIn = solutions[tree].reduce((left, right) => left + right.note.value, BigInt(0));

    const totalOut =
      this.outputs.reduce((left, right) => left + right.value, BigInt(0)) +
      BigInt(this.withdrawPreimage?.value);

    const change = totalIn - totalOut;

    // Create change output
    this.outputs.push(new Note(wallet.masterPublicKey, babyjubjub.random(), change, this.token));

    // Pad with dummy notes to outputs length
    while (this.outputs.length < NOTE_OUTPUTS) {
      this.outputs.push(
        new Note(babyjubjub.randomPubkey(), babyjubjub.random(), BigInt(0), this.token),
      );
    }

    const sharedKeys = await Promise.all(
      this.outputs.map((note) => encryption.getSharedKey(viewingPrivateKey, note.notePublicKey)),
    );

    const commitmentCiphertext = this.outputs.map((note, index) => note.encrypt(sharedKeys[index]));
    const boundParams: BoundParams = {
      treeNumber: BigInt(this.tree),
      withdraw: this.withdrawFlag,
      adaptContract: this.adaptID.contract,
      adaptParams: this.adaptID.parameters,
      commitmentCiphertext,
    };
    const boundParamsHash = hashBoundParams(boundParams);
    const addressKeys = await wallet.getAddressKeys();

    const serializedCommitments = this.outputs.map((note) => note.serialize(viewingPrivateKey));

    const commitmentsOut = this.outputs.map((note) => hexToBigInt(note.hash));

    const publicInputs: PublicInputs = {
      merkleRoot: hexToBigInt(merkleRoot),
      boundParamsHash,
      nullifiers,
      commitmentsOut,
    };

    const signature = Note.sign(
      publicInputs.merkleRoot,
      boundParamsHash,
      nullifiers,
      commitmentsOut,
      spendingPrivateKey,
    );

    // Format inputs
    const inputs: PrivateInputs = {
      token: hexToBigInt(this.token),
      randomIn: solutions[tree].map((utxo) => hexToBigInt(utxo.note.random)),
      valueIn: this.notesIn.map((note) => note.value),
      pathElements, // : proofs.map((proof) => hexToBigInt(proof.elements)),
      leavesIndices: pathIndices, // : proofs.map((proof) => hexToBigInt(proof.indices)),
      valueOut: this.outputs.map((note) => note.value),
      publicKey: addressKeys.map((key) => BigInt(key)) as [bigint, bigint],
      npkOut: serializedCommitments.map((out) => BigInt(out.npk)),
      nullifyingKey: hexToBigInt(viewingPrivateKey),
      signature,
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
  ): Promise<SerializedTransaction> {
    // Get inputs
    const { inputs, publicInputs, boundParams } = await this.generateInputs(wallet, encryptionKey);

    // Calculate proof
    // @todo figure out which circuit to use
    const { proof } = await prover.prove(publicInputs, inputs);

    return Transaction.generateSerializedTransaction(
      proof,
      publicInputs,
      boundParams,
      this.overrideOutput,
      this.withdrawPreimage,
    );
  }

  static get zeroProof(): Proof {
    const zero = nToHex(BigInt(0));
    return {
      a: [zero, zero],
      b: [
        [zero, zero],
        [zero, zero],
      ],
      c: [zero, zero],
    };
  }

  /**
   * Return serialized transaction with zero'd proof for gas estimates.
   * @param wallet - wallet to spend from
   * @param encryptionKey - encryption key for wallet
   * @param boundParams
   * @returns serialized transaction
   */
  async dummyProve(wallet: Wallet, encryptionKey: string): Promise<SerializedTransaction> {
    // Get inputs
    const { publicInputs, boundParams } = await this.generateInputs(wallet, encryptionKey);

    const dummyProof = Transaction.zeroProof;

    return Transaction.generateSerializedTransaction(
      dummyProof,
      publicInputs,
      boundParams,
      this.overrideOutput,
      this.withdrawPreimage,
    );
  }

  static generateSerializedTransaction(
    proof: Proof,
    publicInputs: PublicInputs,
    boundParams: BoundParams,
    overrideOutput: string,
    withdrawPreimage: CommitmentPreimage,
  ): SerializedTransaction {
    return {
      proof,
      merkleRoot: publicInputs.merkleRoot,
      nullifiers: publicInputs.nullifiers,
      boundParams,
      commitments: publicInputs.commitmentsOut,
      withdrawPreimage,
      overrideOutput,
    };
  }
}

export { Transaction, NOTE_INPUTS, NOTE_OUTPUTS };
