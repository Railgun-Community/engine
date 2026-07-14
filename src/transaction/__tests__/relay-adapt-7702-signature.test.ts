import { expect } from 'chai';
import {
  AbiCoder,
  TypedDataEncoder,
  Wallet,
  concat,
  keccak256,
  recoverAddress,
  toUtf8Bytes,
  verifyTypedData,
} from 'ethers';
import {
  ACTION_DATA_STRUCT_ABI,
  RelayAdapt7702ExecutionType,
  TRANSACTION_STRUCT_ABI,
  getExecutePayloadHash,
  signExecutionAuthorization,
} from '../relay-adapt-7702-signature';
import { TransactionStructV2 } from '../../models/transaction-types';
import { RelayAdapt7702 } from '../../abi/typechain/RelayAdapt7702';
import { TXIDVersion } from '../../models/poi-types';

describe('RelayAdapt7702 Execution Signature', () => {
  it('should sign and recover correctly', async () => {
    const signer = Wallet.createRandom();
    const chainId = 1;

    const mockTransaction: TransactionStructV2 = {
      txidVersion: TXIDVersion.V2_PoseidonMerkle,
      proof: {
        a: { x: 1n, y: 2n },
        b: { x: [3n, 4n], y: [5n, 6n] },
        c: { x: 7n, y: 8n },
      },
      merkleRoot: '0x' + '0'.repeat(64),
      nullifiers: ['0x' + '0'.repeat(64)],
      commitments: ['0x' + '0'.repeat(64)],
      boundParams: {
        treeNumber: 0,
        minGasPrice: 0n,
        unshield: 0,
        chainID: 1n,
        adaptContract: '0x' + '0'.repeat(40),
        adaptParams: '0x' + '0'.repeat(64),
        commitmentCiphertext: [],
      },
      unshieldPreimage: {
        npk: '0x' + '0'.repeat(64),
        token: {
          tokenType: 0,
          tokenAddress: '0x' + '0'.repeat(40),
          tokenSubID: 0n,
        },
        value: 0n,
      },
    };

    const mockActionData: RelayAdapt7702.ActionDataStruct = {
      requireSuccess: true,
      minGasLimit: 100000n,
      calls: [],
    };

    const executionDetails = {
      executionType: RelayAdapt7702ExecutionType.ExecuteWithNonce,
      executeNonce: 2n,
    };
    const signature = await signExecutionAuthorization(
      signer,
      [mockTransaction],
      mockActionData,
      chainId,
      executionDetails,
    );

    const recovered = verifyTypedData(
      {
        name: 'RelayAdapt7702',
        version: '1',
        chainId,
        verifyingContract: signer.address,
      },
      {
        Execute: [{ name: 'payloadHash', type: 'bytes32' }],
      },
      {
        payloadHash: getExecutePayloadHash([mockTransaction], mockActionData, executionDetails),
      },
      signature,
    );

    expect(recovered).to.equal(signer.address);
  });

  it('should encode current and legacy payload hashes explicitly', () => {
    const mockActionData: RelayAdapt7702.ActionDataStruct = {
      requireSuccess: true,
      minGasLimit: 100000n,
      calls: [],
    };
    const transactions: TransactionStructV2[] = [];
    const abiCoder = AbiCoder.defaultAbiCoder();
    const executeNonce = 2n;

    const legacyHash = getExecutePayloadHash(transactions, mockActionData, {
      executionType: RelayAdapt7702ExecutionType.LegacyPreExecuteNonce,
    });
    const currentHash = getExecutePayloadHash(transactions, mockActionData, {
      executionType: RelayAdapt7702ExecutionType.ExecuteWithNonce,
      executeNonce,
    });

    expect(legacyHash).to.equal(keccak256(abiCoder.encode(
      [`${TRANSACTION_STRUCT_ABI}[]`, ACTION_DATA_STRUCT_ABI],
      [transactions, mockActionData],
    )));
    expect(currentHash).to.equal(keccak256(abiCoder.encode(
      [`${TRANSACTION_STRUCT_ABI}[]`, ACTION_DATA_STRUCT_ABI, 'uint256'],
      [transactions, mockActionData, executeNonce],
    )));
    expect(currentHash).to.not.equal(legacyHash);
  });

  it('preserves chain IDs above 2^53 in the execution signature domain', async () => {
    const signer = Wallet.createRandom();
    // 2^53 + 1 is not representable as a JS number, so Number(chainId) would truncate it.
    const largeChainId = 9007199254740993n;
    const mockActionData: RelayAdapt7702.ActionDataStruct = {
      requireSuccess: true,
      minGasLimit: 100000n,
      calls: [],
    };
    const transactions: TransactionStructV2[] = [];
    const executionDetails = {
      executionType: RelayAdapt7702ExecutionType.ExecuteWithNonce,
      executeNonce: 1n,
    };

    const signature = await signExecutionAuthorization(
      signer,
      transactions,
      mockActionData,
      largeChainId,
      executionDetails,
    );

    // Recover against the FULL bigint chain ID (as the on-chain contract sees block.chainid).
    // A truncated Number(chainId) on the signing side would not recover to the signer.
    const recovered = verifyTypedData(
      {
        name: 'RelayAdapt7702',
        version: '1',
        chainId: largeChainId,
        verifyingContract: signer.address,
      },
      { Execute: [{ name: 'payloadHash', type: 'bytes32' }] },
      { payloadHash: getExecutePayloadHash(transactions, mockActionData, executionDetails) },
      signature,
    );

    expect(recovered).to.equal(signer.address);
  });
});

