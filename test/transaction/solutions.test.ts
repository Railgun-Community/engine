/* eslint-disable no-unused-expressions */
/* globals describe it */

import { expect } from 'chai';
import { PublicInputs } from '../../src/prover';
import { VALID_NULLIFIER_COUNTS } from '../../src/solutions/nullifiers';
import { shouldAddMoreUTXOsToConsolidateBalances } from '../../src/solutions/simple-solutions';
import { artifactsGetter } from '../helper';

describe('Transaction/Solutions', () => {
  it('Should test basic artifacts exist for each valid nullifier', () => {
    VALID_NULLIFIER_COUNTS.forEach((nullifierCount) => {
      // Test that nullifier X 2 artifacts.
      const publicInputs: PublicInputs = {
        nullifiers: new Array(nullifierCount),
        commitmentsOut: new Array(2),
        merkleRoot: 0n,
        boundParamsHash: 0n,
      };
      expect(() => artifactsGetter(publicInputs)).not.to.throw;
    });
    expect(VALID_NULLIFIER_COUNTS);
  });

  it('Should test valid nullifier counts', () => {
    expect(shouldAddMoreUTXOsToConsolidateBalances(0)).to.be.true; // Invalid
    expect(shouldAddMoreUTXOsToConsolidateBalances(1)).to.be.false; // Valid nullifier count
    expect(shouldAddMoreUTXOsToConsolidateBalances(2)).to.be.false; // Valid nullifier count
    expect(shouldAddMoreUTXOsToConsolidateBalances(3)).to.be.true; // Invalid
    expect(shouldAddMoreUTXOsToConsolidateBalances(4)).to.be.true; // Invalid
    expect(shouldAddMoreUTXOsToConsolidateBalances(5)).to.be.true; // Invalid
    expect(shouldAddMoreUTXOsToConsolidateBalances(6)).to.be.true; // Invalid
    expect(shouldAddMoreUTXOsToConsolidateBalances(7)).to.be.true; // Invalid
    expect(shouldAddMoreUTXOsToConsolidateBalances(8)).to.be.false; // Valid nullifier count
    expect(shouldAddMoreUTXOsToConsolidateBalances(9)).to.be.false; // Invalid, but no options above 8
  });
});
