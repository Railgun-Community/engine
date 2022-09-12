/* eslint-disable no-unused-expressions */
/* globals describe it */

import { assert, expect } from 'chai';
import { randomBytes } from 'ethers/lib/utils';
import { Lepton, Note } from '../../src';
import {
  createSpendingSolutionGroupsForOutput,
  findNextSolutionBatch,
  nextNullifierTarget,
  shouldAddMoreUTXOsForSolutionBatch,
} from '../../src/solutions/complex-solutions';
import { sortUTXOsBySize } from '../../src/solutions/utxos';
import { TreeBalance, TXO } from '../../src/wallet/abstract-wallet';
import { TransactionBatch } from '../../src/transaction/transaction-batch';
import { OutputType, TokenType } from '../../src/models/formatted-types';
import { AddressData } from '../../src/keyderivation/bech32-encode';
import { extractSpendingSolutionGroupsData } from '../../src/solutions/spending-group-extractor';
import { randomHex } from '../../src/utils/bytes';
import { getPublicViewingKey } from '../../src/utils/keys-utils';
import { ViewingKeyPair } from '../../src/keyderivation/wallet-node';

const addressData1 = Lepton.decodeAddress(
  '0zk1qyqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqunpd9kxwatwqyqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqhshkca',
);
const addressData2 = Lepton.decodeAddress(
  '0zk1qyqqqqdl645pcpreh6dga7xa3w4dm9c3tzv6ntesk0fy2kzr476pkunpd9kxwatw8qqqqqdl645pcpreh6dga7xa3w4dm9c3tzv6ntesk0fy2kzr476pkcsu8tp',
);
const addressData3 = Lepton.decodeAddress(
  '0zk1q8hxknrs97q8pjxaagwthzc0df99rzmhl2xnlxmgv9akv32sua0kfrv7j6fe3z53llhxknrs97q8pjxaagwthzc0df99rzmhl2xnlxmgv9akv32sua0kg0zpzts',
);

const TOKEN_ADDRESS = 'abc';
const CHAIN_ID = 1;

const createMockNote = async (addressData: AddressData, value: bigint) => {
  const privateViewingKey = randomBytes(32);
  const publicViewingKey = await getPublicViewingKey(privateViewingKey);
  const viewingKeyPair: ViewingKeyPair = {
    privateKey: privateViewingKey,
    pubkey: publicViewingKey,
  };
  const senderBlindingKey = randomHex(15);

  return Note.create(
    addressData,
    randomHex(16),
    value,
    TOKEN_ADDRESS,
    viewingKeyPair,
    senderBlindingKey,
    OutputType.Transfer,
    undefined, // memoText
  );
};

