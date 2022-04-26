import { defaultAbiCoder } from 'ethers/lib/utils';
import { Note, WithdrawNote } from '../note';
import { bytes, hash } from '../utils';
import { Wallet, TXO } from '../wallet';
import { depths } from '../merkletree';
import type { PrivateInputs, PublicInputs, Prover, Proof } from '../prover';
import { SNARK_PRIME, ZERO_ADDRESS } from '../utils/constants';
import {
  ByteLength,
  formatToByteLength,
  HashZero,
  hexlify,
  hexToBigInt,
  nToHex,
} from '../utils/bytes';
import { findSolutions } from './solutions';
import {
  AdaptID,
  BigIntish,
  BoundParams,
  CommitmentCiphertext,
  CommitmentPreimage,
  SerializedTransaction,
} from '../models/transaction-types';
import {
  DEFAULT_ERC20_TOKEN_TYPE,
  DEFAULT_TOKEN_SUB_ID,
  NOTE_INPUTS,
  NOTE_OUTPUTS,
  WithdrawFlag,
} from './constants';
import { getEphemeralKeys, getSharedSymmetricKey } from '../utils/keys-utils';

const abiCoder = defaultAbiCoder;

export function hashBoundParams(boundParams: BoundParams) {
  const hashed = hash.keccak256(
    abiCoder.encode(
      // prettier-ignore
      ['tuple(uint16 treeNumber, uint8 withdraw, address adaptContract, bytes32 adaptParams, tuple(uint256[4] ciphertext, uint256[2] ephemeralKeys, uint256[] memo)[] commitmentCiphertext) _boundParams',],
      [boundParams],
    ),
  );

  return hexToBigInt(hashed) % BigInt(SNARK_PRIME.toString(10));
}

class Transaction {
  adaptID: AdaptID = {
    contract: '0x0000000000000000000000000000000000000000',
    parameters: HashZero,
  };

  chainID: number;

  token: string;

  notesIn: Note[] = [];

  outputs: Note[] = [];

  // see WithdrawFlag
  withdrawFlag: bigint = WithdrawFlag.NO_WITHDRAW;

  // boundParams.withdraw == 2 means withdraw address is not to self and set in overrideOutput
  overrideOutput: string = ZERO_ADDRESS;

  tokenType = DEFAULT_ERC20_TOKEN_TYPE;

  tokenSubID: BigInt = DEFAULT_TOKEN_SUB_ID;

  tree: number;

  withdrawNote: WithdrawNote;

  /**
   * Create ERC20Transaction Object
   * @param token - token address
   * @param chainID - chainID of network transaction will be built for
   * @param tree - manually specify a tree
   */
  constructor(token: string, chainID: number, tree: number = 0) {
    this.token = formatToByteLength(token, 20, false);
    this.chainID = chainID;
    this.tree = tree;
    this.withdrawNote = WithdrawNote.empty();
  }

  withdraw(originalAddress: string, value: BigIntish, toAddress?: string) {
    this.withdrawNote = new WithdrawNote(originalAddress, BigInt(value), this.token);
    if (toAddress !== undefined) {
      this.overrideOutput = toAddress;
      this.withdrawFlag = WithdrawFlag.OVERRIDE;
    }
  }

