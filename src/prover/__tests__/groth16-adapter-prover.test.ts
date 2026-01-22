import { expect } from 'chai';
import { EngineGroth16AdapterProver } from '../groth16-adapter-prover';
import { testArtifactsGetter } from '../../test/helper.test';
import TestVectorPOI from '../../test/test-vector-poi.json';
import type { ProverArtifacts, POICircuitInputs } from '@railgun-reloaded/prover';
import { ByteUtils } from '../../utils';
import { POI } from '../../poi/poi';
import { Chain } from '../../models/engine-types';
import { ProofCachePOI } from '../proof-cache-poi';

const chain: Chain = {
  type: 0,
  id: 1,
};

const convertArtifactToProverArtifacts = async (
  maxInputs: number,
  maxOutputs: number,
): Promise<ProverArtifacts> => {
  const artifact = await testArtifactsGetter.getArtifactsPOI(maxInputs, maxOutputs);
  if (!artifact.wasm) {
    throw new Error('WASM artifact is required but was undefined');
  }
  return {
    vkey: artifact.vkey as ProverArtifacts['vkey'], 
    zkey: new Uint8Array(artifact.zkey),
    wasm: new Uint8Array(artifact.wasm),
  };
};

const padArray = <T>(array: T[], max: number, zeroValue: T): T[] => {
  const padded = [...array];
  while (padded.length < max) {
    padded.push(zeroValue);
  }
  return padded;
};
const hexToBytes = (hex: string): Uint8Array => {
  const cleanHex = hex.startsWith('0x') ? hex.slice(2) : hex;
  return ByteUtils.hexToBytes(cleanHex);
};

const bigintToBytes = (value: bigint): Uint8Array => {
  const hex = value.toString(16).padStart(64, '0');
  return ByteUtils.hexToBytes(hex);
};
const convertTestVectorToPOICircuitInputs = (
  testVector: typeof TestVectorPOI,
  maxInputs: number,
  maxOutputs: number,
): POICircuitInputs => {
  const poiInputs: POICircuitInputs = {
    anyRailgunTxidMerklerootAfterTransaction: hexToBytes(
      testVector.anyRailgunTxidMerklerootAfterTransaction,
    ),
    poiMerkleroots: padArray(
      testVector.poiMerkleroots.map(hexToBytes),
      maxInputs,
      new Uint8Array(32),
    ),
    boundParamsHash: hexToBytes(testVector.boundParamsHash),
    nullifiers: padArray(
      testVector.nullifiers.map(hexToBytes),
      maxInputs,
      new Uint8Array(32),
    ),
    commitmentsOut: padArray(
      testVector.commitmentsOut.map(hexToBytes),
      maxOutputs,
      new Uint8Array(32),
    ),
    spendingPublicKey: [
      bigintToBytes(BigInt(testVector.spendingPublicKey[0])),
      bigintToBytes(BigInt(testVector.spendingPublicKey[1])),
    ],
    nullifyingKey: bigintToBytes(BigInt(testVector.nullifyingKey)),
    token: hexToBytes(testVector.token),
    randomsIn: padArray(
      testVector.randomsIn.map(hexToBytes),
      maxInputs,
      new Uint8Array(16),
    ),
    valuesIn: padArray(
      testVector.valuesIn.map((x) => BigInt(x)),
      maxOutputs,
      0n,
    ),
    utxoPositionsIn: padArray(
      testVector.utxoPositionsIn.map(Number),
      maxInputs,
      0,
    ),
    utxoTreeIn: Number(testVector.utxoTreeIn),
    npksOut: padArray(
      testVector.npksOut.length > 0
        ? testVector.npksOut.map((x) => hexToBytes(x))
        : [],
      maxOutputs,
      new Uint8Array(32),
    ),
    valuesOut: padArray(
      testVector.valuesOut.map((x) => BigInt(x)),
      maxOutputs,
      0n,
    ),
    utxoBatchGlobalStartPositionOut: bigintToBytes(BigInt(testVector.utxoBatchGlobalStartPositionOut)),
    railgunTxidIfHasUnshield: hexToBytes(testVector.railgunTxidIfHasUnshield),
    railgunTxidMerkleProofIndices: Number(testVector.railgunTxidMerkleProofIndices),
    railgunTxidMerkleProofPathElements: testVector.railgunTxidMerkleProofPathElements.map(hexToBytes),
    poiInMerkleProofIndices: padArray(
      testVector.poiInMerkleProofIndices.map((x) => Number(x)),
      maxInputs,
      0,
    ),
    poiInMerkleProofPathElements: padArray(
      testVector.poiInMerkleProofPathElements.map((pathElements) =>
        pathElements.map(hexToBytes),
      ),
      maxInputs,
      Array.from({ length: 16 }, () => new Uint8Array(32)),
    ),
  };

  return poiInputs;
};

describe('groth16-adapter-prover', () => {
  beforeEach(() => {
    ProofCachePOI.clear_TEST_ONLY();
    POI.launchBlocks.set(null, chain, 0);
  });

  it('Should create adapter prover with POI artifacts', async () => {
    const poiArtifacts = await convertArtifactToProverArtifacts(3, 3);
    const adapterProver = new EngineGroth16AdapterProver(null, poiArtifacts);
    expect(adapterProver).to.be.an('object');
  });

  it('Should generate and validate POI proof - 3x3 using adapter', async () => {
    const poiArtifacts = await convertArtifactToProverArtifacts(3, 3);
    const adapterProver = new EngineGroth16AdapterProver(null, poiArtifacts);
    const testVector = TestVectorPOI;
    const poiInputs = convertTestVectorToPOICircuitInputs(testVector, 3, 3);

    const result = await adapterProver.provePOIViaAdapter(poiInputs);
    expect(result).to.be.an('object');

    const verifyResult = await adapterProver.proveAndVerifyPOI(poiInputs, poiArtifacts.vkey);
    expect(verifyResult.isValid).to.equal(true);
  }).timeout(30000);

  it('Should generate and validate POI proof - 13x13 using adapter', async () => {
    const poiArtifacts = await convertArtifactToProverArtifacts(13, 13);
    const adapterProver = new EngineGroth16AdapterProver(null, poiArtifacts);
    const testVector = TestVectorPOI;
    const poiInputs = convertTestVectorToPOICircuitInputs(testVector, 13, 13);

    const result = await adapterProver.provePOIViaAdapter(poiInputs);
    expect(result).to.be.an('object');

    const verifyResult = await adapterProver.proveAndVerifyPOI(poiInputs, poiArtifacts.vkey);
    expect(verifyResult.isValid).to.equal(true);
  }).timeout(30000);
});