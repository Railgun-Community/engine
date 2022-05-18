/* eslint-disable no-unused-expressions */
/* globals describe it */

import { expect } from 'chai';
import { Lepton, Note } from '../../src';
import { AddressData } from '../../src/keyderivation/bech32-encode';
import {
  findNextSolutionBatch,
  nextNullifierTarget,
  shouldAddMoreUTXOsForSolutionBatch,
} from '../../src/solutions/complex-solutions';
import { sortUTXOsBySize } from '../../src/solutions/utxos';
import { bytes } from '../../src/utils';
import { TreeBalance, TXO } from '../../src/wallet';

const addressData = Lepton.decodeAddress(
  '0zk1qyqqqqdl645pcpreh6dga7xa3w4dm9c3tzv6ntesk0fy2kzr476pkunpd9kxwatw8qqqqqdl645pcpreh6dga7xa3w4dm9c3tzv6ntesk0fy2kzr476pkcsu8tp',
);

const createMockTXO = (txid: string, value: bigint): TXO => {
  const note = new Note(addressData, bytes.random(16), value, 'abc');
  return { txid, note } as TXO;
};

describe('Solutions/Complex Solutions', () => {
  it('Should get valid next nullifier targets', () => {
    expect(nextNullifierTarget(0)).to.equal(1);
    expect(nextNullifierTarget(1)).to.equal(2);
    expect(nextNullifierTarget(2)).to.equal(8);
    expect(nextNullifierTarget(3)).to.equal(8);
    expect(nextNullifierTarget(4)).to.equal(8);
    expect(nextNullifierTarget(5)).to.equal(8);
    expect(nextNullifierTarget(6)).to.equal(8);
    expect(nextNullifierTarget(7)).to.equal(8);
    expect(nextNullifierTarget(8)).to.equal(undefined);
    expect(nextNullifierTarget(9)).to.equal(undefined);
  });

  it('Should determine whether to add utxos to solution batch', () => {
    const lowAmount = BigInt(999);
    const exactAmount = BigInt(1000);
    const highAmount = BigInt(1001);
    const totalRequired = BigInt(1000);

    // Hit exact total amount. Valid nullifier amount. [ALL SET]
    expect(shouldAddMoreUTXOsForSolutionBatch(1, 5, exactAmount, totalRequired)).to.equal(false);

    // Hit total amount. Invalid nullifier amount. [NEED MORE]
    expect(shouldAddMoreUTXOsForSolutionBatch(3, 5, highAmount, totalRequired)).to.equal(true);

    // Lower than total amount. Invalid nullifier amount. [NEED MORE]
    expect(shouldAddMoreUTXOsForSolutionBatch(3, 8, lowAmount, totalRequired)).to.equal(true);

    // Lower than total amount. Invalid nullifier amount. Next is not reachable. [ALL SET - but invalid]
    expect(shouldAddMoreUTXOsForSolutionBatch(3, 5, lowAmount, totalRequired)).to.equal(false);

    // Lower than total amount. Valid nullifier amount. Next is not reachable. [ALL SET]
    expect(shouldAddMoreUTXOsForSolutionBatch(8, 10, lowAmount, totalRequired)).to.equal(false);
  });

  it('Should create next solution batch from utxos', () => {
    const treeBalance1: TreeBalance = {
      balance: BigInt(150),
      utxos: [
        createMockTXO('a', BigInt(30)),
        createMockTXO('b', BigInt(40)),
        createMockTXO('c', BigInt(50)),
        createMockTXO('d', BigInt(10)),
        createMockTXO('e', BigInt(20)),
      ],
    };

    const utxosForSort = [...treeBalance1.utxos];
    expect(utxosForSort.map((utxo) => utxo.txid)).to.deep.equal(['a', 'b', 'c', 'd', 'e']);
    sortUTXOsBySize(utxosForSort);
    expect(utxosForSort.map((utxo) => utxo.txid)).to.deep.equal(['c', 'b', 'a', 'e', 'd']);

    // More than required. No excluded txids.
    const solutionBatch1 = findNextSolutionBatch(treeBalance1, BigInt(180), []);
    expect(solutionBatch1.map((utxo) => utxo.txid)).to.deep.equal(['c', 'b']);

    // More than required. Exclude txids.
    const solutionBatch2 = findNextSolutionBatch(treeBalance1, BigInt(180), ['a', 'b']);
    expect(solutionBatch2.map((utxo) => utxo.txid)).to.deep.equal(['c', 'e']);

    // Less than required. Exclude txids.
    const solutionBatch3 = findNextSolutionBatch(treeBalance1, BigInt(10), ['a', 'b']);
    expect(solutionBatch3.map((utxo) => utxo.txid)).to.deep.equal(['c']);

    // Less than required. Exact match would be 4 UTXOs, which is not an allowed Nullifer count. Most optimal would be b + c.
    const solutionBatch4 = findNextSolutionBatch(treeBalance1, BigInt(120), []);
    expect(solutionBatch4.map((utxo) => utxo.txid)).to.deep.equal(['c', 'b']);

    // No utxos available.
    const solutionBatch5 = findNextSolutionBatch(treeBalance1, BigInt(120), [
      'a',
      'b',
      'c',
      'd',
      'e',
    ]);
    expect(solutionBatch5).to.equal(undefined);
  });
});
