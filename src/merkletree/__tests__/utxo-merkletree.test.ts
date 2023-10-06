import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import memdown from 'memdown';
import { BN } from 'bn.js';
import { Commitment, CommitmentType, TokenType } from '../../models/formatted-types';
import { Chain, ChainType } from '../../models/engine-types';
import { Database } from '../../database/database';
import { Merkletree } from '../merkletree';
import { UTXOMerkletree } from '../utxo-merkletree';
import { TOKEN_SUB_ID_NULL } from '../../models/transaction-constants';
import { TXIDVersion, UnshieldStoredEvent } from '../../models';
import { MERKLE_ZERO_VALUE, MerkletreesMetadata } from '../../models/merkletree-types';
import { verifyMerkleProof } from '../merkle-proof';

chai.use(chaiAsPromised);
const { expect } = chai;

const txidVersion = TXIDVersion.V2_PoseidonMerkle;

// Database object
let db: Database;
let merkletree: UTXOMerkletree;

const chain: Chain = {
  type: 0,
  id: 0,
};

describe('utxo-merkletree', () => {
  beforeEach(async () => {
    // Create database
    db = new Database(memdown());
    merkletree = await UTXOMerkletree.create(db, chain, txidVersion, async () => true);
  });

  it('Should hash left/right', () => {
    const vectors = [
      {
        left: '115cc0f5e7d690413df64c6b9662e9cf2a3617f2743245519e19607a4417189a',
        right: '2a92a4c8d7c21d97d946951043d11954de794cd506093dbbb97ada64c14b203b',
        result: '106dc6dc79863b23dc1a63c7ca40e8c22bb830e449b75a2286c7f7b0b87ae6c3',
      },
      {
        left: '0db945439b762ad08f144bcccc3746773b332e8a0045a11d87662dc227923df5',
        right: '09ce612d20912e20cde93cd2a03fcccdfdce5910242b555ff35b5373041bf329',
        result: '063c1c7dfb4b63255c492bb6b32d57eddddcb1c78cfb990e7b35416cf966ed79',
      },
      {
        left: '09cf3efaeb0190e482c9f9cf1534f17fbf0ed1537c26db9faf26f3d55140804d',
        right: '2651021f2d224338f1c9f408db74111c98e7381072b9fcd640bd4f748584e769',
        result: '1576a4dd906cab90e381775c1c9bb1d713f7f02c7ec0911a8bc38a1c4b0bf69e',
      },
    ];

    vectors.forEach((vector) => {
      expect(Merkletree.hashLeftRight(vector.left, vector.right)).to.equal(vector.result);
    });
  });

  it('Should calculate zero values', () => {
    const testVector = [
      '0488f89b25bc7011eaf6a5edce71aeafb9fe706faa3c0a5cd9cbe868ae3b9ffc',
      '01c405064436affeae1fc8e30b2e417b4243bbb819adca3b55bb32efc3e43a4f',
      '0888d37652d10d1781db54b70af87b42a2916e87118f507218f9a42a58e85ed2',
      '183f531ead7217ebc316b4c02a2aad5ad87a1d56d4fb9ed81bf84f644549eaf5',
      '093c48f1ecedf2baec231f0af848a57a76c6cf05b290a396707972e1defd17df',
      '1437bb465994e0453357c17a676b9fdba554e215795ebc17ea5012770dfb77c7',
      '12359ef9572912b49f44556b8bbbfa69318955352f54cfa35cb0f41309ed445a',
      '2dc656dadc82cf7a4707786f4d682b0f130b6515f7927bde48214d37ec25a46c',
      '2500bdfc1592791583acefd050bc439a87f1d8e8697eb773e8e69b44973e6fdc',
      '244ae3b19397e842778b254cd15c037ed49190141b288ff10eb1390b34dc2c31',
      '0ca2b107491c8ca6e5f7e22403ea8529c1e349a1057b8713e09ca9f5b9294d46',
      '18593c75a9e42af27b5e5b56b99c4c6a5d7e7d6e362f00c8e3f69aeebce52313',
      '17aca915b237b04f873518947a1f440f0c1477a6ac79299b3be46858137d4bfb',
      '2726c22ad3d9e23414887e8233ee83cc51603f58c48a9c9e33cb1f306d4365c0',
      '08c5bd0f85cef2f8c3c1412a2b69ee943c6925ecf79798bb2b84e1b76d26871f',
      '27f7c465045e0a4d8bec7c13e41d793734c50006ca08920732ce8c3096261435',
      '14fceeac99eb8419a2796d1958fc2050d489bf5a3eb170ef16a667060344ba90',
    ];

    expect(merkletree.zeros).to.deep.equal(testVector);
  });

  it('Should get DB paths', async () => {
    type Vector = {
      chain: Chain;
      treeNumber: number;
      level: number;
      index: number;
      result: string[];
    };

    const vectors: Vector[] = [
      {
        chain: { type: ChainType.EVM, id: 0 },
        treeNumber: 0,
        level: 1,
        index: 5,
        result: [
          '000000000000000000000000000000006d65726b6c65747265652d6572633230',
          '0000000000000000000000000000000000000000000000000000000000000000',
          '0000000000000000000000000000000000000000000000000000000000005632',
          '0000000000000000000000000000000000000000000000000000000000000000',
          '0000000000000000000000000000000000000000000000000000000000000001',
          '0000000000000000000000000000000000000000000000000000000000000005',
        ],
      },
      {
        chain: { type: ChainType.EVM, id: 4 },
        treeNumber: 2,
        level: 7,
        index: 10,
        result: [
          '000000000000000000000000000000006d65726b6c65747265652d6572633230',
          '0000000000000000000000000000000000000000000000000000000000000004',
          '0000000000000000000000000000000000000000000000000000000000005632',
          '0000000000000000000000000000000000000000000000000000000000000002',
          '0000000000000000000000000000000000000000000000000000000000000007',
          '000000000000000000000000000000000000000000000000000000000000000a',
        ],
      },
    ];

    await Promise.all(
      vectors.map(async (vector) => {
        const merkletreeVectorTest = await UTXOMerkletree.create(
          db,
          vector.chain,
          txidVersion,
          async () => true,
        );

        expect(merkletreeVectorTest.getTreeDBPrefix(vector.treeNumber)).to.deep.equal(
          vector.result.slice(0, 4),
        );

        expect(
          merkletreeVectorTest.getNodeHashDBPath(vector.treeNumber, vector.level, vector.index),
        ).to.deep.equal(vector.result);
      }),
    );
  });

  it('Should get empty merkle root', async () => {
    expect(MERKLE_ZERO_VALUE).to.equal(
      '0488f89b25bc7011eaf6a5edce71aeafb9fe706faa3c0a5cd9cbe868ae3b9ffc', // from new contract
    );
    expect(await merkletree.getRoot(0)).to.equal(
      '14fceeac99eb8419a2796d1958fc2050d489bf5a3eb170ef16a667060344ba90',
    );
  });

  it('Should update merkle tree correctly', async () => {
    expect(await merkletree.getRoot(0)).to.equal(
      '14fceeac99eb8419a2796d1958fc2050d489bf5a3eb170ef16a667060344ba90',
    );

    const ciphertext = {
      ciphertext: { iv: '', tag: '', data: [] },
      memo: [''],
      ephemeralKeys: ['', ''],
    };
    await merkletree.queueLeaves(0, 5, [
      {
        commitmentType: CommitmentType.LegacyEncryptedCommitment,
        hash: 'ab2f9d1ebd74c3e1f1ccee452a80ae27a94f14a542a4fd8b0c9ad9a1b7f9ffe5',
        txid: '0x1097c636f99f179de275635277e458820485039b0a37088a5d657b999f73b59b',
        ciphertext,
        timestamp: undefined,
        blockNumber: 0,
        utxoTree: 0,
        utxoIndex: 0,
        railgunTxid: undefined,
      },
      {
        commitmentType: CommitmentType.LegacyEncryptedCommitment,
        hash: '8902638fe6fc05e4f1cd7c06940d6217591a0ccb003ed45198782fbff38e9f2d',
        txid: '0x1097c636f99f179de275635277e458820485039b0a37088a5d657b999f73b59b',
        ciphertext,
        timestamp: undefined,
        blockNumber: 0,
        utxoTree: 0,
        utxoIndex: 0,
        railgunTxid: undefined,
      },
      {
        commitmentType: CommitmentType.LegacyEncryptedCommitment,
        hash: '19889087c2ff4c4a164060a832a3ba11cce0c2e2dbd42da10c57101efb966fcd',
        txid: '0x1097c636f99f179de275635277e458820485039b0a37088a5d657b999f73b59b',
        ciphertext,
        timestamp: undefined,
        blockNumber: 0,
        utxoTree: 0,
        utxoIndex: 0,
        railgunTxid: undefined,
      },
      {
        commitmentType: CommitmentType.LegacyEncryptedCommitment,
        hash: '9f5e8310e384c6a0840699951d67810c6d90fd3f265bda66e9385fcb7142373d',
        txid: '0x1097c636f99f179de275635277e458820485039b0a37088a5d657b999f73b59b',
        ciphertext,
        timestamp: undefined,
        blockNumber: 0,
        utxoTree: 0,
        utxoIndex: 0,
        railgunTxid: undefined,
      },
      {
        commitmentType: CommitmentType.LegacyEncryptedCommitment,
        hash: '4c71361b89e9b6b55b094a0f0de4451d8306786b2626d67b3810c9b61fbf45b6',
        txid: '0x1097c636f99f179de275635277e458820485039b0a37088a5d657b999f73b59b',
        ciphertext,
        timestamp: undefined,
        blockNumber: 0,
        utxoTree: 0,
        utxoIndex: 0,
        railgunTxid: undefined,
      },
      {
        commitmentType: CommitmentType.LegacyEncryptedCommitment,
        hash: 'b2eabd832f0bb9d8b42399a56821a565eec64669d7a55b828c8af2a541b044d6',
        txid: '0x1097c636f99f179de275635277e458820485039b0a37088a5d657b999f73b59b',
        ciphertext,
        timestamp: undefined,
        blockNumber: 0,
        utxoTree: 0,
        utxoIndex: 0,
        railgunTxid: undefined,
      },
      {
        commitmentType: CommitmentType.LegacyEncryptedCommitment,
        hash: '817e6732d170352ea6517c9640757570d4ea71c660603f9d7a060b2f2eb27be6',
        txid: '0x1097c636f99f179de275635277e458820485039b0a37088a5d657b999f73b59b',
        ciphertext,
        timestamp: undefined,
        blockNumber: 0,
        utxoTree: 0,
        utxoIndex: 0,
        railgunTxid: undefined,
      },
    ]);
    await merkletree.updateTreesFromWriteQueue();

    expect(await merkletree.getTreeLength(0)).to.equal(0);
    expect(await merkletree.getRoot(0)).to.equal(
      '14fceeac99eb8419a2796d1958fc2050d489bf5a3eb170ef16a667060344ba90',
    );

    await merkletree.queueLeaves(0, 3, [
      {
        commitmentType: CommitmentType.LegacyEncryptedCommitment,
        hash: '04',
        txid: '0x1097c636f99f179de275635277e458820485039b0a37088a5d657b999f73b59b',
        ciphertext,
        blockNumber: 0,
        utxoTree: 0,
        utxoIndex: 0,
        railgunTxid: undefined,
        timestamp: undefined,
      },
    ]);

    expect(await merkletree.getTreeLength(0)).to.equal(0);
    expect(await merkletree.getRoot(0)).to.equal(
      '14fceeac99eb8419a2796d1958fc2050d489bf5a3eb170ef16a667060344ba90',
    );

    await merkletree.queueLeaves(0, 0, [
      {
        commitmentType: CommitmentType.LegacyEncryptedCommitment,
        hash: '01',
        txid: '0x1097c636f99f179de275635277e458820485039b0a37088a5d657b999f73b59b',
        ciphertext,
        blockNumber: 0,
        utxoTree: 0,
        utxoIndex: 0,
        railgunTxid: undefined,
        timestamp: undefined,
      },
      {
        commitmentType: CommitmentType.LegacyEncryptedCommitment,
        hash: '02',
        txid: '0x1097c636f99f179de275635277e458820485039b0a37088a5d657b999f73b59b',
        ciphertext,
        blockNumber: 0,
        utxoTree: 0,
        utxoIndex: 0,
        railgunTxid: undefined,
        timestamp: undefined,
      },
      {
        commitmentType: CommitmentType.LegacyEncryptedCommitment,
        hash: '03',
        txid: '0x1097c636f99f179de275635277e458820485039b0a37088a5d657b999f73b59b',
        ciphertext,
        blockNumber: 0,
        utxoTree: 0,
        utxoIndex: 0,
        railgunTxid: undefined,
        timestamp: undefined,
      },
    ]);
    await merkletree.updateTreesFromWriteQueue();

    expect(await merkletree.getTreeLength(0)).to.equal(4);
    expect(await merkletree.getRoot(0)).to.equal(
      // '15fda59fe7ba18babd0b0559e71dae6cd1a96bd8f56205301e05251e879ad791',
      '2f4c02f094b5c881b9a2d25539d50bc839652b96acb147b81181922064b25f29', // @todo failing
    );

    await Promise.all([
      merkletree.queueLeaves(0, 4, [
        {
          commitmentType: CommitmentType.LegacyEncryptedCommitment,
          hash: '05',
          txid: '0x1097c636f99f179de275635277e458820485039b0a37088a5d657b999f73b59b',
          ciphertext,
          blockNumber: 0,
          utxoTree: 0,
          utxoIndex: 0,
          railgunTxid: undefined,
          timestamp: undefined,
        },
      ]),
      merkletree.queueLeaves(0, 4, [
        {
          commitmentType: CommitmentType.LegacyEncryptedCommitment,
          hash: '05',
          txid: '0x1097c636f99f179de275635277e458820485039b0a37088a5d657b999f73b59b',
          ciphertext,
          blockNumber: 0,
          utxoTree: 0,
          utxoIndex: 0,
          railgunTxid: undefined,
          timestamp: undefined,
        },
      ]),
    ]);
    await merkletree.updateTreesFromWriteQueue();

    await merkletree.queueLeaves(0, 4, [
      {
        commitmentType: CommitmentType.LegacyEncryptedCommitment,
        hash: '05',
        txid: '0x1097c636f99f179de275635277e458820485039b0a37088a5d657b999f73b59b',
        ciphertext,
        blockNumber: 0,
        utxoTree: 0,
        utxoIndex: 0,
        railgunTxid: undefined,
        timestamp: undefined,
      },
    ]);
    await merkletree.updateTreesFromWriteQueue();

    expect(await merkletree.getTreeLength(0)).to.equal(12);
    expect(await merkletree.getRoot(0)).to.equal(
      '1955726bb6619868e0435b3342b33644c8ecc9579bcbc31b41e0175d766a1e5c',
    );
  }).timeout(100000);

  it('Should insert and retrieve commitment objects', async () => {
    // Insert leaves
    await merkletree.queueLeaves(0, 0, [
      {
        commitmentType: CommitmentType.LegacyEncryptedCommitment,
        hash: '02',
        txid: '0x1097c636f99f179de275635277e458820485039b0a37088a5d657b999f73b59b',
        ciphertext: {
          ciphertext: {
            data: ['03', '04'],
            iv: '02',
            tag: '05',
          },
          ephemeralKeys: ['00', '00'],
          memo: [''],
        },
        blockNumber: 0,
        utxoTree: 0,
        utxoIndex: 0,
        railgunTxid: undefined,
        timestamp: undefined,
      },
      {
        commitmentType: CommitmentType.LegacyGeneratedCommitment,
        hash: '04',
        txid: '0x1097c636f99f179de275635277e458820485039b0a37088a5d657b999f73b59b',
        preImage: {
          npk: '00',
          value: '02',
          token: {
            tokenAddress: '0x03',
            tokenType: TokenType.ERC20,
            tokenSubID: TOKEN_SUB_ID_NULL,
          },
        },
        encryptedRandom: ['01', '01'],
        blockNumber: 0,
        utxoTree: 0,
        utxoIndex: 0,
        timestamp: undefined,
      },
    ]);
    await merkletree.updateTreesFromWriteQueue();

    expect(await merkletree.getCommitment(0, 0)).to.deep.equal({
      commitmentType: CommitmentType.LegacyEncryptedCommitment,
      hash: '02',
      txid: '0x1097c636f99f179de275635277e458820485039b0a37088a5d657b999f73b59b',
      ciphertext: {
        ciphertext: { iv: '02', tag: '05', data: ['03', '04'] },
        memo: [''],
        ephemeralKeys: ['00', '00'],
      },
      blockNumber: 0,
      utxoTree: 0,
      utxoIndex: 0,
    });

    expect(await merkletree.getCommitment(0, 1)).to.deep.equal({
      commitmentType: CommitmentType.LegacyGeneratedCommitment,
      hash: '04',
      txid: '0x1097c636f99f179de275635277e458820485039b0a37088a5d657b999f73b59b',
      preImage: {
        npk: '00',
        value: '02',
        token: { tokenAddress: '0x03', tokenType: 0, tokenSubID: TOKEN_SUB_ID_NULL },
      },
      encryptedRandom: ['01', '01'],
      blockNumber: 0,
      utxoTree: 0,
      utxoIndex: 0,
    });
  }).timeout(1000);

  it('Should generate and validate merkle proofs', async () => {
    const ciphertext = {
      ciphertext: { iv: '', tag: '', data: [] },
      memo: [''],
      ephemeralKeys: ['', ''],
    };
    // Insert leaves
    await merkletree.queueLeaves(0, 0, [
      {
        commitmentType: CommitmentType.LegacyEncryptedCommitment,
        hash: '02',
        txid: '0x1097c636f99f179de275635277e458820485039b0a37088a5d657b999f73b59b',
        ciphertext,
        blockNumber: 0,
        utxoTree: 0,
        utxoIndex: 0,
        railgunTxid: undefined,
        timestamp: undefined,
      },
      {
        commitmentType: CommitmentType.LegacyEncryptedCommitment,
        hash: '04',
        txid: '0x1097c636f99f179de275635277e458820485039b0a37088a5d657b999f73b59b',
        ciphertext,
        blockNumber: 0,
        utxoTree: 0,
        utxoIndex: 0,
        railgunTxid: undefined,
        timestamp: undefined,
      },
      {
        commitmentType: CommitmentType.LegacyEncryptedCommitment,
        hash: '08',
        txid: '0x1097c636f99f179de275635277e458820485039b0a37088a5d657b999f73b59b',
        ciphertext,
        blockNumber: 0,
        utxoTree: 0,
        utxoIndex: 0,
        railgunTxid: undefined,
        timestamp: undefined,
      },
      {
        commitmentType: CommitmentType.LegacyEncryptedCommitment,
        hash: '10',
        txid: '0x1097c636f99f179de275635277e458820485039b0a37088a5d657b999f73b59b',
        ciphertext,
        blockNumber: 0,
        utxoTree: 0,
        utxoIndex: 0,
        railgunTxid: undefined,
        timestamp: undefined,
      },
      {
        commitmentType: CommitmentType.LegacyEncryptedCommitment,
        hash: '20',
        txid: '0x1097c636f99f179de275635277e458820485039b0a37088a5d657b999f73b59b',
        ciphertext,
        blockNumber: 0,
        utxoTree: 0,
        utxoIndex: 0,
        railgunTxid: undefined,
        timestamp: undefined,
      },
      {
        commitmentType: CommitmentType.LegacyEncryptedCommitment,
        hash: '40',
        txid: '0x1097c636f99f179de275635277e458820485039b0a37088a5d657b999f73b59b',
        ciphertext,
        blockNumber: 0,
        utxoTree: 0,
        utxoIndex: 0,
        railgunTxid: undefined,
        timestamp: undefined,
      },
    ]);
    await merkletree.updateTreesFromWriteQueue();

    // Get proof
    const proof = await merkletree.getMerkleProof(0, 3);

    // Check proof is what we expect
    expect(proof).to.deep.equal({
      leaf: '10',
      elements: [
        '08',
        '022678592fe7f282774b001df184b9448e46f7bc5b4d879f7f545a09f6e77feb',
        '071f842dbbae18082c04bfd08f4a56d71e1444317bfc6417dae8ac604d9493de',
        '183f531ead7217ebc316b4c02a2aad5ad87a1d56d4fb9ed81bf84f644549eaf5',
        '093c48f1ecedf2baec231f0af848a57a76c6cf05b290a396707972e1defd17df',
        '1437bb465994e0453357c17a676b9fdba554e215795ebc17ea5012770dfb77c7',
        '12359ef9572912b49f44556b8bbbfa69318955352f54cfa35cb0f41309ed445a',
        '2dc656dadc82cf7a4707786f4d682b0f130b6515f7927bde48214d37ec25a46c',
        '2500bdfc1592791583acefd050bc439a87f1d8e8697eb773e8e69b44973e6fdc',
        '244ae3b19397e842778b254cd15c037ed49190141b288ff10eb1390b34dc2c31',
        '0ca2b107491c8ca6e5f7e22403ea8529c1e349a1057b8713e09ca9f5b9294d46',
        '18593c75a9e42af27b5e5b56b99c4c6a5d7e7d6e362f00c8e3f69aeebce52313',
        '17aca915b237b04f873518947a1f440f0c1477a6ac79299b3be46858137d4bfb',
        '2726c22ad3d9e23414887e8233ee83cc51603f58c48a9c9e33cb1f306d4365c0',
        '08c5bd0f85cef2f8c3c1412a2b69ee943c6925ecf79798bb2b84e1b76d26871f',
        '27f7c465045e0a4d8bec7c13e41d793734c50006ca08920732ce8c3096261435',
      ],
      indices: '0000000000000000000000000000000000000000000000000000000000000003',
      root: '215b6e027da417c086db7e55d19c6d2cc270a0c2d54a2b2cd9ae8d40d0c250b3',
    });

    // Check proof verification
    expect(verifyMerkleProof(proof)).to.equal(true);

    // Insert leaves
    await merkletree.queueLeaves(
      1,
      0,
      Array.from(Array(600).keys()).map((el) => ({
        commitmentType: CommitmentType.LegacyEncryptedCommitment,
        hash: new BN(el, 10).toString(16),
        txid: '0x1097c636f99f179de275635277e458820485039b0a37088a5d657b999f73b59b',
        ciphertext: {
          ciphertext: { iv: '', tag: '', data: [] },
          ephemeralKeys: ['', ''],
          memo: [''],
        },
        blockNumber: 0,
        utxoTree: 0,
        utxoIndex: 0,
        railgunTxid: undefined,
        timestamp: undefined,
      })),
    );
    await merkletree.updateTreesFromWriteQueue();

    // Get proof
    const proof2 = await merkletree.getMerkleProof(1, 34);

    expect(proof2.root).to.not.equal(proof.root);
    // Check proof is what we expect
    expect(proof2).to.deep.equal({
      leaf: '22',
      elements: [
        '23',
        '247cfdf15ecc8d7a4ef60dd8b7820179192255dd4beaa88c54343c700d13a189',
        '1794b7d113df3e3faa29d83bad231e7ea7d51d00815edd2ff28097d3c492aa0c',
        '17081a99ce40d1c5d003f01a462f1c562b7bc270670e456c8dff88e179522ee8',
        '0ae1aa1fcfa979118582a0485d05c90a60f78d5363e87ee31a52c945ffd3144b',
        '00bd653e9610271024856584fe987a628ca86f800a887dc02cbb1b902db64f29',
        '1368af2e95b983d71c23b33fc74311a495435281e090b33a763ef3fa0968bfca',
        '1547779f3b40b10f4928f34d82f57aaa095e0a7c3d3085bb2a2ae5162a410d7e',
        '270ddd6ee97cdf21d4d9172cb584812a7cfe0fd2aa40f0b8d352a1052cbf5ac4',
        '1fdbd35bf83f6aa6987aa8301fbec0539414bd42871feb8bf9bb5c7bf04cb667',
        '0ca2b107491c8ca6e5f7e22403ea8529c1e349a1057b8713e09ca9f5b9294d46',
        '18593c75a9e42af27b5e5b56b99c4c6a5d7e7d6e362f00c8e3f69aeebce52313',
        '17aca915b237b04f873518947a1f440f0c1477a6ac79299b3be46858137d4bfb',
        '2726c22ad3d9e23414887e8233ee83cc51603f58c48a9c9e33cb1f306d4365c0',
        '08c5bd0f85cef2f8c3c1412a2b69ee943c6925ecf79798bb2b84e1b76d26871f',
        '27f7c465045e0a4d8bec7c13e41d793734c50006ca08920732ce8c3096261435',
      ],
      indices: '0000000000000000000000000000000000000000000000000000000000000022',
      root: '1abfe84b40d5fbbebf8fce3a5838633f6f4de4d6a63c5a26c3eed8001e00e587',
    });

    // Check proof verification
    expect(verifyMerkleProof(proof2)).to.equal(true);
    proof2.root = proof.root;
    expect(verifyMerkleProof(proof2)).to.equal(false);
    proof2.elements = proof.elements;
    expect(verifyMerkleProof(proof2)).to.equal(false);
  }).timeout(1000);

  it("Shouldn't write invalid batches", async () => {
    // Validate function always returns false
    const merkletreeTest = await UTXOMerkletree.create(db, chain, txidVersion, async () => false);

    // Check root is empty tree root
    expect(await merkletreeTest.getRoot(0)).to.equal(
      '14fceeac99eb8419a2796d1958fc2050d489bf5a3eb170ef16a667060344ba90',
    );

    const ciphertext = {
      ciphertext: { iv: '', tag: '', data: [] },
      memo: [''],
      ephemeralKeys: ['', ''],
    };
    const leaves: Commitment[] = [
      {
        commitmentType: CommitmentType.LegacyEncryptedCommitment,
        hash: '02',
        txid: '0x1097c636f99f179de275635277e458820485039b0a37088a5d657b999f73b59b',
        ciphertext,
        blockNumber: 0,
        utxoTree: 0,
        utxoIndex: 0,
        railgunTxid: undefined,
        timestamp: undefined,
      },
      {
        commitmentType: CommitmentType.LegacyEncryptedCommitment,
        hash: '04',
        txid: '0x1097c636f99f179de275635277e458820485039b0a37088a5d657b999f73b59b',
        ciphertext,
        blockNumber: 0,
        utxoTree: 0,
        utxoIndex: 0,
        railgunTxid: undefined,
        timestamp: undefined,
      },
      {
        commitmentType: CommitmentType.LegacyEncryptedCommitment,
        hash: '08',
        txid: '0x1097c636f99f179de275635277e458820485039b0a37088a5d657b999f73b59b',
        ciphertext,
        blockNumber: 0,
        utxoTree: 0,
        utxoIndex: 0,
        railgunTxid: undefined,
        timestamp: undefined,
      },
      {
        commitmentType: CommitmentType.LegacyEncryptedCommitment,
        hash: '10',
        txid: '0x1097c636f99f179de275635277e458820485039b0a37088a5d657b999f73b59b',
        ciphertext,
        blockNumber: 0,
        utxoTree: 0,
        utxoIndex: 0,
        railgunTxid: undefined,
        timestamp: undefined,
      },
      {
        commitmentType: CommitmentType.LegacyEncryptedCommitment,
        hash: '20',
        txid: '0x1097c636f99f179de275635277e458820485039b0a37088a5d657b999f73b59b',
        ciphertext,
        blockNumber: 0,
        utxoTree: 0,
        utxoIndex: 0,
        railgunTxid: undefined,
        timestamp: undefined,
      },
      {
        commitmentType: CommitmentType.LegacyEncryptedCommitment,
        hash: '40',
        txid: '0x1097c636f99f179de275635277e458820485039b0a37088a5d657b999f73b59b',
        ciphertext,
        blockNumber: 0,
        utxoTree: 0,
        utxoIndex: 0,
        railgunTxid: undefined,
        timestamp: undefined,
      },
    ];
    // Insert leaves
    await merkletreeTest.queueLeaves(0, 0, leaves);
    await merkletreeTest.updateTreesFromWriteQueue();

    // Batch should have been rejected
    expect(await merkletreeTest.getRoot(0)).to.equal(
      '14fceeac99eb8419a2796d1958fc2050d489bf5a3eb170ef16a667060344ba90',
    );
  }).timeout(1000);

  it('Should store nullifiers', async () => {
    expect(await merkletree.getNullifierTxid('00')).to.equal(undefined);
    await merkletree.nullify([{ nullifier: '00', treeNumber: 0, txid: '01', blockNumber: 0 }]);
    expect(await merkletree.getNullifierTxid('00')).to.equal('01');
  }).timeout(1000);

  it('Should store and retrieve unshield events', async () => {
    expect(await merkletree.getUnshieldEvents('0')).to.deep.equal([]);
    const unshieldA1: UnshieldStoredEvent = {
      txid: '0',
      toAddress: '123',
      tokenType: 1,
      tokenAddress: '0x4567',
      tokenSubID: '0x00',
      amount: '0x1234567890',
      fee: '0x7890',
      blockNumber: 0,
      eventLogIndex: 0,
      timestamp: undefined,
      railgunTxid: undefined,
      poisPerList: undefined,
    };
    const unshieldB1: UnshieldStoredEvent = {
      txid: '1',
      toAddress: '123',
      tokenType: 1,
      tokenAddress: '0x1234',
      tokenSubID: '0x00',
      amount: '0x123456',
      fee: '0x7890',
      blockNumber: 0,
      eventLogIndex: 0,
      timestamp: undefined,
      railgunTxid: undefined,
      poisPerList: undefined,
    };
    const unshieldB2: UnshieldStoredEvent = {
      txid: '1',
      toAddress: '123',
      tokenType: 1,
      tokenAddress: '0x1234',
      tokenSubID: '0x00',
      amount: '0x123456',
      fee: '0x7890',
      blockNumber: 0,
      eventLogIndex: 1,
      timestamp: undefined,
      railgunTxid: undefined,
      poisPerList: undefined,
    };
    await merkletree.addUnshieldEvents([unshieldA1, unshieldB1, unshieldB2]);

    delete unshieldA1.railgunTxid;
    delete unshieldA1.poisPerList;

    delete unshieldB1.railgunTxid;
    delete unshieldB1.poisPerList;

    delete unshieldB2.railgunTxid;
    delete unshieldB2.poisPerList;

    expect(await merkletree.getUnshieldEvents('0')).to.deep.equal([unshieldA1]);
    expect(await merkletree.getUnshieldEvents('1')).to.deep.equal([unshieldB1, unshieldB2]);
  });

  it('Should return latest tree', async () => {
    expect(await merkletree.latestTree()).to.equal(0);

    await merkletree.queueLeaves(0, 0, [
      {
        commitmentType: CommitmentType.LegacyEncryptedCommitment,
        hash: '02',
        txid: '0x1097c636f99f179de275635277e458820485039b0a37088a5d657b999f73b59b',
        ciphertext: {
          ciphertext: { iv: '', tag: '', data: [] },
          ephemeralKeys: ['', ''],
          memo: [''],
        },
        blockNumber: 0,
        utxoTree: 0,
        utxoIndex: 0,
        railgunTxid: undefined,
        timestamp: undefined,
      },
    ]);
    await merkletree.updateTreesFromWriteQueue();

    expect(await merkletree.latestTree()).to.equal(0);
    const expectedMetadata1: MerkletreesMetadata = {
      trees: {
        0: { scannedHeight: 1, invalidMerklerootDetails: null },
      },
    };
    expect(await merkletree.getMerkletreesMetadata()).to.deep.equal(expectedMetadata1);

    await merkletree.queueLeaves(1, 0, [
      {
        commitmentType: CommitmentType.LegacyEncryptedCommitment,
        hash: '02',
        txid: '0x1097c636f99f179de275635277e458820485039b0a37088a5d657b999f73b59b',
        ciphertext: {
          ciphertext: { iv: '', tag: '', data: [] },
          ephemeralKeys: ['', ''],
          memo: [''],
        },
        blockNumber: 0,
        utxoTree: 0,
        utxoIndex: 0,
        railgunTxid: undefined,
        timestamp: undefined,
      },
    ]);
    await merkletree.updateTreesFromWriteQueue();

    expect(await merkletree.latestTree()).to.equal(1);
    expect(await merkletree.getTreeLength(0)).to.equal(1);
    expect(await merkletree.getTreeLength(1)).to.equal(1);
    const expectedMetadata2: MerkletreesMetadata = {
      trees: {
        0: { scannedHeight: 1, invalidMerklerootDetails: null },
        1: { scannedHeight: 1, invalidMerklerootDetails: null },
      },
    };
    expect(await merkletree.getMerkletreesMetadata()).to.deep.equal(expectedMetadata2);
  }).timeout(100000);

  it('Should store and retrieve trees metadata', async () => {
    expect(await merkletree.getMerkletreesMetadata()).to.equal(undefined);

    const newMetadata: MerkletreesMetadata = {
      trees: {
        0: { scannedHeight: 127, invalidMerklerootDetails: null },
        1: { scannedHeight: 333, invalidMerklerootDetails: null },
        2: { scannedHeight: 0, invalidMerklerootDetails: null },
      },
    };
    await merkletree.storeMerkletreesMetadata(newMetadata);

    expect(await merkletree.getMerkletreesMetadata()).to.deep.equal(newMetadata);
    expect(await merkletree.latestTree()).to.equal(1);
  }).timeout(1000);

  it('Should store, update and remove invalid merkleroot details', async () => {
    const tree = 0;
    const blockNumber = 10000000;

    // Add invalid merkleroot details (position 100)
    await merkletree.updateInvalidMerklerootDetails(tree, 100, blockNumber);
    expect(merkletree.invalidMerklerootDetailsByTree[0]).to.deep.equal({
      position: 100,
      blockNumber,
    });

    // Update invalid merkleroot details (position 50)
    await merkletree.updateInvalidMerklerootDetails(tree, 50, blockNumber);
    expect(merkletree.invalidMerklerootDetailsByTree[0]).to.deep.equal({
      position: 50,
      blockNumber,
    });

    // Try to remove merkleroot details (position 30) - no effect
    await merkletree.removeInvalidMerklerootDetailsIfNecessary(tree, 30);
    expect(merkletree.invalidMerklerootDetailsByTree[0]).to.deep.equal({
      position: 50,
      blockNumber,
    });

    // Try to remove merkleroot details (tree 1) - no effect
    await merkletree.removeInvalidMerklerootDetailsIfNecessary(1, 30);
    expect(merkletree.invalidMerklerootDetailsByTree[0]).to.deep.equal({
      position: 50,
      blockNumber,
    });

    const merkletreesMetadata = await merkletree.getMerkletreesMetadata();
    if (!merkletreesMetadata) {
      throw new Error('No metadata saved for invalid merkletree details');
    }
    expect(merkletreesMetadata.trees[tree].invalidMerklerootDetails).to.deep.equal({
      position: 50,
      blockNumber,
    });

    // Check has invalid merkleroot
    expect(merkletree.getFirstInvalidMerklerootTree()).to.equal(tree);

    // Remove merkleroot details
    await merkletree.removeInvalidMerklerootDetailsIfNecessary(tree, 100);

    // Check has invalid merkleroot
    expect(merkletree.getFirstInvalidMerklerootTree()).to.equal(undefined);
  }).timeout(1000);

  afterEach(async () => {
    // Clean up database
    await db.close();
  });
});
