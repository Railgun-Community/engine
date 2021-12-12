import BN from 'bn.js';
import { ERC20Note } from '../note';
import { hash, bytes, babyjubjub } from '../utils';
import { Wallet, TXO } from '../wallet';
import { depths } from '../merkletree';
import type { ERC20PrivateInputs, Prover, Proof } from '../prover';

export type AdaptID = {
  contract: bytes.BytesData,
  parameters: bytes.BytesData,
}

export type Commitment = {
  hash: bytes.BytesData,
  ciphertext: bytes.BytesData[],
  senderPublicKey: bytes.BytesData,
};

export type ERC20TransactionSerialized = {
  proof: Proof;
  adaptID: AdaptID;
  deposit: bytes.BytesData,
  withdraw: bytes.BytesData,
  token: bytes.BytesData,
  withdrawAddress: bytes.BytesData,
  tree: bytes.BytesData,
  merkleroot: bytes.BytesData,
  nullifiers: bytes.BytesData[],
  commitments: Commitment[],
}

class ERC20Transaction {
  adaptID: AdaptID = {
    contract: '00',
    parameters: '00',
  };

  chainID: number;

  token: string;

  outputs: ERC20Note[] = [];

  deposit: BN = new BN(0);

  withdraw: BN = new BN(0);

  withdrawAddress: string | undefined;

  tree: number | undefined;

  /**
   * Create ERC20Transaction Object
   * @param token - token address
   * @param chainID - chainID of network transaction will be built for
   * @param tree - manually specify a tree
   */
  constructor(token: bytes.BytesData, chainID: number, tree: number | undefined = undefined) {
    this.token = bytes.hexlify(bytes.padToLength(token, 32));
    this.chainID = chainID;
    this.tree = tree;
  }

  /**
   * Gets adaptID hash
   */
  get adaptIDhash() {
    return hash.sha256(bytes.combine([
      bytes.padToLength(this.adaptID.contract, 32),
      bytes.padToLength(this.adaptID.parameters, 32),
    ]));
  }

