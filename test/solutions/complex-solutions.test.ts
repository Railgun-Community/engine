/* eslint-disable no-unused-expressions */
/* globals describe it */

import { expect } from 'chai';
import { Lepton, Note } from '../../src';
import { SpendingSolutionGroup } from '../../src/models/txo-types';
import {
  createSpendingSolutionGroupsForOutput,
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

const createMockNote = (value: bigint) => {
  const token = 'abc';
  return new Note(addressData, bytes.random(16), value, token);
};

const createMockTXO = (txid: string, value: bigint): TXO => {
  const note = createMockNote(value);
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

  it('Should create next solution batch from utxos (5)', () => {
    const treeBalance1: TreeBalance = {
      balance: BigInt(150),
      utxos: [
        createMockTXO('a', BigInt(30)),
        createMockTXO('b', BigInt(40)),
        createMockTXO('c', BigInt(50)),
        createMockTXO('d', BigInt(10)),
        createMockTXO('e', BigInt(20)),
        createMockTXO('f', BigInt(0)),
      ],
    };

    const utxosForSort = [...treeBalance1.utxos];
    expect(utxosForSort.map((utxo) => utxo.txid)).to.deep.equal(['a', 'b', 'c', 'd', 'e', 'f']);
    sortUTXOsBySize(utxosForSort);
    expect(utxosForSort.map((utxo) => utxo.txid)).to.deep.equal(['c', 'b', 'a', 'e', 'd', 'f']);

    // More than balance. No excluded txids.
    const solutionBatch1 = findNextSolutionBatch(treeBalance1, BigInt(180), []);
    expect(solutionBatch1.map((utxo) => utxo.txid)).to.deep.equal(['c', 'b']);

    // More than balance. Exclude txids.
    const solutionBatch2 = findNextSolutionBatch(treeBalance1, BigInt(180), ['a', 'b']);
    expect(solutionBatch2.map((utxo) => utxo.txid)).to.deep.equal(['c', 'e']);

    // Less than balance. Exclude txids.
    const solutionBatch3 = findNextSolutionBatch(treeBalance1, BigInt(10), ['a', 'b']);
    expect(solutionBatch3.map((utxo) => utxo.txid)).to.deep.equal(['c']);

    // Less than balance. Exact match would be 4 UTXOs, which is not an allowed Nullifer count. Most optimal would be b + c.
    const solutionBatch4 = findNextSolutionBatch(treeBalance1, BigInt(120), []);
    expect(solutionBatch4.map((utxo) => utxo.txid)).to.deep.equal(['c', 'b']);

    // No utxos available.
    const solutionBatch5 = findNextSolutionBatch(treeBalance1, BigInt(120), [
      'a',
      'b',
      'c',
      'd',
      'e',
      'f',
    ]);
    expect(solutionBatch5).to.equal(undefined);

    // Only a 0 txo available.
    const solutionBatch6 = findNextSolutionBatch(treeBalance1, BigInt(120), [
      'a',
      'b',
      'c',
      'd',
      'e',
    ]);
    expect(solutionBatch6).to.equal(undefined);
  });

  it('Should create next solution batch from utxos (9)', () => {
    const treeBalance1: TreeBalance = {
      balance: BigInt(450),
      utxos: [
        createMockTXO('a', BigInt(30)),
        createMockTXO('b', BigInt(40)),
        createMockTXO('c', BigInt(50)),
        createMockTXO('d', BigInt(10)),
        createMockTXO('e', BigInt(20)),
        createMockTXO('f', BigInt(60)),
        createMockTXO('g', BigInt(70)),
        createMockTXO('h', BigInt(80)),
        createMockTXO('i', BigInt(90)),
      ],
    };

    // More than balance. No excluded txids.
    const solutionBatch1 = findNextSolutionBatch(treeBalance1, BigInt(500), []);
    expect(solutionBatch1.map((utxo) => utxo.txid)).to.deep.equal([
      'i',
      'h',
      'g',
      'f',
      'c',
      'b',
      'a',
      'e',
      // NOTE: no "d" which is the smallest.
    ]);

    // Less than balance. Exclude biggest utxo.
    const solutionBatch2 = findNextSolutionBatch(treeBalance1, BigInt(48), ['i']);
    expect(solutionBatch2.map((utxo) => utxo.txid)).to.deep.equal(['h']);
  });

  it('Should create spending solution groups for various outputs', () => {
    const treeBalance0: TreeBalance = {
      balance: BigInt(20),
      utxos: [
        createMockTXO('aa', BigInt(20)),
        createMockTXO('ab', BigInt(0)),
        createMockTXO('ac', BigInt(0)),
      ],
    };
    const treeBalance1: TreeBalance = {
      balance: BigInt(450),
      utxos: [
        createMockTXO('a', BigInt(30)),
        createMockTXO('b', BigInt(40)),
        createMockTXO('c', BigInt(50)),
        createMockTXO('d', BigInt(10)),
        createMockTXO('e', BigInt(20)),
        createMockTXO('f', BigInt(60)),
        createMockTXO('g', BigInt(70)),
        createMockTXO('h', BigInt(80)),
        createMockTXO('i', BigInt(90)),
      ],
    };

    const sortedTreeBalances = [treeBalance0, treeBalance1];

    const extractSpendingSolutionGroupsData = (
      spendingSolutionGroups: SpendingSolutionGroup[],
    ): { utxoTxids: string[]; utxoValues: bigint[]; outputValues: bigint[] }[] => {
      return spendingSolutionGroups.map((spendingSolutionGroup) => ({
        utxoTxids: spendingSolutionGroup.utxos.map((utxo) => utxo.txid),
        utxoValues: spendingSolutionGroup.utxos.map((utxo) => utxo.note.value),
        outputValues: spendingSolutionGroup.outputs.map((note) => note.value),
      }));
    };

    // Case 1.
    const remainingOutputs1: Note[] = [
      createMockNote(BigInt(80)),
      createMockNote(BigInt(70)),
      createMockNote(BigInt(60)),
    ];
    const spendingSolutionGroups1 = createSpendingSolutionGroupsForOutput(
      sortedTreeBalances,
      remainingOutputs1[0],
      remainingOutputs1,
      [],
    );
    // Ensure the 80 output was removed.
    expect(remainingOutputs1.map((note) => note.value)).to.deep.equal([BigInt(70), BigInt(60)]);
    const extractedData1 = extractSpendingSolutionGroupsData(spendingSolutionGroups1);
    expect(extractedData1).to.deep.equal([
      {
        utxoTxids: ['aa', 'ab'],
        utxoValues: [20n, 0n],
        outputValues: [20n],
      },
      {
        utxoTxids: ['i'],
        utxoValues: [90n],
        outputValues: [60n],
      },
    ]);

    // Case 2.
    const remainingOutputs2: Note[] = [
      createMockNote(BigInt(150)),
      createMockNote(BigInt(70)),
      createMockNote(BigInt(60)),
    ];
    const spendingSolutionGroups2 = createSpendingSolutionGroupsForOutput(
      sortedTreeBalances,
      remainingOutputs2[0],
      remainingOutputs2,
      [],
    );
    // Ensure the 80 output was removed.
    expect(remainingOutputs2.map((note) => note.value)).to.deep.equal([BigInt(70), BigInt(60)]);
    const extractedData2 = extractSpendingSolutionGroupsData(spendingSolutionGroups2);
    expect(extractedData2).to.deep.equal([
      {
        utxoTxids: ['aa', 'ab'],
        utxoValues: [20n, 0n],
        outputValues: [20n],
      },
      {
        utxoTxids: ['i', 'h'],
        utxoValues: [90n, 80n],
        outputValues: [130n],
      },
    ]);

    // Case 3.
    const remainingOutputs3: Note[] = [createMockNote(BigInt(500))];
    expect(() =>
      createSpendingSolutionGroupsForOutput(
        sortedTreeBalances,
        remainingOutputs3[0],
        remainingOutputs3,
        [],
      ),
    ).to.throw(
      'Please consolidate balances before multi-sending. Send tokens to one destination address at a time to resolve.',
    );
  });
});
