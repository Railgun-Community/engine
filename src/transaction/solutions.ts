import { Note } from '../note';
import { babyjubjub } from '../utils';
import { randomPubkey } from '../utils/babyjubjub';
import { TreeBalance, TXO } from '../wallet';
import { NOTE_INPUTS } from './constants';

export function findSolutions(
  token: string,
  treeBalance: TreeBalance,
  tree: number,
  totalRequired: bigint,
): TXO[] {
  // If this tree doesn't have enough to cover this transaction, return false
  if (treeBalance.balance < totalRequired) return [];

  // Sort UTXOs by size
  treeBalance.utxos.sort((left, right) => {
    const leftNum = left.note.value;
    const rightNum = right.note.value;

    if (leftNum < rightNum) return 1;

    if (leftNum > rightNum) return -1;

    // leftNum.eq(rightNum)
    return 0;
  });

  // TODO: optimise UTXO selection
  // Accumulate UTXOs until we hit the target value
  let utxos: TXO[] = [];

  // Check if sum of UTXOs selected is greater than target
  while (utxos.reduce((left, right) => left + right.note.value, BigInt(0)) < totalRequired) {
    // If sum is not greater than target, push the next largest UTXO
    utxos.push(treeBalance.utxos[utxos.length]);
  }

  // @todo store commitment don't worry about hd wallet path
  // @todo generateDeposit send encrypted randomness bundle
  const fillUTXOs = (length: number) => {
    if (treeBalance.utxos.length < length) {
      // We don't have enough UTXOs to fill desired length
      // Push what we have and fill to length with dummy notes
      utxos = [...treeBalance.utxos];

      while (utxos.length < length) {
        const dummyAddress = {
          masterPublicKey: randomPubkey(),
          viewingPublicKey: randomPubkey(),
        };
        utxos.push({
          tree,
          position: 0,
          index: 0,
          txid: '',
          spendtxid: false,
          dummyKey: dummyAddress.masterPublicKey,
          note: new Note(dummyAddress, babyjubjub.random(), '00', token),
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

  if (utxos.length <= NOTE_INPUTS.small) {
    fillUTXOs(NOTE_INPUTS.small);
  } else if (utxos.length <= NOTE_INPUTS.large) {
    fillUTXOs(NOTE_INPUTS.large);
  } else {
    return [];
  }

  return utxos;
}