// Regression guard for the off-chain <-> on-chain execution-signature digest (finding F1).
//
// A 7702 `execute` reverts unless the digest signed off-chain is byte-identical to the one the
// deployed RelayAdapt7702 contract recovers against. The tests above sign AND verify with the
// SAME off-chain code, so they would still pass if the domain, the `Execute` type string, or the
// payload ABI-encoding drifted away from the on-chain spec (both sides move together). The
// assertions below instead reconstruct the digest from first principles — the literal EIP-712
// type string and domain, independent of the production signing path — and pin the exact encoding
// and digest as golden vectors, so any drift is caught by the default `npm test` run. The
// byte-exact match to the *deployed* contract is proven additionally by the RUN_HARDHAT_TESTS
// integration test in contracts/relay-adapt/__tests__/relay-adapt-7702.test.ts.
describe('RelayAdapt7702 execution signature — on-chain digest binding (F1)', () => {
  // Deterministic signer (Hardhat account #1 key) so the digest is a stable golden vector.
  const signer = new Wallet('0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d');
  const chainId = 1n;
  const transactions: TransactionStructV2[] = [];
  const actionData: RelayAdapt7702.ActionDataStruct = {
    requireSuccess: true,
    minGasLimit: 100000n,
    calls: [],
  };
  // nonce > 0 is the production steady state — the ephemeral account is reused across spends.
  const executeNonce = 7n;
  const executionDetails = {
    executionType: RelayAdapt7702ExecutionType.ExecuteWithNonce,
    executeNonce,
  };
  const abiCoder = AbiCoder.defaultAbiCoder();

  it('pins the struct ABI encoding of the signed payload', () => {
    // These strings are the on-chain `execute` calldata layout. Freezing them makes any
    // typechain/ABI drift (which would silently change the payload hash) fail here.
    expect(TRANSACTION_STRUCT_ABI).to.equal(
      '(((uint256 x, uint256 y) a, (uint256[2] x, uint256[2] y) b, (uint256 x, uint256 y) c) proof, bytes32 merkleRoot, bytes32[] nullifiers, bytes32[] commitments, (uint16 treeNumber, uint72 minGasPrice, uint8 unshield, uint64 chainID, address adaptContract, bytes32 adaptParams, (bytes32[4] ciphertext, bytes32 blindedSenderViewingKey, bytes32 blindedReceiverViewingKey, bytes annotationData, bytes memo)[] commitmentCiphertext) boundParams, (bytes32 npk, (uint8 tokenType, address tokenAddress, uint256 tokenSubID) token, uint120 value) unshieldPreimage)',
    );
    expect(ACTION_DATA_STRUCT_ABI).to.equal(
      '(bool requireSuccess, uint256 minGasLimit, (address to, bytes data, uint256 value)[] calls) _actionData',
    );
  });

  it('binds the payload hash to abi.encode(transactions, actionData, nonce) and commits the nonce', () => {
    const nonceAware = getExecutePayloadHash(transactions, actionData, executionDetails);
    expect(nonceAware).to.equal(
      keccak256(
        abiCoder.encode(
          [`${TRANSACTION_STRUCT_ABI}[]`, ACTION_DATA_STRUCT_ABI, 'uint256'],
          [transactions, actionData, executeNonce],
        ),
      ),
    );
    // Golden vector: fixed inputs -> stable hash. Any encoding drift breaks this.
    expect(nonceAware).to.equal(
      '0x58ade22424a8dfa6f288ed073f91564e66cbf2bca00f713340729eb31b35a3c7',
    );

    // The legacy payload MUST omit the nonce (and therefore differ).
    const legacy = getExecutePayloadHash(transactions, actionData, {
      executionType: RelayAdapt7702ExecutionType.LegacyPreExecuteNonce,
    });
    expect(legacy).to.equal(
      keccak256(
        abiCoder.encode(
          [`${TRANSACTION_STRUCT_ABI}[]`, ACTION_DATA_STRUCT_ABI],
          [transactions, actionData],
        ),
      ),
    );
    expect(legacy).to.not.equal(nonceAware);
  });

  it('signs the exact EIP-712 digest the contract recovers against (domain + Execute type)', async () => {
    const payloadHash = getExecutePayloadHash(transactions, actionData, executionDetails);

    // Reconstruct the EIP-712 digest from first principles, independent of the production path.
    const executeTypeHash = keccak256(toUtf8Bytes('Execute(bytes32 payloadHash)'));
    const structHash = keccak256(
      abiCoder.encode(['bytes32', 'bytes32'], [executeTypeHash, payloadHash]),
    );
    const domain = {
      name: 'RelayAdapt7702',
      version: '1',
      chainId,
      verifyingContract: signer.address,
    };
    const domainSeparator = TypedDataEncoder.hashDomain(domain);
    const expectedDigest = keccak256(concat(['0x1901', domainSeparator, structHash]));

    // ethers' typed-data hash (what the signer signs) must equal the manual envelope: this pins
    // the domain fields and the `Execute(bytes32 payloadHash)` type string to the on-chain spec.
    const types = { Execute: [{ name: 'payloadHash', type: 'bytes32' }] };
    expect(TypedDataEncoder.hash(domain, types, { payloadHash })).to.equal(expectedDigest);

    // Golden digest vector for the fixed signer + inputs.
    expect(expectedDigest).to.equal(
      '0xcf1b811e7309f5b4bdbbd10c5097f2ebb5e90cae59e724e214f61bdfcd115410',
    );

    // The production signer must sign THAT digest — recovery to the signer proves it.
    const signature = await signExecutionAuthorization(
      signer,
      transactions,
      actionData,
      chainId,
      executionDetails,
    );
    expect(recoverAddress(expectedDigest, signature)).to.equal(signer.address);
  });
});
