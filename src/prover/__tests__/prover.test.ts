import { expect } from 'chai';
import { groth16 } from 'snarkjs';
import memdown from 'memdown';
import { Prover } from '../prover';
import { testArtifactsGetter } from '../../test/helper.test';
import TestVectorPOI from '../../test/test-vector-poi.json';
import { createRailgunTransactionWithHash } from '../../transaction/railgun-txid';
import { verifyMerkleProof } from '../../merkletree/merkle-proof';
import { Chain } from '../../models/engine-types';
import { MerkleProof } from '../../models/formatted-types';
import { TXIDVersion } from '../../models/poi-types';
import { TXIDMerkletree } from '../../merkletree/txid-merkletree';
import { Database } from '../../database/database';
import { ShieldNote, TransactNote, getTokenDataERC20 } from '../../note';
import { ByteLength, hexToBigInt, nToHex } from '../../utils';
import { WalletNode } from '../../key-derivation/wallet-node';
import { getGlobalTreePosition } from '../../poi/global-tree-position';
import { getBlindedCommitmentForShieldOrTransact } from '../../poi/blinded-commitment';
import { Proof, PublicInputsPOI } from '../../models';
import { ProofCachePOI } from '../proof-cache-poi';
import { config } from '../../test/config.test';
import { POI } from '../../poi/poi';

const chain: Chain = {
  type: 0,
  id: 1,
};

