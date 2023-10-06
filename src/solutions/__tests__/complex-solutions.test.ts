import { assert, expect } from 'chai';
import { randomBytes } from 'ethers';
import {
  createSpendingSolutionsForValue,
  findNextSolutionBatch,
  nextNullifierTarget,
  shouldAddMoreUTXOsForSolutionBatch,
} from '../complex-solutions';
import { filterZeroUTXOs, sortUTXOsByAscendingValue } from '../utxos';
import { TransactionBatch } from '../../transaction/transaction-batch';
import { CommitmentType, OutputType } from '../../models/formatted-types';
import { extractSpendingSolutionGroupsData } from '../spending-group-extractor';
import { randomHex } from '../../utils/bytes';
import { getPublicViewingKey } from '../../utils/keys-utils';
import { ChainType } from '../../models/engine-types';
import { AddressData } from '../../key-derivation/bech32';
import { ViewingKeyPair } from '../../key-derivation/wallet-node';
import { TransactNote } from '../../note/transact-note';
import { RailgunEngine } from '../../railgun-engine';
import { getTokenDataERC20 } from '../../note/note-util';
import { TXO } from '../../models/txo-types';
import { TreeBalance } from '../../models/wallet-types';

const addressData1 = RailgunEngine.decodeAddress(
  '0zk1qyqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqunpd9kxwatwqyqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqhshkca',
);
const addressData2 = RailgunEngine.decodeAddress(
  '0zk1qyqqqqdl645pcpreh6dga7xa3w4dm9c3tzv6ntesk0fy2kzr476pkunpd9kxwatw8qqqqqdl645pcpreh6dga7xa3w4dm9c3tzv6ntesk0fy2kzr476pkcsu8tp',
);
const addressData3 = RailgunEngine.decodeAddress(
  '0zk1q8hxknrs97q8pjxaagwthzc0df99rzmhl2xnlxmgv9akv32sua0kfrv7j6fe3z53llhxknrs97q8pjxaagwthzc0df99rzmhl2xnlxmgv9akv32sua0kg0zpzts',
);

const MOCK_POSITION = 2;

const tokenAddress = '0x5FbDB2315678afecb367f032d93F642f64180aa3';
const tokenData = getTokenDataERC20(tokenAddress);

const CHAIN = {
  type: ChainType.EVM,
  id: 1,
};

const createMockNote = async (addressData: AddressData, value: bigint) => {
  const privateViewingKey = randomBytes(32);
  const publicViewingKey = await getPublicViewingKey(privateViewingKey);
  const viewingKeyPair: ViewingKeyPair = {
    privateKey: privateViewingKey,
    pubkey: publicViewingKey,
  };

  return TransactNote.createTransfer(
    addressData,
    undefined,
    value,
    tokenData,
    viewingKeyPair,
    false, // showSenderAddressToRecipient
    OutputType.Transfer,
    undefined, // memoText
  );
};

const createMockTXO = async (txid: string, value: bigint): Promise<TXO> => {
  const note = await createMockNote(addressData1, value);
  return {
    txid,
    note,
    timestamp: undefined,
    position: MOCK_POSITION,
    tree: 0,
    spendtxid: false,
    poisPerList: undefined,
    blindedCommitment: undefined,
    commitmentType: CommitmentType.TransactCommitment,
    nullifier: randomHex(32),
  };
};

