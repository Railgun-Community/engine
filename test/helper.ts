// @ts-ignore
import { artifacts } from 'railgun-artifacts-node';
import { PublicInputs } from '../src/prover';

export const artifactsGetter = (inputs: PublicInputs) =>
  artifacts[(inputs.nullifiers.length, inputs.commitmentsOut.length)];