  /**
   * Generates inputs for prover
   * @param wallet - wallet to spend from
   * @param encryptionKey - encryption key of wallet
   */
  async generateInputs(
    wallet: Wallet,
    encryptionKey: bytes.BytesData,
  ): Promise<{
    inputs: ERC20PrivateInputs,
    commitments: Commitment[],
  }> {
    // Calculate total required to be supplied by UTXOs
    const totalRequired = this.outputs
      .reduce((left, right) => left.add(bytes.numberify(right.amount)), new BN(0))
      .add(this.withdraw)
      .sub(this.deposit);

    // Check if there's too many outputs
    if (this.outputs.length > 2) throw new Error('Too many outputs specified');

    // Check if output token fields match tokenID for this transaction
    this.outputs.forEach((output, index) => { if (output.token !== this.token) throw new Error(`TokenID mismatch on output ${index}`); });

    // Get UTXOs sorted by tree
    const treeSortedBalances = (await wallet.balancesByTree(1))[this.token];

    // Sum balances
    const balance: BN = treeSortedBalances.reduce(
      (left, right) => left.add(right.balance),
      new BN(0),
    );

    // Check if wallet balance is enough to cover this transaction
    if (totalRequired.gt(balance)) throw new Error('Wallet balance too low');

    // Loop through each tree with a balance and attempt to find a spending solution
    const solutions: TXO[][] = treeSortedBalances.map((treeBalance, tree) => {
      // If this tree doesn't have enough to cover this transaction, return false
      if (treeBalance.balance.lt(totalRequired)) return [];

      // Sort UTXOs by size
      treeBalance.utxos.sort(
        (left, right) => {
          const leftNum = bytes.numberify(left.note.amount);
          const rightNum = bytes.numberify(right.note.amount);

          if (leftNum.lt(rightNum)) {
            return 1;
          }

          if (leftNum.gt(rightNum)) {
            return -1;
          }

          // leftNum.eq(rightNum)
          return 0;
        },
      );

      // TODO: optimise UTXO selection
      // Accumulate UTXOs until we hit the target value
      let utxos: TXO[] = [];

      // Check if sum of UTXOs selected is greater than target
      while (utxos.reduce(
        (left, right) => left.add(bytes.numberify(right.note.amount)),
        new BN(0),
      ).lt(totalRequired)) {
        // If sum is not greater than target, push the next largest UTXO
        utxos.push(treeBalance.utxos[utxos.length]);
      }

      const fillUTXOs = (length: number) => {
        if (treeBalance.utxos.length < length) {
          // We don't have enough UTXOs to fill desired length
          // Push what we have and fill to length with dummy notes
          utxos = [...treeBalance.utxos];

          while (utxos.length < length) {
            const dummyKey = babyjubjub.seedToPrivateKey(
              bytes.random(32),
            );

            utxos.push({
              tree,
              position: 0,
              index: 0,
              change: false,
              txid: '',
              spendtxid: false,
              dummyKey,
              note: new ERC20Note(
                babyjubjub.privateKeyToPublicKey(
                  dummyKey,
                ),
                babyjubjub.random(),
                '00',
                this.token,
              ),
            });
          }
        } else {
          // We have enough UTXOs to fill to desired length
          // Loop and push from end of available until desired length is achieved
          let cursor = 1;
          while (utxos.length < length) {
            utxos.push(treeBalance.utxos[treeBalance.utxos.length - cursor]);
            cursor += 1;
          }
        }
      };

      if (utxos.length <= 3) {
        fillUTXOs(3);
      } else if (utxos.length <= 11) {
        fillUTXOs(11);
      }

      return utxos;
    });

    // If tree isn't specified, find first tree with a spending solution
    const tree = this.tree || solutions.findIndex((value) => value.length > 0);

    // Check if tree with spending solution exists
    if (tree === -1) throw new Error('Balances need to be consolidated before being able to spend this amount');

    // Check if withdraw address isn't set when it should be
    if (this.withdraw.gtn(0) && this.withdrawAddress === undefined) throw new Error('Withdraw address not set');

    // Check if withdraw address is set when it shouldn't be
    if (this.withdraw.eqn(0) && this.withdrawAddress !== undefined) throw new Error('Withdraw shouldn\'t be set');

    // Get values
    const spendingKeys: bytes.BytesData[] = [];
    const nullifiers: bytes.BytesData[] = [];
    const pathElements: bytes.BytesData[][] = [];
    const pathIndices: bytes.BytesData[] = [];

    for (let i = 0; i < solutions[tree].length; i += 1) {
      // Get UTXO
      const utxo = solutions[tree][i];

      // Get private key (or dummy key if dummy note)
      const privateKey = utxo.dummyKey || wallet.getKeypair(
        encryptionKey, utxo.index, utxo.change, this.chainID,
      ).privateKey;

      // Push spending key and nullifier
      spendingKeys.push(privateKey);
      nullifiers.push(ERC20Note.getNullifier(privateKey, tree, 0));

      // Push path elements
      if (utxo.dummyKey) {
        pathElements.push(new Array(depths.erc20).fill('00'));
      } else {
        pathElements.push(
          // eslint-disable-next-line no-await-in-loop
          (await wallet.merkletree[this.chainID].getProof(tree, utxo.index)).elements,
        );
      }

      // Push path indicies
      pathIndices.push(new BN(utxo.position));
    }

    // Calculate change amount
    const totalIn = solutions[tree]
      .reduce((left, right) => left.add(bytes.numberify(right.note.amount)), new BN(0))
      .add(this.deposit);

    const totalOut = this.outputs
      .reduce((left, right) => left.add(bytes.numberify(right.amount)), new BN(0))
      .add(this.withdraw);

    const change = totalIn.sub(totalOut);

    // Generate output commitments
    const commitments: ERC20Note[] = [...this.outputs];

    // Create change output
    commitments.push(new ERC20Note(
      wallet.getKeypair(encryptionKey, 0, true).publicKey,
      babyjubjub.random(),
      change,
      this.token,
    ));

    // Pad with dummy notes to outputs length
    while (commitments.length < 3) {
      commitments.push(new ERC20Note(
        babyjubjub.privateKeyToPublicKey(babyjubjub.seedToPrivateKey(
          bytes.random(32),
        )),
        babyjubjub.random(),
        change,
        this.token,
      ));
    }

    // Calculate ciphertext
    const ciphertext = commitments.map((commitment) => {
      const senderPrivateKey = babyjubjub.seedToPrivateKey(bytes.random(32));
      const senderPublicKey = babyjubjub.privateKeyToPublicKey(senderPrivateKey);
      const sharedKey = babyjubjub.ecdh(senderPrivateKey, commitment.publicKey);
      const encrypted = commitment.encrypt(sharedKey);

      return {
        senderPublicKey,
        ciphertext: [
          encrypted.iv,
          ...encrypted.data,
        ],
      };
    });

    // Calculate ciphertext hash
    const ciphertextHash = hash.sha256(bytes.combine(
      ciphertext.map((commitment) => [
        ...babyjubjub.unpackPoint(commitment.senderPublicKey),
        ...commitment.ciphertext,
      ]).flat(2).map((value) => bytes.padToLength(value, 32)),
    ));

    // Format inputs
    const inputs: ERC20PrivateInputs = {
      type: 'erc20',
      adaptID: this.adaptIDhash,
      tokenField: this.token,
      depositAmount: this.deposit,
      withdrawAmount: this.withdraw,
      outputTokenField: this.deposit.gtn(0) || this.withdraw.gtn(0)
        ? this.token
        : '00',
      outputEthAddress: this.withdrawAddress || '00',
      randomIn: solutions[tree].map((utxo) => utxo.note.random),
      valuesIn: solutions[tree].map((utxo) => utxo.note.amount),
      spendingKeys,
      treeNumber: new BN(tree),
      merkleRoot: await wallet.merkletree[this.chainID].getRoot(tree),
      nullifiers,
      pathElements,
      pathIndices,
      recipientPK: commitments.map((output) => output.publicKey),
      randomOut: commitments.map((output) => output.random),
      valuesOut: commitments.map((output) => output.amount),
      commitmentsOut: commitments.map((output) => output.hash),
      ciphertextHash,
    };

    return {
      inputs,
      commitments: commitments.map((commitment, index) => ({
        hash: commitment.hash,
        ciphertext: ciphertext[index].ciphertext,
        senderPublicKey: ciphertext[index].senderPublicKey,
      })),
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
    encryptionKey: bytes.BytesData,
  ): Promise<ERC20TransactionSerialized> {
    // Get inputs
    const inputs = await this.generateInputs(wallet, encryptionKey);

    // Calculate proof
    const proof = inputs.inputs.nullifiers.length === 3
      ? await prover.prove('erc20small', inputs.inputs)
      : await prover.prove('erc20large', inputs.inputs);

    return {
      proof: proof.proof,
      adaptID: this.adaptID,
      deposit: this.deposit,
      withdraw: this.withdraw,
      token: this.token,
      withdrawAddress: this.withdrawAddress || '00',
      tree: inputs.inputs.treeNumber,
      merkleroot: inputs.inputs.merkleRoot,
      nullifiers: inputs.inputs.nullifiers,
      commitments: inputs.commitments,
    };
  }
}

export { ERC20Transaction };
