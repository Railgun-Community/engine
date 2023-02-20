/* eslint-disable no-unused-expressions */
import { expect } from 'chai';
import { PublicInputs } from '../../models/prover-types';
import { artifactsGetter } from '../../test/helper.test';
import { VALID_INPUT_COUNTS, VALID_OUTPUT_COUNTS } from '../nullifiers';

describe('Solutions/Simple Solutions', () => {
  it('Should test basic artifacts exist for each valid input/output', () => {
    const invalidInputs: PublicInputs = {
      nullifiers: new Array<bigint>(6),
      commitmentsOut: new Array<bigint>(1),
      merkleRoot: 0n,
      boundParamsHash: 0n,
    };
    expect(() => artifactsGetter(invalidInputs)).to.throw('No artifacts for inputs: 6-1');

    VALID_OUTPUT_COUNTS.forEach((outputCount) => {
      VALID_INPUT_COUNTS.forEach((inputCount) => {
        // Test that artifacts exist for each INPUT x OUTPUT combination.
        const publicInputs: PublicInputs = {
          nullifiers: new Array<bigint>(inputCount),
          commitmentsOut: new Array<bigint>(outputCount),
          merkleRoot: 0n,
          boundParamsHash: 0n,
        };
        expect(() => artifactsGetter(publicInputs)).not.to.throw();
      });
    });
  });
});