  get withdrawValue() {
    return this.withdrawNote ? this.withdrawNote.value : 0n;
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
    const spendingKey = await wallet.getSpendingKeyPair(encryptionKey);
    const nullifyingKey = wallet.getNullifyingKey();
    const viewingKey = wallet.getViewingKeyPair();

    const outputTotal = this.outputs.reduce((left, right) => left + right.value, 0n);

    // Calculate total required to be supplied by UTXOs
    const totalRequired = outputTotal + this.withdrawValue;

    // Check if there's too many outputs
    if (this.outputs.length > 3) throw new Error('Too many outputs specified');

    // Check if output token fields match tokenID for this transaction
    this.outputs.forEach((output, index) => {
      if (output.token !== this.token) throw new Error(`TokenID mismatch on output ${index}`);
    });

    // Get UTXOs sorted by tree
    const treeSortedBalances = (await wallet.balancesByTree(this.chainID))[
      formatToByteLength(this.token, 32, false)
    ];

    if (treeSortedBalances === undefined)
      throw new Error(`Failed to find balances for ${this.token}`);

    // Sum balances
    const balance: bigint = treeSortedBalances.reduce((left, right) => left + right.balance, 0n);

    // Check if wallet balance is enough to cover this transaction
    if (totalRequired > balance) throw new Error('Wallet balance too low');

    // Loop through each tree with a balance and attempt to find a spending solution
    const utxos: TXO[] = treeSortedBalances.map((treeBalance, tree) =>
      findSolutions(this.token, treeBalance, tree, totalRequired),
    )[this.tree];

    // Get values
    const nullifiers: bigint[] = [];
    const pathElements: bigint[][] = [];
    const pathIndices: bigint[] = [];

    for (let i = 0; i < utxos?.length; i += 1) {
      // Get UTXO
      const utxo = utxos[i];

      // Push spending key and nullifier
      nullifiers.push(Note.getNullifier(nullifyingKey, utxo.position));

      // Push path elements
      if (utxo.dummyKey) {
        pathElements.push(new Array(depths.erc20).fill(0n));
      } else {
        // eslint-disable-next-line no-await-in-loop
        const proof = await merkleTree.getProof(this.tree, utxo.position);
        pathElements.push(proof.elements.map((element) => hexToBigInt(element)));
      }

      // Push path indicies
      pathIndices.push(BigInt(utxo.position));
    }

    // Calculate change amount
    const totalIn = utxos?.reduce((left, right) => left + right.note.value, 0n);

    const totalOut =
      this.outputs.reduce((left, right) => left + right.value, 0n) + this.withdrawValue;

    const change = totalIn - totalOut;

    // Create change output
    this.outputs.push(new Note(wallet.addressKeys, bytes.random(), change, this.token));

    const notesEphemeralKeys = await Promise.all(
      this.outputs.map((note) => getEphemeralKeys(viewingKey.pubkey, note.viewingPublicKey)),
    );

    // calculate symmetric key using sender privateKey and recipient ephemeral key
    const sharedKeys = await Promise.all(
      notesEphemeralKeys.map((ephemeralKeys) =>
        getSharedSymmetricKey(viewingKey.privateKey, ephemeralKeys[1]),
      ),
    );

    const commitmentCiphertext: CommitmentCiphertext[] = this.outputs.map((note, index) => {
      const ciphertext = note.encrypt(sharedKeys[index]);
      return {
        ciphertext: [`${ciphertext.iv}${ciphertext.tag}`, ...ciphertext.data].map((el) =>
          hexToBigInt(el as string),
        ),
        ephemeralKeys: notesEphemeralKeys[index].map((el) => hexToBigInt(hexlify(el))),
        memo: [],
      };
    });
    const boundParams: BoundParams = {
      treeNumber: BigInt(this.tree),
      withdraw: this.withdrawFlag,
      adaptContract: this.adaptID.contract,
      adaptParams: this.adaptID.parameters,
      commitmentCiphertext,
    };

    const commitmentsOut = this.outputs.map((note) => note.hash);

    const publicInputs: PublicInputs = {
      merkleRoot: hexToBigInt(merkleRoot),
      boundParamsHash: hashBoundParams(boundParams),
      nullifiers,
      commitmentsOut,
    };

    const signature = Note.sign(publicInputs, spendingKey.privateKey);

    // Format inputs
    const inputs: PrivateInputs = {
      token: hexToBigInt(this.token),
      randomIn: utxos.map((utxo) => hexToBigInt(utxo.note.random)),
      valueIn: utxos.map((utxo) => utxo.note.value),
      pathElements,
      leavesIndices: pathIndices,
      valueOut: this.outputs.map((note) => note.value),
      publicKey: spendingKey.pubkey,
      npkOut: this.outputs.map((x) => x.notePublicKey),
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
  ): Promise<SerializedTransaction> {
    // Get inputs
    const { inputs, publicInputs, boundParams } = await this.generateInputs(wallet, encryptionKey);

    // Calculate proof
    const { proof } = await prover.prove(publicInputs, inputs);

    return Transaction.generateSerializedTransaction(
      proof,
      publicInputs,
      boundParams,
      this.overrideOutput,
      this.withdrawNote.preImage,
    );
  }

  static get zeroProof(): Proof {
    const zero = nToHex(BigInt(0), ByteLength.UINT_8);
    // prettier-ignore
    return {
      pi_a: [zero, zero],
      pi_b: [[zero, zero], [zero, zero]],
      pi_c: [zero, zero],
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
      this.withdrawNote.preImage,
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
      proof: {
        a: {
          x: BigInt(proof.pi_a[0]),
          y: BigInt(proof.pi_a[1]),
        },
        b: {
          x: proof.pi_b[0].map((x) => BigInt(x)),
          y: proof.pi_b[1].map((x) => BigInt(x)),
        },
        c: {
          x: BigInt(proof.pi_c[0]),
          y: BigInt(proof.pi_c[1]),
        },
      },
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