const createMockTXO = async (txid: string, value: bigint): Promise<TXO> => {
  const note = await createMockNote(addressData1, value);
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

  it('Should create next solution batch from utxos (5)', async () => {
    const treeBalance1: TreeBalance = {
      balance: BigInt(150),
      utxos: [
        await createMockTXO('a', BigInt(30)),
        await createMockTXO('b', BigInt(40)),
        await createMockTXO('c', BigInt(50)),
        await createMockTXO('d', BigInt(10)),
        await createMockTXO('e', BigInt(20)),
        await createMockTXO('f', BigInt(0)),
      ],
    };

    const utxosForSort = [...treeBalance1.utxos];
    expect(utxosForSort.map((utxo) => utxo.txid)).to.deep.equal(['a', 'b', 'c', 'd', 'e', 'f']);
    sortUTXOsBySize(utxosForSort);
    expect(utxosForSort.map((utxo) => utxo.txid)).to.deep.equal(['c', 'b', 'a', 'e', 'd', 'f']);

    // More than balance. No excluded txids.
    const solutionBatch1 = findNextSolutionBatch(treeBalance1, BigInt(180), []);
    assert(solutionBatch1 != null);
    expect(solutionBatch1.map((utxo) => utxo.txid)).to.deep.equal(['c', 'b']);

    // More than balance. Exclude txids.
    const solutionBatch2 = findNextSolutionBatch(treeBalance1, BigInt(180), ['a', 'b']);
    assert(solutionBatch2 != null);
    expect(solutionBatch2.map((utxo) => utxo.txid)).to.deep.equal(['c', 'e']);

    // Less than balance. Exclude txids.
    const solutionBatch3 = findNextSolutionBatch(treeBalance1, BigInt(10), ['a', 'b']);
    assert(solutionBatch3 != null);
    expect(solutionBatch3.map((utxo) => utxo.txid)).to.deep.equal(['c']);

    // Less than balance. Exact match would be 4 UTXOs, which is not an allowed Nullifer count. Most optimal would be b + c.
    const solutionBatch4 = findNextSolutionBatch(treeBalance1, BigInt(120), []);
    assert(solutionBatch4 != null);
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

  it('Should create next solution batch from utxos (9)', async () => {
    const treeBalance1: TreeBalance = {
      balance: BigInt(450),
      utxos: [
        await createMockTXO('a', BigInt(30)),
        await createMockTXO('b', BigInt(40)),
        await createMockTXO('c', BigInt(50)),
        await createMockTXO('d', BigInt(10)),
        await createMockTXO('e', BigInt(20)),
        await createMockTXO('f', BigInt(60)),
        await createMockTXO('g', BigInt(70)),
        await createMockTXO('h', BigInt(80)),
        await createMockTXO('i', BigInt(90)),
      ],
    };

    // More than balance. No excluded txids.
    const solutionBatch1 = findNextSolutionBatch(treeBalance1, BigInt(500), []);
    assert(solutionBatch1 != null);
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
    assert(solutionBatch2 != null);
    expect(solutionBatch2.map((utxo) => utxo.txid)).to.deep.equal(['h']);
  });

  it('Should create spending solution groups for various outputs', async () => {
    const treeBalance0: TreeBalance = {
      balance: BigInt(20),
      utxos: [
        await createMockTXO('aa', BigInt(20)),
        await createMockTXO('ab', BigInt(0)),
        await createMockTXO('ac', BigInt(0)),
      ],
    };
    const treeBalance1: TreeBalance = {
      balance: BigInt(450),
      utxos: [
        await createMockTXO('a', BigInt(30)),
        await createMockTXO('b', BigInt(40)),
        await createMockTXO('c', BigInt(50)),
        await createMockTXO('d', BigInt(10)),
        await createMockTXO('e', BigInt(20)),
        await createMockTXO('f', BigInt(60)),
        await createMockTXO('g', BigInt(70)),
        await createMockTXO('h', BigInt(80)),
        await createMockTXO('i', BigInt(90)),
      ],
    };

    const sortedTreeBalances = [treeBalance0, treeBalance1];

    // Case 1.
    const remainingOutputs1: Note[] = [
      await createMockNote(addressData1, BigInt(80)),
      await createMockNote(addressData2, BigInt(70)),
      await createMockNote(addressData3, BigInt(60)),
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
        outputAddressDatas: [addressData1],
      },
      {
        utxoTxids: ['i'],
        utxoValues: [90n],
        outputValues: [60n],
        outputAddressDatas: [addressData1],
      },
    ]);

    // Case 2.
    const remainingOutputs2: Note[] = [
      await createMockNote(addressData1, BigInt(150)),
      await createMockNote(addressData2, BigInt(70)),
      await createMockNote(addressData3, BigInt(60)),
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
        outputAddressDatas: [addressData1],
      },
      {
        utxoTxids: ['i', 'h'],
        utxoValues: [90n, 80n],
        outputValues: [130n],
        outputAddressDatas: [addressData1],
      },
    ]);

    // Case 3.
    const remainingOutputs3: Note[] = [await createMockNote(addressData1, BigInt(500))];
    expect(() =>
      createSpendingSolutionGroupsForOutput(
        sortedTreeBalances,
        remainingOutputs3[0],
        remainingOutputs3,
        [],
      ),
    ).to.throw(
      'This transaction requires a complex circuit for multi-sending, which is not supported by RAILGUN at this time. Select a different Relayer fee token or send tokens to a single address to resolve.',
    );
  });

  it('Should create complex spending solution groups for transaction batch', async () => {
    const treeBalance0: TreeBalance = {
      balance: BigInt(20),
      utxos: [
        await createMockTXO('aa', BigInt(20)),
        await createMockTXO('ab', BigInt(0)),
        await createMockTXO('ac', BigInt(0)),
      ],
    };
    const treeBalance1: TreeBalance = {
      balance: BigInt(450),
      utxos: [
        await createMockTXO('a', BigInt(30)),
        await createMockTXO('b', BigInt(40)),
        await createMockTXO('c', BigInt(50)),
        await createMockTXO('d', BigInt(10)),
        await createMockTXO('e', BigInt(20)),
        await createMockTXO('f', BigInt(60)),
        await createMockTXO('g', BigInt(70)),
        await createMockTXO('h', BigInt(80)),
        await createMockTXO('i', BigInt(90)),
      ],
    };

    const sortedTreeBalances = [treeBalance0, treeBalance1];

    // Case 1.
    const transactionBatch1 = new TransactionBatch(TOKEN_ADDRESS, TokenType.ERC20, CHAIN_ID);
    const outputs1: Note[] = [
      await createMockNote(addressData1, BigInt(80)),
      await createMockNote(addressData2, BigInt(70)),
      await createMockNote(addressData3, BigInt(60)),
    ];
    outputs1.forEach((output) => transactionBatch1.addOutput(output));
    const spendingSolutionGroups1 =
      transactionBatch1.createComplexSatisfyingSpendingSolutionGroups(sortedTreeBalances);
    const extractedData1 = extractSpendingSolutionGroupsData(spendingSolutionGroups1);
    expect(extractedData1).to.deep.equal([
      {
        utxoTxids: ['aa', 'ab'],
        utxoValues: [20n, 0n],
        outputValues: [20n],
        outputAddressDatas: [addressData1],
      },
      {
        utxoTxids: ['i'],
        utxoValues: [90n],
        outputValues: [60n],
        outputAddressDatas: [addressData1],
      },
      {
        utxoTxids: ['h'],
        utxoValues: [80n],
        outputValues: [70n],
        outputAddressDatas: [addressData2],
      },
      {
        utxoTxids: ['g'],
        utxoValues: [70n],
        outputValues: [60n],
        outputAddressDatas: [addressData3],
      },
    ]);
  });
});
