import { expect } from 'chai';
import { EngineGroth16AdapterProver } from '../groth16-adapter-prover';
import { testArtifactsGetter } from '../../test/helper.test';
import TestVectorPOI from '../../test/test-vector-poi.json';
import type { ProverArtifacts, POICircuitInputs, TransactionCircuitInputs } from '@railgun-reloaded/prover';
import { SnarkjsPoiProver, SnarkjsTransactionProver } from '@railgun-reloaded/prover';
import { ByteUtils } from '../../utils';
import { POI } from '../../poi/poi';
import { Chain } from '../../models/engine-types';
import { ProofCachePOI } from '../proof-cache-poi';
import { MERKLE_ZERO_VALUE_BIGINT } from '../../models/merkletree-types';

const chain: Chain = {
  type: 0,
  id: 1,
};

const MERKLE_ZERO_BYTES = ByteUtils.nToBytes(MERKLE_ZERO_VALUE_BIGINT, 32);

const convertPOIArtifactToProverArtifacts = async (
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


const convertTxArtifactToProverArtifacts = async (
  nullifiers: number,
  commitments: number,
): Promise<ProverArtifacts> => {
  const artifact = await testArtifactsGetter.getArtifacts({
    nullifiers: Array(nullifiers).fill(0n),
    commitmentsOut: Array(commitments).fill(0n),
    merkleRoot: 0n,
    boundParamsHash: 0n,
  });
  if (!artifact.wasm) {
    throw new Error('WASM artifact is required but was undefined');
  }
  return {
    vkey: artifact.vkey as ProverArtifacts['vkey'],
    zkey: new Uint8Array(artifact.zkey as ArrayLike<number>),
    wasm: new Uint8Array(artifact.wasm as ArrayLike<number>),
  };
};


const padArray = <T>(array: T[], max: number, zeroValue: T): T[] => {
  const padded = [...array];
  while (padded.length < max) {
    padded.push(zeroValue);
  }
  return padded;
};


const hexToFieldElement = (hex: string, size: number = 32): Uint8Array => {
  const cleanHex = hex.startsWith('0x') ? hex.slice(2) : hex;
  const paddedHex = cleanHex.padStart(size * 2, '0');
  return ByteUtils.hexToBytes(paddedHex);
};

const decimalToFieldElement = (decimal: string, size: number = 32): Uint8Array => {
  const bigintVal = BigInt(decimal);
  const hex = bigintVal.toString(16).padStart(size * 2, '0');
  return ByteUtils.hexToBytes(hex);
};

/**
 * Transaction test vector for 1x2 circuit (1 input, 2 outputs)
 * This test vector is derived from the @railgun-reloaded/prover test vectors
 */
const TransactionTestVector1x2 = {
  merkleRoot: '0x14a4f4001199b05fa5e3bd4ca9bd191084c891feac99be79272cdd671d5275b8',
  boundParamsHash: '0x1d64d5e8131bfc3fc3d10343fd3daf7798ae637302501b9058085eb0c2fd2fa1',
  nullifiers: ['0x0bee1c05c9921260085974c1b47e1b0ca39d5b3dfd40cc217a97e43c8595e299'],
  commitmentsOut: [
    '0x20a3de4307607d219d43d4ecb6f732c5f41d5d2ea1773325d44eba6833db88a8',
    '0x1acf333c90ef6d2845cf61c8bef557ad7a78885ad6f8cc84b8d8cc6d5c8c1191',
  ],
  token: '0x0000000000000000000000000000000000000000000000000000000000000000',
  publicKey: [
    '0x0ab643966862eed77019d5d727dfd33503f760280079a02ecbff2728e359c832',
    '0x07151d539ec1fa7269b5521e3bc6a807b1228986434b289434333745888a1b3b',
  ],
  signature: [
    '0x059aa001a731044b2e8616835a3ac2bd546e4ae01d65c5310ae2ab2d8035c917',
    '0x0690127598e397fc02e84c39344b35504c3159614cd11682bd96d50a08740e93',
    '0x0342eb28a3c786f8d29384b8e5231623fdb0a46aed370f8536165dde2770dd7c',
  ],
  nullifyingKey: '0x10723748ec5f3c372795b09ff836a01c2d8912dbdf326e675bd2cce508f85249',
  inputTXOs: [
    {
      nullifier: '0x0bee1c05c9921260085974c1b47e1b0ca39d5b3dfd40cc217a97e43c8595e299',
      randomIn: '0x000000000000000000000000000000003df8b0f35478acf7bca5a9501776b86a',
      valueIn: '2',
      merkleleafPosition: 0,
      pathElements: [
        '0x0488f89b25bc7011eaf6a5edce71aeafb9fe706faa3c0a5cd9cbe868ae3b9ffc',
        '0x01c405064436affeae1fc8e30b2e417b4243bbb819adca3b55bb32efc3e43a4f',
        '0x0888d37652d10d1781db54b70af87b42a2916e87118f507218f9a42a58e85ed2',
        '0x183f531ead7217ebc316b4c02a2aad5ad87a1d56d4fb9ed81bf84f644549eaf5',
        '0x093c48f1ecedf2baec231f0af848a57a76c6cf05b290a396707972e1defd17df',
        '0x1437bb465994e0453357c17a676b9fdba554e215795ebc17ea5012770dfb77c7',
        '0x12359ef9572912b49f44556b8bbbfa69318955352f54cfa35cb0f41309ed445a',
        '0x2dc656dadc82cf7a4707786f4d682b0f130b6515f7927bde48214d37ec25a46c',
        '0x2500bdfc1592791583acefd050bc439a87f1d8e8697eb773e8e69b44973e6fdc',
        '0x244ae3b19397e842778b254cd15c037ed49190141b288ff10eb1390b34dc2c31',
        '0x0ca2b107491c8ca6e5f7e22403ea8529c1e349a1057b8713e09ca9f5b9294d46',
        '0x18593c75a9e42af27b5e5b56b99c4c6a5d7e7d6e362f00c8e3f69aeebce52313',
        '0x17aca915b237b04f873518947a1f440f0c1477a6ac79299b3be46858137d4bfb',
        '0x2726c22ad3d9e23414887e8233ee83cc51603f58c48a9c9e33cb1f306d4365c0',
        '0x08c5bd0f85cef2f8c3c1412a2b69ee943c6925ecf79798bb2b84e1b76d26871f',
        '0x27f7c465045e0a4d8bec7c13e41d793734c50006ca08920732ce8c3096261435',
      ],
    },
  ],
  outputTXOs: [
    {
      commitment: '0x20a3de4307607d219d43d4ecb6f732c5f41d5d2ea1773325d44eba6833db88a8',
      npk: '0x2f7932a1cdf8f59676f69477a095b0eccf0863f7def1d7d9d0de0c3cb2db2f7a',
      value: '1',
    },
    {
      commitment: '0x1acf333c90ef6d2845cf61c8bef557ad7a78885ad6f8cc84b8d8cc6d5c8c1191',
      npk: '0x10501d009bb1adc975a4f9de0ea9f2827cf033a51c807db6906debcc78eb5b5b',
      value: '1',
    },
  ],
};

const convertTestVectorToTransactionInputs = (
  testVector: typeof TransactionTestVector1x2,
): TransactionCircuitInputs => {
  return {
    merkleRoot: hexToFieldElement(testVector.merkleRoot),
    boundParamsHash: hexToFieldElement(testVector.boundParamsHash),
    token: hexToFieldElement(testVector.token),
    publicKey: testVector.publicKey.map(h => hexToFieldElement(h)),
    signature: testVector.signature.map(h => hexToFieldElement(h)),
    nullifyingKey: hexToFieldElement(testVector.nullifyingKey),
    inputTXOs: testVector.inputTXOs.map(txo => ({
      nullifier: hexToFieldElement(txo.nullifier),
      randomIn: hexToFieldElement(txo.randomIn),
      valueIn: BigInt(txo.valueIn),
      merkleleafPosition: txo.merkleleafPosition,
      pathElements: txo.pathElements.map(h => hexToFieldElement(h)),
    })),
    outputTXOs: testVector.outputTXOs.map(txo => ({
      commitment: hexToFieldElement(txo.commitment),
      npk: hexToFieldElement(txo.npk),
      value: BigInt(txo.value),
    })),
  };
};

const convertTestVectorToPOICircuitInputs = (
  testVector: typeof TestVectorPOI,
  maxInputs: number,
  maxOutputs: number,
): POICircuitInputs => {
  const poiInputs: POICircuitInputs = {
    anyRailgunTxidMerklerootAfterTransaction: hexToFieldElement(
      testVector.anyRailgunTxidMerklerootAfterTransaction,
    ),
    poiMerkleroots: padArray(
      testVector.poiMerkleroots.map(h => hexToFieldElement(h)),
      maxInputs,
      MERKLE_ZERO_BYTES,
    ),
    boundParamsHash: hexToFieldElement(testVector.boundParamsHash),
    nullifiers: padArray(
      testVector.nullifiers.map(h => hexToFieldElement(h)),
      maxInputs,
      MERKLE_ZERO_BYTES,
    ),
    commitmentsOut: padArray(
      testVector.commitmentsOut.map(h => hexToFieldElement(h)),
      maxOutputs,
      MERKLE_ZERO_BYTES,
    ),
    spendingPublicKey: [
      decimalToFieldElement(testVector.spendingPublicKey[0]),
      decimalToFieldElement(testVector.spendingPublicKey[1]),
    ],
    nullifyingKey: decimalToFieldElement(testVector.nullifyingKey),
    token: hexToFieldElement(testVector.token),
    randomsIn: padArray(
      testVector.randomsIn.map(h => hexToFieldElement(h, 16)),
      maxInputs,
      ByteUtils.nToBytes(MERKLE_ZERO_VALUE_BIGINT, 16), 
    ),
    valuesIn: padArray(
      testVector.valuesIn.map((x) => BigInt(x)),
      maxOutputs,
      0n,
    ),
    utxoPositionsIn: padArray(
      testVector.utxoPositionsIn.map(Number),
      maxInputs,
      Number(MERKLE_ZERO_VALUE_BIGINT),
    ),
    utxoTreeIn: Number(testVector.utxoTreeIn),
    npksOut: padArray(
      testVector.npksOut.length > 0
        ? testVector.npksOut.map(h => hexToFieldElement(h))
        : [],
      maxOutputs,
      MERKLE_ZERO_BYTES,
    ),
    valuesOut: padArray(
      testVector.valuesOut.map((x) => BigInt(x)),
      maxOutputs,
      0n,
    ),
    utxoBatchGlobalStartPositionOut: decimalToFieldElement(testVector.utxoBatchGlobalStartPositionOut),
    railgunTxidIfHasUnshield: hexToFieldElement(testVector.railgunTxidIfHasUnshield),
    railgunTxidMerkleProofIndices: Number(testVector.railgunTxidMerkleProofIndices),
    railgunTxidMerkleProofPathElements: testVector.railgunTxidMerkleProofPathElements.map(h => hexToFieldElement(h)),
    poiInMerkleProofIndices: padArray(
      testVector.poiInMerkleProofIndices.map((x) => Number(x)),
      maxInputs,
      0,
    ),
    poiInMerkleProofPathElements: padArray(
      testVector.poiInMerkleProofPathElements.map((pathElements) =>
        pathElements.map(h => hexToFieldElement(h)),
      ),
      maxInputs,
      Array.from({ length: 16 }, () => new Uint8Array(MERKLE_ZERO_BYTES)),
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
    const poiArtifacts = await convertPOIArtifactToProverArtifacts(3, 3);
    const adapterProver = new EngineGroth16AdapterProver(null, poiArtifacts);
    expect(adapterProver).to.be.an('object');
  });

  it('Should generate POI proof using snarkjs directly with engine format - 3x3', async () => {
    const artifact = await testArtifactsGetter.getArtifactsPOI(3, 3);
    if (!artifact.wasm) {
      throw new Error('WASM artifact is required');
    }
    
    const testVector = TestVectorPOI;
    const maxInputs = 3;
    const maxOutputs = 3;


    
    const ZERO_VALUE_POI = MERKLE_ZERO_VALUE_BIGINT;

    const padWithZeros = <T>(arr: T[], max: number, zero: T): T[] => {
      const result = [...arr];
      while (result.length < max) {
        result.push(zero);
      }
      return result;
    };

    const formattedInputs = {
      anyRailgunTxidMerklerootAfterTransaction: ByteUtils.hexToBigInt(testVector.anyRailgunTxidMerklerootAfterTransaction),
      boundParamsHash: ByteUtils.hexToBigInt(testVector.boundParamsHash),
      nullifiers: padWithZeros(testVector.nullifiers.map(x => ByteUtils.hexToBigInt(x)), maxInputs, ZERO_VALUE_POI),
      commitmentsOut: padWithZeros(testVector.commitmentsOut.map(x => ByteUtils.hexToBigInt(x)), maxOutputs, ZERO_VALUE_POI),
      spendingPublicKey: testVector.spendingPublicKey.map(x => BigInt(x)) as [bigint, bigint],
      nullifyingKey: BigInt(testVector.nullifyingKey),
      token: ByteUtils.hexToBigInt(testVector.token),
      randomsIn: padWithZeros(testVector.randomsIn.map(x => ByteUtils.hexToBigInt(x)), maxInputs, ZERO_VALUE_POI),
      valuesIn: padWithZeros(testVector.valuesIn.map(x => BigInt(x)), maxOutputs, 0n),
      utxoPositionsIn: padWithZeros(testVector.utxoPositionsIn.map(BigInt), maxInputs, ZERO_VALUE_POI),
      utxoTreeIn: BigInt(testVector.utxoTreeIn),
      npksOut: padWithZeros(testVector.npksOut.map(x => BigInt(x)), maxOutputs, ZERO_VALUE_POI),
      valuesOut: padWithZeros(testVector.valuesOut.map(x => BigInt(x)), maxOutputs, 0n),
      utxoBatchGlobalStartPositionOut: BigInt(testVector.utxoBatchGlobalStartPositionOut),
      railgunTxidIfHasUnshield: ByteUtils.hexToBigInt(testVector.railgunTxidIfHasUnshield),
      railgunTxidMerkleProofIndices: ByteUtils.hexToBigInt(testVector.railgunTxidMerkleProofIndices),
      railgunTxidMerkleProofPathElements: testVector.railgunTxidMerkleProofPathElements.map(x => ByteUtils.hexToBigInt(x)),
      poiMerkleroots: padWithZeros(testVector.poiMerkleroots.map(x => ByteUtils.hexToBigInt(x)), maxInputs, ZERO_VALUE_POI),
      poiInMerkleProofIndices: padWithZeros(testVector.poiInMerkleProofIndices.map(x => ByteUtils.hexToBigInt(x)), maxInputs, 0n),
      poiInMerkleProofPathElements: (() => {
        const result = testVector.poiInMerkleProofPathElements.map(path => 
          path.map(x => ByteUtils.hexToBigInt(x))
        );
        while (result.length < maxInputs) {
          result.push(Array(16).fill(ZERO_VALUE_POI));
        }
        return result;
      })(),
    };

    // Import snarkjs and call directly
    const snarkjs = await import('snarkjs');
    const { proof, publicSignals } = await snarkjs.groth16.fullProve(
      formattedInputs,
      new Uint8Array(artifact.wasm as ArrayLike<number>),
      new Uint8Array(artifact.zkey as ArrayLike<number>)
    );

    expect(proof).to.be.an('object');
    expect(publicSignals).to.be.an('array');
    console.log('Direct snarkjs proof succeeded!');
  }).timeout(60000);
  
  it('Should generate POI proof directly with SnarkjsPoiProver - 3x3', async () => {
    const poiArtifacts = await convertPOIArtifactToProverArtifacts(3, 3);
    const testVector = TestVectorPOI;
    const poiInputs = convertTestVectorToPOICircuitInputs(testVector, 3, 3);


    const poiProver = new SnarkjsPoiProver(poiArtifacts);
    const { proof, publicInputs } = await poiProver.prove(poiInputs);

    expect(proof).to.be.an('object');
    expect(publicInputs).to.be.an('object');
  }).timeout(60000);

  it('Should generate and validate POI proof - 3x3 using adapter', async () => {
    const poiArtifacts = await convertPOIArtifactToProverArtifacts(3, 3);
    const adapterProver = new EngineGroth16AdapterProver(null, poiArtifacts);
    const testVector = TestVectorPOI;
    const poiInputs = convertTestVectorToPOICircuitInputs(testVector, 3, 3);

    const result = await adapterProver.provePOIViaAdapter(poiInputs);
    expect(result).to.be.an('object');

    const verifyResult = await adapterProver.proveAndVerifyPOI(poiInputs, poiArtifacts.vkey);
    expect(verifyResult.isValid).to.equal(true);
  }).timeout(60000);

  it('Should generate and validate POI proof - 13x13 using adapter', async () => {
    const poiArtifacts = await convertPOIArtifactToProverArtifacts(13, 13);
    const adapterProver = new EngineGroth16AdapterProver(null, poiArtifacts);
    const testVector = TestVectorPOI;
    const poiInputs = convertTestVectorToPOICircuitInputs(testVector, 13, 13);

    const result = await adapterProver.provePOIViaAdapter(poiInputs);
    expect(result).to.be.an('object');

    const verifyResult = await adapterProver.proveAndVerifyPOI(poiInputs, poiArtifacts.vkey);
    expect(verifyResult.isValid).to.equal(true);
  }).timeout(120000); // 13x13 proofs take longer


  it('Should create adapter prover with transaction artifacts', async () => {
    const txArtifacts = await convertTxArtifactToProverArtifacts(1, 2);
    const adapterProver = new EngineGroth16AdapterProver(txArtifacts, null);
    expect(adapterProver).to.be.an('object');
  });

  it('Should create adapter prover with both transaction and POI artifacts', async () => {
    const txArtifacts = await convertTxArtifactToProverArtifacts(1, 2);
    const poiArtifacts = await convertPOIArtifactToProverArtifacts(3, 3);
    const adapterProver = new EngineGroth16AdapterProver(txArtifacts, poiArtifacts);
    expect(adapterProver).to.be.an('object');
  });

  it('Should generate transaction proof directly with SnarkjsTransactionProver - 1x2', async () => {
    const txArtifacts = await convertTxArtifactToProverArtifacts(1, 2);
    const txInputs = convertTestVectorToTransactionInputs(TransactionTestVector1x2);

    const txProver = new SnarkjsTransactionProver(txArtifacts);
    const { proof, publicInputs } = await txProver.prove(txInputs);

    expect(proof).to.be.an('object');
    expect(proof.a).to.have.property('x');
    expect(proof.a).to.have.property('y');
    expect(proof.b).to.have.property('x');
    expect(proof.b).to.have.property('y');
    expect(proof.c).to.have.property('x');
    expect(proof.c).to.have.property('y');
    expect(publicInputs).to.be.an('object');
    expect(publicInputs.merkleRoot).to.be.instanceOf(Uint8Array);
    expect(publicInputs.nullifiers).to.be.an('array');
    expect(publicInputs.commitments).to.be.an('array');
  }).timeout(60000);

  it('Should generate and validate transaction proof - 1x2 using adapter', async () => {
    const txArtifacts = await convertTxArtifactToProverArtifacts(1, 2);
    const adapterProver = new EngineGroth16AdapterProver(txArtifacts, null);
    const txInputs = convertTestVectorToTransactionInputs(TransactionTestVector1x2);

    const result = await adapterProver.proveTransactionViaAdapter(txInputs);
    expect(result).to.be.an('object');
    expect(result.proof).to.be.an('object');
    expect(result.publicSignals).to.be.an('array');

    const verifyResult = await adapterProver.proveAndVerifyTransaction(txInputs, txArtifacts.vkey);
    expect(verifyResult.isValid).to.equal(true);
    expect(verifyResult.proof).to.be.an('object');
    expect(verifyResult.publicInputs).to.be.an('object');
  }).timeout(60000);

  it('Should generate transaction proof using snarkjs directly - 1x2', async () => {

    const artifact = await testArtifactsGetter.getArtifacts({
      nullifiers: [0n],
      commitmentsOut: [0n, 1n],
      merkleRoot: 0n,
      boundParamsHash: 0n,
    });
    if (!artifact.wasm) {
      throw new Error('WASM artifact is required');
    }

    const testVector = TransactionTestVector1x2;

    const formattedInputs = {
      merkleRoot: testVector.merkleRoot,
      boundParamsHash: testVector.boundParamsHash,
      nullifiers: testVector.nullifiers,
      commitmentsOut: testVector.commitmentsOut,
      token: testVector.token,
      publicKey: testVector.publicKey,
      signature: testVector.signature,
      randomIn: testVector.inputTXOs.map(txo => txo.randomIn),
      valueIn: testVector.inputTXOs.map(txo => txo.valueIn),
      pathElements: testVector.inputTXOs.map(txo => txo.pathElements),
      leavesIndices: testVector.inputTXOs.map(txo => txo.merkleleafPosition),
      nullifyingKey: testVector.nullifyingKey,
      npkOut: testVector.outputTXOs.map(txo => txo.npk),
      valueOut: testVector.outputTXOs.map(txo => txo.value),
    };

    // Import snarkjs and call directly
    const snarkjs = await import('snarkjs');
    const { proof, publicSignals } = await snarkjs.groth16.fullProve(
      formattedInputs,
      new Uint8Array(artifact.wasm as ArrayLike<number>),
      new Uint8Array(artifact.zkey as ArrayLike<number>)
    );

    expect(proof).to.be.an('object');
    expect(publicSignals).to.be.an('array');
    expect(publicSignals.length).to.be.greaterThan(0);
    console.log('Direct snarkjs transaction proof succeeded!');
  }).timeout(60000);

  it('Should fail to generate transaction proof without transaction artifacts', async () => {
    const poiArtifacts = await convertPOIArtifactToProverArtifacts(3, 3);
    const adapterProver = new EngineGroth16AdapterProver(null, poiArtifacts);
    const txInputs = convertTestVectorToTransactionInputs(TransactionTestVector1x2);

    try {
      await adapterProver.proveTransactionViaAdapter(txInputs);
      expect.fail('Should have thrown an error');
    } catch (error) {
      expect((error as Error).message).to.include('Transaction artifacts are required');
    }
  });

  it('Should fail to generate POI proof without POI artifacts', async () => {
    const txArtifacts = await convertTxArtifactToProverArtifacts(1, 2);
    const adapterProver = new EngineGroth16AdapterProver(txArtifacts, null);
    const poiInputs = convertTestVectorToPOICircuitInputs(TestVectorPOI, 3, 3);

    try {
      await adapterProver.provePOIViaAdapter(poiInputs);
      expect.fail('Should have thrown an error');
    } catch (error) {
      expect((error as Error).message).to.include('POI artifacts are required');
    }
  });
});