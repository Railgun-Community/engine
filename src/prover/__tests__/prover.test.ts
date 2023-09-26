import { expect } from 'chai';
import { groth16 } from 'snarkjs';
import memdown from 'memdown';
import { Prover } from '../prover';
import { testArtifactsGetter } from '../../test/helper.test';
import TestVectorPOI from '../../test/test-vector-poi.json';
import { getDummyPOIProofInputs } from '../../test/test-poi-proof.test';
import { createRailgunTransactionWithID } from '../../transaction/railgun-txid';
import { verifyMerkleProof } from '../../merkletree/merkle-proof';
import { Chain, MerkleProof } from '../../models';
import { RailgunTxidMerkletree } from '../../merkletree/railgun-txid-merkletree';
import { Database } from '../../database/database';
import { ShieldNote, TransactNote } from '../../note';
import { ByteLength, hexToBigInt, nToHex } from '../../utils';
import { WalletNode } from '../../key-derivation/wallet-node';
import { getShieldRailgunTxid } from '../../poi/shield-railgun-txid';
import {
  getBlindedCommitmentForShield,
  getBlindedCommitmentForUnshield,
} from '../../poi/blinded-commitment';

const chain: Chain = {
  type: 0,
  id: 1,
};

describe('Prover', () => {
  it('Should generate and validate POI proof', async () => {
    const prover = new Prover(testArtifactsGetter);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    prover.setSnarkJSGroth16(groth16);

    const proofInputs = TestVectorPOI;

    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    const fullProofInputs = getDummyPOIProofInputs(proofInputs as any);

    const { proof } = await prover.provePOI(
      fullProofInputs,
      TestVectorPOI.blindedCommitmentsOut,
      () => {},
      // (progress) => {
      // console.log(`Generating POI proof ... ${progress}%`);
      // },
    );

    expect(proof).to.be.an('object');
  }).timeout(20000);

  it('Should verify input vector', async () => {
    const proofInputs = TestVectorPOI;

    const railgunTransaction = createRailgunTransactionWithID({
      graphID: '',
      boundParamsHash: proofInputs.boundParamsHash,
      commitments: proofInputs.commitmentsOut,
      nullifiers: proofInputs.nullifiers,
      blockNumber: 0,
    });
    expect(railgunTransaction.hash).to.equal(
      '065c9f784b1c322504adf204dca7d18a815d6e62aded02115889ed24160ea70d',
    );

    const railgunTxidMerkletree = await RailgunTxidMerkletree.createForWallet(
      new Database(memdown()),
      chain,
      async () => true,
    );
    await railgunTxidMerkletree.queueRailgunTransactions([railgunTransaction], undefined);
    await railgunTxidMerkletree.updateTreesFromWriteQueue();
    const railgunTxidMerkleproof = await railgunTxidMerkletree.getMerkleProof(0, 0);
    const inputMerkleProof: MerkleProof = {
      root: proofInputs.anyRailgunTxidMerklerootAfterTransaction,
      indices: proofInputs.railgunTxidMerkleProofIndices,
      elements: proofInputs.railgunTxidMerkleProofPathElements,
      leaf: railgunTransaction.hash,
    };
    expect(railgunTxidMerkleproof).to.deep.equal(inputMerkleProof);
    expect(verifyMerkleProof(inputMerkleProof)).to.equal(true);

    const nullifier = TransactNote.getNullifier(
      BigInt(proofInputs.nullifyingKey),
      proofInputs.utxoPositionsIn[0],
    );
    expect(nullifier).to.equal(hexToBigInt(proofInputs.nullifiers[0]));

    // Verify shield note details
    const masterPublicKey = WalletNode.getMasterPublicKey(
      [BigInt(proofInputs.spendingPublicKey[0]), BigInt(proofInputs.spendingPublicKey[1])],
      BigInt(proofInputs.nullifyingKey),
    );
    expect(masterPublicKey).to.equal(
      20060431504059690749153982049210720252589378133547582826474262520121417617087n,
    );
    const notePublicKey = ShieldNote.getNotePublicKey(masterPublicKey, proofInputs.randomsIn[0]);
    expect(notePublicKey).to.equal(
      6401386539363233023821237080626891507664131047949709897410333742190241828916n,
    );
    const shieldCommitment = ShieldNote.getShieldNoteHash(
      notePublicKey,
      proofInputs.token,
      BigInt(proofInputs.valuesIn[0]),
    );
    expect(shieldCommitment).to.equal(
      6442080113031815261226726790601252395803415545769290265212232865825296902085n,
    );
    const blindedCommitmentForShield = hexToBigInt(
      getBlindedCommitmentForShield(
        nToHex(shieldCommitment, ByteLength.UINT_256),
        notePublicKey,
        getShieldRailgunTxid(0, 0),
      ),
    );
    expect(blindedCommitmentForShield).to.equal(
      12151255948031648278500231754672666576376002857793985290167262750766640136930n,
    );
    expect(blindedCommitmentForShield).to.equal(hexToBigInt(proofInputs.blindedCommitmentsIn[0]));

    // Verify transact note details
    const unshieldCommitment = TransactNote.getHash(
      BigInt(proofInputs.npksOut[0]),
      proofInputs.token,
      BigInt(proofInputs.valuesOut[0]),
    );
    expect(unshieldCommitment).to.equal(
      216763491134624113411811686074368460908979279854884101816433178521240642085n,
    );
    expect(unshieldCommitment).to.equal(hexToBigInt(proofInputs.commitmentsOut[0]));

    const blindedCommitmentOut = hexToBigInt(
      getBlindedCommitmentForUnshield(
        nToHex(unshieldCommitment, ByteLength.UINT_256),
        '0xF39FD6E51AAD88F6F4CE6AB8827279CFFFB92266', // toAddress
        '065c9f784b1c322504adf204dca7d18a815d6e62aded02115889ed24160ea70d', // railgunTxid
      ),
    );
    expect(blindedCommitmentOut).to.equal(
      20212043841001617549529507919653247325743418843927056327683159290488555337744n,
    );
    expect(blindedCommitmentOut).to.equal(hexToBigInt(proofInputs.blindedCommitmentsOut[0]));
  });
});