describe('prover', () => {
  beforeEach(() => {
    ProofCachePOI.clear_TEST_ONLY();
    POI.setLaunchBlock(chain, 0);
  });

  it('Should generate and validate POI proof - 3x3', async () => {
    const prover = new Prover(testArtifactsGetter);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    prover.setSnarkJSGroth16(groth16);

    const testVector = TestVectorPOI;

    // Will automatically choose 3x3
    const { proof, publicInputs } = await prover.provePOI(
      testVector as any,
      testVector.listKey,
      [], // blindedCommitmentsIn - just for logging
      testVector.blindedCommitmentsOut,
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      (progress) => {
        // console.log(progress);
      },
    );

    expect(proof.pi_a.length).to.equal(2);
    expect(proof.pi_b.length).to.equal(2);
    expect(proof.pi_b[0].length).to.equal(2);
    expect(proof.pi_b[1].length).to.equal(2);
    expect(proof.pi_c.length).to.equal(2);

    expect(proof).to.be.an('object');

    const publicInputsCalculated: PublicInputsPOI = prover.getPublicInputsPOI(
      testVector.anyRailgunTxidMerklerootAfterTransaction,
      testVector.blindedCommitmentsOut,
      testVector.poiMerkleroots,
      testVector.railgunTxidIfHasUnshield,
      3,
      3,
    );
    expect(publicInputs.railgunTxidIfHasUnshield).to.deep.equal(
      publicInputsCalculated.railgunTxidIfHasUnshield,
    );

    expect(publicInputs).to.deep.equal(publicInputsCalculated);

    expect(publicInputs.poiMerkleroots.length).to.equal(3);
    expect(publicInputs.blindedCommitmentsOut.length).to.equal(3);

    expect(await prover.verifyPOIProof(publicInputs, proof, 3, 3)).to.equal(true);
  }).timeout(30000);

  it('Should generate and validate POI proof - 13x13', async () => {
    const prover = new Prover(testArtifactsGetter);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    prover.setSnarkJSGroth16(groth16);

    const testVector = TestVectorPOI;

    const { proof, publicInputs } = await prover.provePOIForInputsOutputs(
      testVector as any,
      testVector.listKey,
      [], // blindedCommitmentsIn - just for logging
      testVector.blindedCommitmentsOut,
      13, // maxInputs
      13, // maxOutputs
      () => {}, // progress
    );

    expect(proof.pi_a.length).to.equal(2);
    expect(proof.pi_b.length).to.equal(2);
    expect(proof.pi_b[0].length).to.equal(2);
    expect(proof.pi_b[1].length).to.equal(2);
    expect(proof.pi_c.length).to.equal(2);

    expect(proof).to.be.an('object');

    const publicInputsCalculated: PublicInputsPOI = prover.getPublicInputsPOI(
      testVector.anyRailgunTxidMerklerootAfterTransaction,
      testVector.blindedCommitmentsOut,
      testVector.poiMerkleroots,
      testVector.railgunTxidIfHasUnshield,
      13,
      13,
    );
    expect(publicInputs).to.deep.equal(publicInputsCalculated);

    expect(publicInputs.poiMerkleroots.length).to.equal(13);
    expect(publicInputs.blindedCommitmentsOut.length).to.equal(13);

    expect(await prover.verifyPOIProof(publicInputs, proof, 13, 13)).to.equal(true);
  }).timeout(30000);

  it('Should verify input vector', async () => {
    const testVector = TestVectorPOI;

    const railgunTransaction = createRailgunTransactionWithHash(
      {
        graphID: '',
        boundParamsHash: testVector.boundParamsHash,
        commitments: testVector.commitmentsOut,
        nullifiers: testVector.nullifiers,
        unshield: {
          tokenData: getTokenDataERC20(config.contracts.rail),
          toAddress: '0x1234',
          value: '0x01',
        },
        timestamp: 1_000_000,
        txid: '00',
        blockNumber: 0,
        utxoTreeIn: 0,
        utxoTreeOut: 0,
        utxoBatchStartPositionOut: 1,
        verificationHash: 'todo',
      },
      TXIDVersion.V2_PoseidonMerkle,
    );
    expect(hexToBigInt(railgunTransaction.railgunTxid)).to.equal(
      BigInt(testVector.railgunTxidIfHasUnshield),
    );

    const txidMerkletree = await TXIDMerkletree.createForWallet(
      new Database(memdown()),
      chain,
      TXIDVersion.V2_PoseidonMerkle,
      0,
      async () => true,
    );
    await txidMerkletree.queueRailgunTransactions([railgunTransaction], undefined);
    await txidMerkletree.updateTreesFromWriteQueue();
    const railgunTxidMerkleproof = await txidMerkletree.getMerkleProof(0, 0);
    const inputMerkleProof: MerkleProof = {
      root: testVector.anyRailgunTxidMerklerootAfterTransaction,
      indices: testVector.railgunTxidMerkleProofIndices,
      elements: testVector.railgunTxidMerkleProofPathElements,
      leaf: railgunTransaction.hash,
    };
    expect(railgunTxidMerkleproof).to.deep.equal(inputMerkleProof);
    expect(verifyMerkleProof(inputMerkleProof)).to.equal(true);

    const nullifier = TransactNote.getNullifier(
      BigInt(testVector.nullifyingKey),
      testVector.utxoPositionsIn[0],
    );
    expect(nullifier).to.equal(hexToBigInt(testVector.nullifiers[0]));

    // Verify shield note details
    const masterPublicKey = WalletNode.getMasterPublicKey(
      [BigInt(testVector.spendingPublicKey[0]), BigInt(testVector.spendingPublicKey[1])],
      BigInt(testVector.nullifyingKey),
    );
    expect(masterPublicKey).to.equal(
      20060431504059690749153982049210720252589378133547582826474262520121417617087n,
    );
    const notePublicKey = ShieldNote.getNotePublicKey(masterPublicKey, testVector.randomsIn[0]);
    expect(notePublicKey).to.equal(
      6401386539363233023821237080626891507664131047949709897410333742190241828916n,
    );
    const shieldCommitment = ShieldNote.getShieldNoteHash(
      notePublicKey,
      testVector.token,
      BigInt(testVector.valuesIn[0]),
    );
    expect(shieldCommitment).to.equal(
      6442080113031815261226726790601252395803415545769290265212232865825296902085n,
    );
    const blindedCommitmentForShield = hexToBigInt(
      getBlindedCommitmentForShieldOrTransact(
        nToHex(shieldCommitment, ByteLength.UINT_256),
        notePublicKey,
        getGlobalTreePosition(0, 0),
      ),
    );
    expect(blindedCommitmentForShield).to.equal(
      12151255948031648278500231754672666576376002857793985290167262750766640136930n,
    );
    expect(blindedCommitmentForShield).to.equal(hexToBigInt(testVector.blindedCommitmentsIn[0]));
  });
});
