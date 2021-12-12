import BN from 'bn.js';
import { ERC20Note } from '../note';
import { hash, bytes, babyjubjub } from '../utils';
import { Wallet, TXO } from '../wallet';
// import type { ERC20Inputs } from '../prover';

export type AdaptID = {
  contract: bytes.BytesData,
  parameters: bytes.BytesData,
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
  async generateInputs(wallet: Wallet, encryptionKey: bytes.BytesData) {
    // Calculate total required to be supplied by UTXOs
    const totalRequired = this.outputs
      .reduce((left, right) => left.add(bytes.numberify(right.amount)), new BN(0))
      .add(this.withdraw)
      .sub(this.deposit);

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
    const solutions: (TXO[] | false)[] = treeSortedBalances.map((treeBalance, tree) => {
      // If this tree doesn't have enough to cover this transaction, return false
      if (treeBalance.balance.lt(totalRequired)) return false;

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
            utxos.push({
              tree,
              position: -1,
              index: -1,
              change: false,
              txid: '',
              spendtxid: false,
              note: new ERC20Note(
                babyjubjub.privateKeyToPublicKey(
                  babyjubjub.seedToPrivateKey(
                    bytes.random(32),
                  ),
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

    // Find first tree with a spending solution
    const tree = solutions.findIndex((value) => value !== false);

    // Check if tree with spending solution exists
    if (tree === -1) throw new Error('Balances need to be consolidated before being able to spend this amount');

    console.log(treeSortedBalances[0].balance.toNumber());
    console.log(tree);
    console.log(JSON.stringify(solutions, null, '  '));
    console.log(encryptionKey);
  }
}

export { ERC20Transaction };
