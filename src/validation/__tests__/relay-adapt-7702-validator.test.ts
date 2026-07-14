import { expect } from 'chai';
import { ParamType, Wallet } from 'ethers';
import {
  TRANSACTION_STRUCT_ABI,
  ACTION_DATA_STRUCT_ABI,
  RelayAdapt7702ExecutionType,
  getExecutePayloadHash,
} from '../../transaction/relay-adapt-7702-signature';
import { TransactionStructV2 } from '../../models/transaction-types';
import { RelayAdapt7702 } from '../../abi/typechain/RelayAdapt7702';
import { RelayAdapt7702Validator } from '../relay-adapt-7702-validator';

describe('RelayAdapt7702Validator', () => {
  it('should have valid ABI strings derived from TypeChain', () => {
    expect(TRANSACTION_STRUCT_ABI).to.be.a('string');

    expect(ACTION_DATA_STRUCT_ABI).to.be.a('string');

    // Verify they are valid ParamTypes
    const transactionType = ParamType.from(TRANSACTION_STRUCT_ABI);
    expect(transactionType.baseType).to.equal('tuple');

    const actionDataType = ParamType.from(ACTION_DATA_STRUCT_ABI);
    expect(actionDataType.baseType).to.equal('tuple');
  });

  describe('validateAuthorization', () => {
    const contractAddress = '0x5bf5b11053e734690269C6B9D438F8C9d48F528A';

    it('recovers the signer and asserts it matches the expected signer', async () => {
      const wallet = Wallet.createRandom();
      const authorization = await wallet.authorize({
        address: contractAddress,
        nonce: 0n,
        chainId: 1n,
      });
      const recovered = RelayAdapt7702Validator.validateAuthorization(
        authorization,
        contractAddress,
        1n,
        wallet.address,
      );
      expect(recovered.toLowerCase()).to.equal(wallet.address.toLowerCase());
    });

    it('throws when the recovered signer does not match the expected signer', async () => {
      const wallet = Wallet.createRandom();
      const authorization = await wallet.authorize({
        address: contractAddress,
        nonce: 0n,
        chainId: 1n,
      });
      expect(() =>
        RelayAdapt7702Validator.validateAuthorization(
          authorization,
          contractAddress,
          1n,
          `0x${'9'.repeat(40)}`,
        ),
      ).to.throw('Authorization signer mismatch');
    });

    it('throws on chain ID mismatch', async () => {
      const wallet = Wallet.createRandom();
      const authorization = await wallet.authorize({
        address: contractAddress,
        nonce: 0n,
        chainId: 1n,
      });
      expect(() =>
        RelayAdapt7702Validator.validateAuthorization(authorization, contractAddress, 999n),
      ).to.throw('Authorization chain ID mismatch');
    });

    it('throws on contract address mismatch', async () => {
      const wallet = Wallet.createRandom();
      const authorization = await wallet.authorize({
        address: contractAddress,
        nonce: 0n,
        chainId: 1n,
      });
      expect(() =>
        RelayAdapt7702Validator.validateAuthorization(authorization, `0x${'2'.repeat(40)}`, 1n),
      ).to.throw('Authorization contract address mismatch');
    });
  });

  describe('validateExecution', () => {
    const executionDetails = {
      executionType: RelayAdapt7702ExecutionType.ExecuteWithNonce,
      executeNonce: 5n,
    };
    const actionData: RelayAdapt7702.ActionDataStruct = {
      requireSuccess: true,
      minGasLimit: 100000n,
      calls: [],
    };
    const transactions: TransactionStructV2[] = [];

    const signExecution = (
      wallet: ReturnType<typeof Wallet.createRandom>,
      chainId: bigint,
    ): Promise<string> =>
      wallet.signTypedData(
        { name: 'RelayAdapt7702', version: '1', chainId, verifyingContract: wallet.address },
        { Execute: [{ name: 'payloadHash', type: 'bytes32' }] },
        { payloadHash: getExecutePayloadHash(transactions, actionData, executionDetails) },
      );

    it('accepts a signature that recovers to the expected signer', async () => {
      const wallet = Wallet.createRandom();
      const signature = await signExecution(wallet, 1n);
      expect(() =>
        RelayAdapt7702Validator.validateExecution(
          transactions,
          actionData,
          signature,
          1n,
          wallet.address,
          executionDetails,
        ),
      ).to.not.throw();
    });

    it('throws when the signature recovers to a different signer', async () => {
      const wallet = Wallet.createRandom();
      const signature = await signExecution(wallet, 1n);
      const otherSigner = Wallet.createRandom().address;
      expect(() =>
        RelayAdapt7702Validator.validateExecution(
          transactions,
          actionData,
          signature,
          1n,
          otherSigner,
          executionDetails,
        ),
      ).to.throw('Execution signature signer mismatch');
    });

    it('throws when the signed action data is tampered', async () => {
      const wallet = Wallet.createRandom();
      const signature = await signExecution(wallet, 1n);
      const tamperedActionData: RelayAdapt7702.ActionDataStruct = {
        ...actionData,
        requireSuccess: false,
      };
      expect(() =>
        RelayAdapt7702Validator.validateExecution(
          transactions,
          tamperedActionData,
          signature,
          1n,
          wallet.address,
          executionDetails,
        ),
      ).to.throw('Execution signature signer mismatch');
    });
  });
});
