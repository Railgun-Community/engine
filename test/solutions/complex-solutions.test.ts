/* eslint-disable no-unused-expressions */
/* globals describe it */

import { expect } from 'chai';
import {
  nextNullifierTarget,
  shouldAddMoreUTXOsForSolutionBatch,
} from '../../src/solutions/complex-solutions';

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
});