describe('complex-solutions', () => {
  it('Should get valid next nullifier targets', () => {
    expect(nextNullifierTarget(0)).to.equal(1);
    expect(nextNullifierTarget(1)).to.equal(2);
    expect(nextNullifierTarget(2)).to.equal(3);
    expect(nextNullifierTarget(3)).to.equal(4);
    expect(nextNullifierTarget(4)).to.equal(5);
    expect(nextNullifierTarget(5)).to.equal(6);
    expect(nextNullifierTarget(6)).to.equal(7);
    expect(nextNullifierTarget(7)).to.equal(8);
    expect(nextNullifierTarget(8)).to.equal(9);
    expect(nextNullifierTarget(9)).to.equal(10);
    expect(nextNullifierTarget(10)).to.equal(undefined);
  });

  it('Should determine whether to add utxos to solution batch', () => {
    const lowAmount = BigInt(999);
    const exactAmount = BigInt(1000);
    const highAmount = BigInt(1001);
    const totalRequired = BigInt(1000);

    // Hit exact total amount. Valid. [ALL SET]
    expect(shouldAddMoreUTXOsForSolutionBatch(1, 5, exactAmount, totalRequired)).to.equal(false);

    // Higher than total amount. Valid. [ALL SET]
    expect(shouldAddMoreUTXOsForSolutionBatch(3, 5, highAmount, totalRequired)).to.equal(false);

    // Lower than total amount. Valid nullifier amount. [NEED MORE]
    expect(shouldAddMoreUTXOsForSolutionBatch(3, 8, lowAmount, totalRequired)).to.equal(true);

    // Lower than total amount. Invalid nullifier amount. Next is not reachable. [ALL SET]
    expect(shouldAddMoreUTXOsForSolutionBatch(10, 11, lowAmount, totalRequired)).to.equal(false);
  });

  it('Should create next solution batch from utxos (6)', async () => {
    const treeBalance1: TreeBalance = {
      balance: BigInt(150),
      tokenData,
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

    const filteredZeroes = filterZeroUTXOs(utxosForSort);
    expect(filteredZeroes.map((utxo) => utxo.txid)).to.deep.equal(['a', 'b', 'c', 'd', 'e']);

    sortUTXOsByAscendingValue(utxosForSort);
    expect(utxosForSort.map((utxo) => utxo.txid)).to.deep.equal(['f', 'd', 'e', 'a', 'b', 'c']);

    // More than balance. No excluded txids.
    const solutionBatch1 = findNextSolutionBatch(treeBalance1, BigInt(180), []);
    assert(solutionBatch1 != null);
    expect(solutionBatch1.map((utxo) => utxo.txid)).to.deep.equal(['d', 'e', 'a', 'b', 'c']);

    // More than balance. Exclude txids.
    const solutionBatch2 = findNextSolutionBatch(treeBalance1, BigInt(180), ['a-2', 'b-2']);
    assert(solutionBatch2 != null);
    expect(solutionBatch2.map((utxo) => utxo.txid)).to.deep.equal(['d', 'e', 'c']);

    // Less than balance. Exclude txids.
    const solutionBatch3 = findNextSolutionBatch(treeBalance1, BigInt(9), ['a-2', 'b-2']);
    assert(solutionBatch3 != null);
    expect(solutionBatch3.map((utxo) => utxo.txid)).to.deep.equal(['d']);

    // Less than balance. Most optimal is 4 UTXOs to consolidate balances.
    const solutionBatch4 = findNextSolutionBatch(treeBalance1, BigInt(90), []);
    assert(solutionBatch4 != null);
    expect(solutionBatch4.map((utxo) => utxo.txid)).to.deep.equal(['d', 'e', 'a', 'b']);

    // No utxos available.
    const solutionBatch5 = findNextSolutionBatch(treeBalance1, BigInt(120), [
      'a-2',
      'b-2',
      'c-2',
      'd-2',
      'e-2',
      'f-2',
    ]);
    expect(solutionBatch5).to.equal(undefined);

    // Only a 0 txo available.
    const solutionBatch6 = findNextSolutionBatch(treeBalance1, BigInt(120), [
      'a-2',
      'b-2',
      'c-2',
      'd-2',
      'e-2',
    ]);
    expect(solutionBatch6).to.equal(undefined);
  });

  it('Should create next solution batch from utxos (11)', async () => {
    const treeBalance1: TreeBalance = {
      balance: BigInt(660),
      tokenData,
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
        await createMockTXO('j', BigInt(100)),
        await createMockTXO('k', BigInt(110)),
      ],
    };

    // Case 1: More than balance. No excluded txids.
    const solutionBatch1 = findNextSolutionBatch(treeBalance1, BigInt(500), []);
    assert(solutionBatch1 != null);
    expect(solutionBatch1.map((utxo) => utxo.txid)).to.deep.equal([
      'd',
      'e',
      'a',
      'b',
      'c',
      'f',
      'g',
      'h',
      'i',
      'j',
      // NOTE: no "k" which is the largest and #11, but we only include 10 UTXOs per batch.
    ]);

    // Case 2: Less than balance. Exclude smallest utxo.
    const solutionBatch2 = findNextSolutionBatch(treeBalance1, BigInt(58), ['d-2']);
    assert(solutionBatch2 != null);
    expect(solutionBatch2.map((utxo) => utxo.txid)).to.deep.equal(['e', 'a', 'b']);
  });

  it('Should create spending solution groups for various outputs', async () => {
    const treeBalance0: TreeBalance = {
      balance: BigInt(20),
      tokenData,
      utxos: [
        await createMockTXO('aa', BigInt(20)),
        await createMockTXO('ab', BigInt(0)),
        await createMockTXO('ac', BigInt(0)),
      ],
    };
    const treeBalance1: TreeBalance = {
      balance: BigInt(450),
      tokenData,
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
        await createMockTXO('j', BigInt(0)),
      ],
    };

    const sortedTreeBalances = [treeBalance0, treeBalance1];

    // Case 0.
    const remainingOutputs0: TransactNote[] = [await createMockNote(addressData1, 0n)];
    const spendingSolutionGroups0 = createSpendingSolutionsForValue(
      sortedTreeBalances,
      remainingOutputs0,
      [],
      false, // isUnshield
    );
    // Ensure the 0n output was removed.
    expect(remainingOutputs0.map((note) => note.value)).to.deep.equal([]);
    const extractedData0 = extractSpendingSolutionGroupsData(spendingSolutionGroups0);
    expect(extractedData0).to.deep.equal([
      {
        outputAddressDatas: [
          {
            chain: CHAIN,
            masterPublicKey: 0n,
            viewingPublicKey: new Uint8Array([
              0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
              0, 0, 0,
            ]),
            version: 1,
          },
        ],
        utxoValues: [0n],
        outputValues: [0n],
        tokenData,
        utxoTxids: ['0x0000000000000000000000000000000000000000000000000000000000000000'],
      },
    ]);

    // Case 1.
    const remainingOutputs1: TransactNote[] = [
      await createMockNote(addressData1, 79n),
      await createMockNote(addressData2, 70n),
      await createMockNote(addressData3, 60n),
    ];
    const spendingSolutionGroups1 = createSpendingSolutionsForValue(
      sortedTreeBalances,
      remainingOutputs1,
      [],
      false, // isUnshield
    );
    // Ensure the 79n output was removed.
    // 69n output is 70n - 1n ... change from secondary output.
    expect(remainingOutputs1.map((note) => note.value)).to.deep.equal([69n, 60n]);
    const extractedData1 = extractSpendingSolutionGroupsData(spendingSolutionGroups1);
    expect(extractedData1).to.deep.equal([
      {
        utxoTxids: ['aa'],
        utxoValues: [20n],
        outputValues: [20n],
        outputAddressDatas: [addressData1],
        tokenData,
      },
      {
        utxoTxids: ['d', 'e', 'a'], // 60 total
        utxoValues: [10n, 20n, 30n],
        outputValues: [59n, 1n],
        outputAddressDatas: [addressData1, addressData2],
        tokenData,
      },
    ]);

    // Case 2.
    const remainingOutputs2: TransactNote[] = [
      await createMockNote(addressData1, BigInt(150)),
      await createMockNote(addressData2, BigInt(70)),
      await createMockNote(addressData3, BigInt(60)),
    ];
    const spendingSolutionGroups2 = createSpendingSolutionsForValue(
      sortedTreeBalances,
      remainingOutputs2,
      [],
      false, // isUnshield
    );
    // Ensure the 150 output was removed.
    expect(remainingOutputs2.map((note) => note.value)).to.deep.equal([50n, 60n]);
    const extractedData2 = extractSpendingSolutionGroupsData(spendingSolutionGroups2);
    expect(extractedData2).to.deep.equal([
      {
        utxoTxids: ['aa'],
        utxoValues: [20n],
        outputValues: [20n],
        outputAddressDatas: [addressData1],
        tokenData,
      },
      {
        utxoTxids: ['d', 'e', 'a', 'b', 'c'],
        utxoValues: [10n, 20n, 30n, 40n, 50n], // 150 total
        outputValues: [130n, 20n],
        outputAddressDatas: [addressData1, addressData2],
        tokenData,
      },
    ]);

    // Case 3.
    // totalRequired exceeds tree balance, which should be caught earlier in the process (Balance Too Low error when originally creating tx batch).
    // If we hit this case, there is a consolidate balance error.
    const remainingOutputs3: TransactNote[] = [await createMockNote(addressData1, BigInt(500))];
    expect(() =>
      createSpendingSolutionsForValue(
        sortedTreeBalances,
        remainingOutputs3,
        [],
        false, // isUnshield
      ),
    ).to.throw('Balance too low: requires additional UTXOs to satisfy spending solution.');
  });

  it('Should create complex spending solution groups for transaction batch', async () => {
    const treeBalance0: TreeBalance = {
      balance: BigInt(100),
      tokenData,
      utxos: [
        await createMockTXO('aa', BigInt(20)),
        await createMockTXO('ab', BigInt(0)),
        await createMockTXO('ac', BigInt(80)), // 80 on this one to test a perfect match
      ],
    };
    const treeBalance1: TreeBalance = {
      balance: BigInt(450),
      tokenData,
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
    const transactionBatch1 = new TransactionBatch(CHAIN);
    const outputs1: TransactNote[] = [
      await createMockNote(addressData1, 80n),
      await createMockNote(addressData1, 92n),
      await createMockNote(addressData2, 70n),
      await createMockNote(addressData3, 65n),
    ];
    outputs1.forEach((output) => transactionBatch1.addOutput(output));
    const tokenOutputs = outputs1; // filtered by token
    const spendingSolutionGroups1 = transactionBatch1.createComplexSatisfyingSpendingSolutionGroups(
      tokenData,
      tokenOutputs,
      sortedTreeBalances,
    );
    const extractedData1 = extractSpendingSolutionGroupsData(spendingSolutionGroups1);
    expect(extractedData1).to.deep.equal([
      {
        utxoTxids: ['ac'],
        utxoValues: [80n], // exact match
        outputValues: [80n],
        outputAddressDatas: [addressData1],
        tokenData,
      },
      {
        utxoTxids: ['aa'],
        utxoValues: [20n],
        outputValues: [20n],
        outputAddressDatas: [addressData1],
        tokenData,
      },
      {
        utxoTxids: ['d', 'e', 'a', 'b'],
        utxoValues: [10n, 20n, 30n, 40n], // 100 total
        outputValues: [72n, 28n],
        outputAddressDatas: [addressData1, addressData2],
        tokenData,
      },
      {
        utxoTxids: ['c'],
        utxoValues: [50n],
        outputValues: [42n, 8n],
        outputAddressDatas: [addressData2, addressData3],
        tokenData,
      },
      {
        utxoTxids: ['f'],
        utxoValues: [60n],
        outputValues: [57n],
        outputAddressDatas: [addressData3],
        tokenData,
      },
    ]);
  });
});
