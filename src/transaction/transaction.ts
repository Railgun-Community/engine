import { defaultAbiCoder } from 'ethers/lib/utils';
import { Note, WithdrawNote } from '../note';
import { babyjubjub, hash } from '../utils';
import { Wallet, TXO } from '../wallet';
import type { PrivateInputs, PublicInputs, Prover, Proof } from '../prover';
import { SNARK_PRIME } from '../utils/constants';
import { BigIntish, formatToByteLength, hexToBigInt, nToHex } from '../utils/bytes';
import { findSolutions } from './solutions';
import {
  AdaptID,
  BoundParams,
  CommitmentCiphertext,
  CommitmentPreimage,
  HashZero,
  SerializedTransaction,
} from './types';
import {
  DEFAULT_ERC20_TOKEN_TYPE,
  DEFAULT_TOKEN_SUB_ID,
  NOTE_INPUTS,
  NOTE_OUTPUTS,
  WithdrawFlag,
} from './constants';
import { emptyCommitmentPreimage } from '../note/preimage';
import { depths } from '../merkletree';
import { generateEphemeralKeys, randomPublicKey } from '../utils/ed25519';
import { getSharedKey } from '../utils/encryption';
import { randomPubkey } from '../utils/babyjubjub';

const abiCoder = defaultAbiCoder;

export function hashBoundParams(boundParams: BoundParams) {
  const hashed = hash.keccak256(
    abiCoder.encode(
      [
        'tuple(uint16 treeNumber, uint8 withdraw, address adaptContract, bytes32 adaptParams, tuple(uint256[4] ciphertext, uint256[2] ephemeralKeys, uint256[] memo)[] commitmentCiphertext) _boundParams',
      ],
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
  overrideOutput: string = '0x0000000000000000000000000000000000000000';

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
    this.token = formatToByteLength(token, 32, false);
    this.chainID = chainID;
    this.tree = tree;
    this.withdrawPreimage = emptyCommitmentPreimage;
  }

  get tokenData() {
    return {
      tokenAddress: this.token,
      tokenSubID: '00',
      tokenType: '00',
    };
  }

  withdraw(originalAddress: string, value: BigIntish) {
    const note = new WithdrawNote(originalAddress, BigInt(value), this.tokenData);
    this.withdrawPreimage.value = value.toString();
    this.withdrawPreimage = note.serialize(['00', '00']);
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
    const { viewingPublicKey } = wallet;
    const viewingPrivateKey = await wallet.getNullifyingKey();
    const publicKey = babyjubjub.privateKeyToPubKeyUnpacked(spendingPrivateKey);

    // Calculate total required to be supplied by UTXOs
    const totalRequired =
      this.outputs.reduce((left, right) => left + right.value, 0n) -
      hexToBigInt(this.withdrawPreimage?.value);

    // Check if there's too many outputs
    if (this.outputs.length > 3) throw new Error('Too many outputs specified');

    // Check if output token fields match tokenID for this transaction
    this.outputs.forEach((output, index) => {
      if (output.token !== this.tokenData.tokenAddress)
        throw new Error(`TokenID mismatch on output ${index}`);
    });

    // Get UTXOs sorted by tree
    const treeSortedBalances = (await wallet.balancesByTree(this.chainID))[this.token];

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

      // Get private key (or dummy key if dummy note)
      const privateKey = utxo.dummyKey || spendingPrivateKey;

      // Push spending key and nullifier
      nullifiers.push(hexToBigInt(Note.getNullifier(privateKey, utxo.position)));

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
      this.outputs.reduce((left, right) => left + right.value, 0n) +
      hexToBigInt(this.withdrawPreimage?.value);

    const change = totalIn - totalOut;

    // Create change output
    this.outputs.push(new Note(wallet.addressKeys, babyjubjub.random(), change, this.token));

    const ephemeralKeys = await Promise.all(
      this.outputs.map((note) => generateEphemeralKeys(viewingPublicKey, note.viewingPublicKey)),
    );
    const sharedKeys = await Promise.all(
      this.outputs.map((note, index) => getSharedKey(viewingPrivateKey, ephemeralKeys[index][0])),
    );

    const commitmentCiphertext: CommitmentCiphertext[] = this.outputs.map((note, index) => {
      const ciphertext = note.encrypt(sharedKeys[index]);
      return {
        ciphertext: [`${ciphertext.iv}${ciphertext.tag}`, ...ciphertext.data].map((el) =>
          hexToBigInt(el as string),
        ),
        ephemeralKeys: ephemeralKeys[index].map((el) => hexToBigInt(el)),
        // memo: new Array(Math.floor(Math.random() * 10)).fill(1).map(() => hexToBigInt(random(32))),
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
    const boundParamsHash = hashBoundParams(boundParams);

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
      randomIn: utxos.map((utxo) => hexToBigInt(utxo.note.random)),
      valueIn: utxos.map((utxo) => utxo.note.value),
      pathElements, // @todo possibly misformatted
      leavesIndices: pathIndices,
      valueOut: this.outputs.map((note) => note.value),
      publicKey,
      npkOut: serializedCommitments.map((out) => hexToBigInt(out.npk)),
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
