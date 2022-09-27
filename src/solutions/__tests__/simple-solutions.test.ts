/* eslint-disable no-unused-expressions */
import { expect } from 'chai';
import { PublicInputs } from '../../prover/types';
import { artifactsGetter } from '../../test/helper.test';
import { VALID_NULLIFIER_COUNTS } from '../nullifiers';
import { shouldAddMoreUTXOsToConsolidateBalances } from '../simple-solutions';

describe('Solutions/Simple Solutions', () => {
  it('Should test basic artifacts exist for each valid nullifier', () => {
    VALID_NULLIFIER_COUNTS.forEach((nullifierCount) => {
      // Test that nullifier X 2 artifacts.
      const publicInputs: PublicInputs = {
        nullifiers: new Array<bigint>(nullifierCount),
        commitmentsOut: new Array<bigint>(2n),
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
