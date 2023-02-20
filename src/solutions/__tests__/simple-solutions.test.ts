/* eslint-disable no-unused-expressions */
import { expect } from 'chai';
import { PublicInputs } from '../../models/prover-types';
import { artifactExists, artifactGetter } from '../../test/helper.test';
import { VALID_INPUT_COUNTS, VALID_OUTPUT_COUNTS } from '../nullifiers';

describe('Solutions/Simple Solutions', () => {
  it('Should test basic artifacts exist for each valid input/output', async () => {
    const invalidNullifiers = 1;
    const invalidCommitments = 6;
    expect(artifactExists(invalidNullifiers, invalidCommitments)).to.equal(false);
    const publicInputs: PublicInputs = {
      nullifiers: new Array<bigint>(invalidNullifiers),
      commitmentsOut: new Array<bigint>(invalidCommitments),
      merkleRoot: 0n,
      boundParamsHash: 0n,
    };
    await expect(artifactGetter(publicInputs)).to.be.rejectedWith('No artifacts for inputs: 1-6');

    VALID_OUTPUT_COUNTS.forEach((outputCount) => {
      VALID_INPUT_COUNTS.forEach((inputCount) => {
        if (inputCount === 10 && outputCount === 5) {
          // We don't have a circuit for this case.
          return;
        }

        // Test that artifacts exist for each INPUT x OUTPUT combination.
        expect(artifactExists(inputCount, outputCount)).to.equal(
          true,
          `Failed to load artifacts for ${inputCount}x${outputCount} circuit`,
        );
      });
    });
  });
});
