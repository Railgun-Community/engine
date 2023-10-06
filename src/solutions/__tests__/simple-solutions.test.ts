import { expect } from 'chai';
import { PublicInputsRailgun } from '../../models/prover-types';
import { testArtifactsGetter } from '../../test/helper.test';
import { VALID_INPUT_COUNTS, VALID_OUTPUT_COUNTS } from '../nullifiers';

describe('simple-solutions', () => {
  it('Should test basic artifacts exist for each valid input/output', async () => {
    const invalidNullifiers = 1;
    const invalidCommitments = 6;
    expect(() =>
      testArtifactsGetter.assertArtifactExists(invalidNullifiers, invalidCommitments),
    ).to.throw('No artifacts for inputs: 1-6');
    const publicInputs: PublicInputsRailgun = {
      nullifiers: new Array<bigint>(invalidNullifiers),
      commitmentsOut: new Array<bigint>(invalidCommitments),
      merkleRoot: 0n,
      boundParamsHash: 0n,
    };
    await expect(testArtifactsGetter.getArtifacts(publicInputs)).to.be.rejectedWith(
      'No artifacts for inputs: 1-6',
    );

    VALID_OUTPUT_COUNTS.forEach((outputCount) => {
      VALID_INPUT_COUNTS.forEach((inputCount) => {
        if (inputCount === 10 && outputCount === 5) {
          // We don't have a circuit for this case.
          expect(() => testArtifactsGetter.assertArtifactExists(inputCount, outputCount)).to.throw(
            'No artifacts for inputs: 10-5',
          );
          return;
        }

        // Test that artifacts exist for each INPUT x OUTPUT combination.
        expect(() =>
          testArtifactsGetter.assertArtifactExists(inputCount, outputCount),
        ).not.to.throw();
      });
    });

    // Other artifact combinations
    expect(() => testArtifactsGetter.assertArtifactExists(11, 1)).not.to.throw();
    expect(() => testArtifactsGetter.assertArtifactExists(12, 1)).not.to.throw();
    expect(() => testArtifactsGetter.assertArtifactExists(13, 1)).not.to.throw();
    expect(() => testArtifactsGetter.assertArtifactExists(1, 10)).not.to.throw();
    expect(() => testArtifactsGetter.assertArtifactExists(1, 13)).not.to.throw();
  });
});
