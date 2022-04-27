/* globals describe it beforeEach */
import chai, { expect } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { artifactsGetter } from '../helper';

import { Prover, PrivateInputs, FormattedCircuitInputs, PublicInputs } from '../../src/prover';

chai.use(chaiAsPromised);

// eslint-disable-next-line no-unused-vars
let prover: Prover;

describe('Prover/Index', () => {
  beforeEach(async () => {
    prover = new Prover(artifactsGetter);
  });

  it('Should prove inputs', async () => {
    // publicInputs =
    // prover.prove(publicInputs, privateInputs);
  });
});
