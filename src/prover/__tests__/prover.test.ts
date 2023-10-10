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
import { PublicInputsPOI } from '../../models';
import { ProofCachePOI } from '../proof-cache-poi';
import { config } from '../../test/config.test';

const chain: Chain = {
  type: 0,
  id: 1,
};

describe('prover', () => {
  beforeEach(() => {
    ProofCachePOI.clear_TEST_ONLY();
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

  it('Should verify input vector - inline', async () => {
    const testVector = {
      anyRailgunTxidMerklerootAfterTransaction:
        '18853746047003093554091579821543785980263228732280207338084854413154686941000',
      boundParamsHash:
        '20869904951111615911721304190515241971329497999208196707238364233851471599965',
      nullifiers: [
        '20527515130396089505527257112462063441482931133169313479436893694349889803143',
        '9153515768346561452482738935353925362719058594976167156343094446246573083663',
        '780288966459230199669850947315427388976155118514049994435837663971410503020',
      ],
      commitmentsOut: [
        '18466106071387317592681994767670790340669873164568366421709788443165845019481',
        '911647570677855500043414563285593821194450313274341719696218888965383491751',
        '19665685285926860117906937018249557505588745539591114684351681779083142356283',
      ],
      spendingPublicKey: [
        '312309304809542060089605442553896525870584345756156199836902037623608485539',
        '2905567788000052791056403332500487181822394574469470026500911139600688880363',
      ],
      nullifyingKey:
        '19376738421069847965166304701729135831557057081943507467843352608460173452458',
      token: '1257091446822190593149162710650957664703118613600',
      randomsIn: [
        '69284546432793840525444992855957129914',
        '245339170960651889985067838783245590576',
        '20900084036438718338784708225641490855',
      ],
      valuesIn: ['5000000028753121743', '36599957069938545349023', '785162706686073913059890927'],
      utxoPositionsIn: ['2120', '2117', '2126'],
      utxoTreeIn: '0',
      npksOut: [
        '16758638771678488378414131722406780177798295979073675983573763183057151140389',
        '19456051336320595417209892774088607197466182127926416160831984226141482915064',
        '2051258411002736885948763699317990061539314419500486054347250703186609807356',
      ],
      valuesOut: ['40793870', '784099311643143880317567823', '0'],
      utxoTreeOut: '0',
      utxoBatchStartPositionOut: '2620',
      railgunTxidIfHasUnshield:
        '2967525509447727484514958839053014339821338949656708121394591099367581498728',
      railgunTxidMerkleProofIndices: '1043',
      railgunTxidMerkleProofPathElements: [
        '21410550798822251959327229769181307417569544363500485487100459193861498779822',
        '5961687698284637681686228032914069481176955360469039662529185098365433603571',
        '17304964017425245837245007125719265991803728175117793869722555928375309074137',
        '9893620356661964132345231362959695747219929668794560607696266375222927280430',
        '16845477297928304901372746220156988797660672780343008294789027661177311150152',
        '17727856394977143550169231988650432781662452954140227756903087497768870863182',
        '1045215142761782288357997991180482086529326513939847615958653237741705985419',
        '15279267187901251041424303274451696783180826423132486848667623992261812131336',
        '16736886623818773524263138779809916105169520362832964900272252437275369959388',
        '16415580715665869864634788741927065679186058985255106992778939765291984104497',
        '11207355884318475250736703385253592706279340885330047958879394498880614473289',
        '11013175031749877081979736330659999751637067247483574805902945041305483682579',
        '10708260192616993577686743465610377735773279483333447100671640147037242870779',
        '17708681376628530799996447981717676562184543188562031708516142906406141650368',
        '3967876508977884960877910167550068853181553556854105674925421366723704424223',
        '18077967785446169488603147322170139942753858441115263187838141084900323103797',
      ],
      poiMerkleroots: [
        '20315461434123414189578310168541443782027718018018733334707489364231528962395',
        '5882284859942711000212908164407162415129889125743404679641828098900462212047',
        '15047380007759208642505447063473120046451970869066098813559644136942025328727',
      ],
      poiInMerkleProofIndices: ['0', '0', '0'],
      poiInMerkleProofPathElements: [
        [
          '395104381622331681994341994098385280516913014509415908093959802811571092274',
          '395104381622331681994341994098385280516913014509415908093959802811571092274',
          '395104381622331681994341994098385280516913014509415908093959802811571092274',
          '395104381622331681994341994098385280516913014509415908093959802811571092274',
          '395104381622331681994341994098385280516913014509415908093959802811571092274',
          '395104381622331681994341994098385280516913014509415908093959802811571092274',
          '395104381622331681994341994098385280516913014509415908093959802811571092274',
          '395104381622331681994341994098385280516913014509415908093959802811571092274',
          '395104381622331681994341994098385280516913014509415908093959802811571092274',
          '395104381622331681994341994098385280516913014509415908093959802811571092274',
          '395104381622331681994341994098385280516913014509415908093959802811571092274',
          '395104381622331681994341994098385280516913014509415908093959802811571092274',
          '395104381622331681994341994098385280516913014509415908093959802811571092274',
          '395104381622331681994341994098385280516913014509415908093959802811571092274',
          '395104381622331681994341994098385280516913014509415908093959802811571092274',
          '395104381622331681994341994098385280516913014509415908093959802811571092274',
        ],
        [
          '191129504180180103627246303029168072485095018026294808381844318028760959246',
          '191129504180180103627246303029168072485095018026294808381844318028760959246',
          '191129504180180103627246303029168072485095018026294808381844318028760959246',
          '191129504180180103627246303029168072485095018026294808381844318028760959246',
          '191129504180180103627246303029168072485095018026294808381844318028760959246',
          '191129504180180103627246303029168072485095018026294808381844318028760959246',
          '191129504180180103627246303029168072485095018026294808381844318028760959246',
          '191129504180180103627246303029168072485095018026294808381844318028760959246',
          '191129504180180103627246303029168072485095018026294808381844318028760959246',
          '191129504180180103627246303029168072485095018026294808381844318028760959246',
          '191129504180180103627246303029168072485095018026294808381844318028760959246',
          '191129504180180103627246303029168072485095018026294808381844318028760959246',
          '191129504180180103627246303029168072485095018026294808381844318028760959246',
          '191129504180180103627246303029168072485095018026294808381844318028760959246',
          '191129504180180103627246303029168072485095018026294808381844318028760959246',
          '191129504180180103627246303029168072485095018026294808381844318028760959246',
        ],
        [
          '43887562207211760050310843386396947124552389524088547038254393672429031885',
          '43887562207211760050310843386396947124552389524088547038254393672429031885',
          '43887562207211760050310843386396947124552389524088547038254393672429031885',
          '43887562207211760050310843386396947124552389524088547038254393672429031885',
          '43887562207211760050310843386396947124552389524088547038254393672429031885',
          '43887562207211760050310843386396947124552389524088547038254393672429031885',
          '43887562207211760050310843386396947124552389524088547038254393672429031885',
          '43887562207211760050310843386396947124552389524088547038254393672429031885',
          '43887562207211760050310843386396947124552389524088547038254393672429031885',
          '43887562207211760050310843386396947124552389524088547038254393672429031885',
          '43887562207211760050310843386396947124552389524088547038254393672429031885',
          '43887562207211760050310843386396947124552389524088547038254393672429031885',
          '43887562207211760050310843386396947124552389524088547038254393672429031885',
          '43887562207211760050310843386396947124552389524088547038254393672429031885',
          '43887562207211760050310843386396947124552389524088547038254393672429031885',
          '43887562207211760050310843386396947124552389524088547038254393672429031885',
        ],
      ],
    };

    const railgunTransaction = createRailgunTransactionWithHash(
      {
        graphID: '',
        boundParamsHash: nToHex(BigInt(testVector.boundParamsHash), ByteLength.UINT_256),
        commitments: testVector.commitmentsOut.map((commitment) =>
          nToHex(BigInt(commitment), ByteLength.UINT_256),
        ),
        nullifiers: testVector.nullifiers.map((commitment) =>
          nToHex(BigInt(commitment), ByteLength.UINT_256),
        ),
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
    // const railgunTxidMerkleproof = await txidMerkletree.getMerkleProof(0, 0);
    const inputMerkleProof: MerkleProof = {
      root: nToHex(
        BigInt(testVector.anyRailgunTxidMerklerootAfterTransaction),
        ByteLength.UINT_256,
      ),
      indices: testVector.railgunTxidMerkleProofIndices,
      elements: testVector.railgunTxidMerkleProofPathElements.map((element) =>
        nToHex(BigInt(element), ByteLength.UINT_256),
      ),
      leaf: railgunTransaction.hash,
    };
    // expect(railgunTxidMerkleproof).to.deep.equal(inputMerkleProof);
    expect(verifyMerkleProof(inputMerkleProof)).to.equal(true);

    // const inputs = 3;
    // for (let i = 0; i < inputs; i += 1) {
    //   const poiMerkleProof: MerkleProof = {
    //     root: nToHex(BigInt(testVector.poiMerkleroots[i]), ByteLength.UINT_256),
    //     indices: testVector.poiInMerkleProofIndices[i],
    //     elements: testVector.poiInMerkleProofPathElements[i].map((element) =>
    //       nToHex(BigInt(element), ByteLength.UINT_256),
    //     ),
    //     leaf: railgunTransaction.hash,
    //   };
    //   expect(verifyMerkleProof(poiMerkleProof)).to.equal(true);
    // }

    const nullifier = TransactNote.getNullifier(
      BigInt(testVector.nullifyingKey),
      Number(testVector.utxoPositionsIn[0]),
    );
    expect(nullifier).to.equal(BigInt(testVector.nullifiers[0]));

    // Verify shield note details
    const masterPublicKey = WalletNode.getMasterPublicKey(
      [BigInt(testVector.spendingPublicKey[0]), BigInt(testVector.spendingPublicKey[1])],
      BigInt(testVector.nullifyingKey),
    );

    const notePublicKey = ShieldNote.getNotePublicKey(masterPublicKey, testVector.randomsIn[0]);
    const shieldCommitment = ShieldNote.getShieldNoteHash(
      notePublicKey,
      testVector.token,
      BigInt(testVector.valuesIn[0]),
    );

    const blindedCommitmentForShield = BigInt(
      getBlindedCommitmentForShieldOrTransact(
        nToHex(shieldCommitment, ByteLength.UINT_256),
        notePublicKey,
        getGlobalTreePosition(0, 0),
      ),
    );
    // expect(blindedCommitmentForShield).to.equal(BigInt(testVector.blindedCommitmentsIn[0]));
  });
});
