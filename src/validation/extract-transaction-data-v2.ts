import { Contract, ContractTransaction } from 'ethers';
import {
  ABIRailgunSmartWallet,
  ABIRelayAdapt,
  ABIRelayAdapt7702,
  ABIRelayAdapt7702_Legacy_PreExecuteNonce,
} from '../abi/abi';
import { Chain } from '../models/engine-types';
import { TransactionStructOutput } from '../abi/typechain/RailgunSmartWallet';
import { AddressData } from '../key-derivation';
import { isDefined } from '../utils/is-defined';
import EngineDebug from '../debugger/debugger';
import { V2Events } from '../contracts/railgun-smart-wallet/V2/V2-events';
import { ByteLength, ByteUtils } from '../utils/bytes';
import { CommitmentCiphertextV2, TokenType } from '../models/formatted-types';
import { recursivelyDecodeResult } from '../utils/ethers';
import { ExtractedRailgunTransactionData } from '../models/transaction-types';
import { hashBoundParamsV2 } from '../transaction/bound-params';
import { getRailgunTransactionIDHex } from '../transaction/railgun-txid';
import { TransactNote } from '../note/transact-note';
import { getSharedSymmetricKey } from '../utils/keys-utils';
import { TokenDataGetter } from '../token/token-data-getter';
import { TXIDVersion } from '../models/poi-types';
import { RelayAdapt7702ExecutionType } from '../transaction/relay-adapt-7702-signature';
import { RelayAdapt7702Validator } from './relay-adapt-7702-validator';

enum TransactionName {
  RailgunSmartWallet = 'transact',
  RelayAdapt = 'relay',
  RelayAdapt7702 = 'execute'
}

const getABIsForTransaction = (
  transactionName: TransactionName,
  relayAdapt7702ExecutionType?: RelayAdapt7702ExecutionType,
): Array<Array<any>> => {
  switch (transactionName) {
    case TransactionName.RailgunSmartWallet:
      return [ABIRailgunSmartWallet];
    case TransactionName.RelayAdapt:
      return [ABIRelayAdapt];
    case TransactionName.RelayAdapt7702:
      if (relayAdapt7702ExecutionType === RelayAdapt7702ExecutionType.LegacyPreExecuteNonce) {
        return [ABIRelayAdapt7702_Legacy_PreExecuteNonce];
      }
      if (relayAdapt7702ExecutionType === RelayAdapt7702ExecutionType.ExecuteWithNonce) {
        return [ABIRelayAdapt7702];
      }
      return [ABIRelayAdapt7702, ABIRelayAdapt7702_Legacy_PreExecuteNonce];
  }
  throw new Error('Unsupported transactionName');
};

export const extractFirstNoteERC20AmountMapFromTransactionRequestV2 = (
  chain: Chain,
  transactionRequest: ContractTransaction,
  useRelayAdapt: boolean,
  contractAddress: string,
  receivingViewingPrivateKey: Uint8Array,
  receivingRailgunAddressData: AddressData,
  tokenDataGetter: TokenDataGetter,
  useRelayAdapt7702: boolean = false,
  relayAdapt7702ExecutionType?: RelayAdapt7702ExecutionType,
): Promise<Record<string, bigint>> => {
  const transactionName = useRelayAdapt7702
    ? TransactionName.RelayAdapt7702
    : useRelayAdapt
    ? TransactionName.RelayAdapt
    : TransactionName.RailgunSmartWallet;

  return extractFirstNoteERC20AmountMapV2(
    chain,
    transactionRequest,
    transactionName,
    contractAddress,
    receivingViewingPrivateKey,
    receivingRailgunAddressData,
    tokenDataGetter,
    relayAdapt7702ExecutionType,
  );
};

export const extractRailgunTransactionDataFromTransactionRequestV2 = (
  chain: Chain,
  transactionRequest: ContractTransaction,
  useRelayAdapt: boolean,
  contractAddress: string,
  receivingViewingPrivateKey: Uint8Array,
  receivingRailgunAddressData: AddressData,
  tokenDataGetter: TokenDataGetter,
  useRelayAdapt7702: boolean = false,
  relayAdapt7702ExecutionType?: RelayAdapt7702ExecutionType,
): Promise<ExtractedRailgunTransactionData> => {
  const transactionName = useRelayAdapt7702
    ? TransactionName.RelayAdapt7702
    : useRelayAdapt
    ? TransactionName.RelayAdapt
    : TransactionName.RailgunSmartWallet;

  return extractRailgunTransactionDataV2(
    chain,
    transactionRequest,
    transactionName,
    contractAddress,
    receivingViewingPrivateKey,
    receivingRailgunAddressData,
    tokenDataGetter,
    relayAdapt7702ExecutionType,
  );
};

const parseTransactionWithABIs = (
  contractAddress: string,
  abis: Array<Array<any>>,
  transactionRequest: ContractTransaction,
) => {
  let lastError: Optional<Error>;

  for (const abi of abis) {
    try {
      const contract = new Contract(contractAddress, abi);
      const parsedTransaction = contract.interface.parseTransaction({
        data: transactionRequest.data ?? '',
        value: transactionRequest.value,
      });
      if (parsedTransaction) {
        return parsedTransaction;
      }
    } catch (cause) {
      if (cause instanceof Error) {
        lastError = cause;
      }
    }
  }

  if (lastError) {
    throw lastError;
  }
  throw new Error('No transaction parsable from request');
};

/**
 * Advisory check that the decoded RelayAdapt7702 execute calldata carries an execution
 * signature that recovers to the executing (ephemeral) account. For the 7702 path the
 * extractor's contractAddress is the ephemeral account (it is asserted to equal the tx
 * `to`), which is the EIP-712 verifyingContract, so it is the expected signer.
 *
 * This is intentionally NOT fail-closed: decoded calldata may not re-encode byte-identically
 * (e.g. commitmentCiphertext shape), so a mismatch is a diagnostic signal, not a gate.
 * Promote to fail-closed only after verifying re-encode fidelity end-to-end against the
 * deployed contract.
 */
export const validateRelayAdapt7702ExecutionSignatureAdvisory = (
  chain: Chain,
  expectedSigner: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  args: any,
): void => {
  try {
    const signature: string = args['_signature'];
    if (!isDefined(signature) || signature.length <= 2) {
      // No real signature present (e.g. gas estimate); nothing to validate.
      return;
    }
    const hasNonce = isDefined(args['_nonce']);
    RelayAdapt7702Validator.validateExecution(
      args['_transactions'],
      args['_actionData'],
      signature,
      BigInt(chain.id),
      expectedSigner,
      {
        executionType: hasNonce
          ? RelayAdapt7702ExecutionType.ExecuteWithNonce
          : RelayAdapt7702ExecutionType.LegacyPreExecuteNonce,
        executeNonce: hasNonce ? BigInt(args['_nonce']) : undefined,
      },
    );
  } catch (cause) {
    EngineDebug.error(
      new Error(
        `Advisory: RelayAdapt7702 execution signature did not validate for ${chain.type}:${chain.id}`,
        { cause: cause instanceof Error ? cause : undefined },
      ),
      true,
    );
  }
};

const getRailgunTransactionRequestsV2 = (
  chain: Chain,
  transactionRequest: ContractTransaction,
  transactionName: TransactionName,
  contractAddress: string,
  relayAdapt7702ExecutionType?: RelayAdapt7702ExecutionType,
  runExecutionSignatureCheck = false,
): TransactionStructOutput[] => {
  const abis = getABIsForTransaction(transactionName, relayAdapt7702ExecutionType);

  if (
    !transactionRequest.to ||
    transactionRequest.to.toLowerCase() !== contractAddress.toLowerCase()
  ) {
    throw new Error(
      `Invalid contract address: got ${transactionRequest.to}, expected ${contractAddress} for network ${chain.type}:${chain.id}`,
    );
  }

  const parsedTransaction = parseTransactionWithABIs(
    contractAddress,
    abis,
    transactionRequest,
  );
  if (parsedTransaction.name !== transactionName) {
    throw new Error(
      `Contract method ${parsedTransaction.name} invalid: expected ${transactionName}`,
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const args = recursivelyDecodeResult(parsedTransaction.args);

  if (transactionName === TransactionName.RelayAdapt7702 && runExecutionSignatureCheck) {
    // Advisory only: surface (do not reject on) a bad 7702 execution signature.
    // Run once (txid-extraction pass) to avoid double-logging on the fee pass.
    validateRelayAdapt7702ExecutionSignatureAdvisory(chain, contractAddress, args);
  }

  // eslint-disable-next-line no-underscore-dangle
  const railgunTxs: TransactionStructOutput[] = args._transactions;

  for (const railgunTx of railgunTxs) {
    if (!('length' in railgunTx.boundParams.commitmentCiphertext)) {
      // 'commitmentCiphertext' is potentially parsed as an object.
      railgunTx.boundParams.commitmentCiphertext = [];
    }
  }

  return railgunTxs;
};

const extractFirstNoteERC20AmountMapV2 = async (
  chain: Chain,
  transactionRequest: ContractTransaction,
  transactionName: TransactionName,
  contractAddress: string,
  receivingViewingPrivateKey: Uint8Array,
  receivingRailgunAddressData: AddressData,
  tokenDataGetter: TokenDataGetter,
  relayAdapt7702ExecutionType?: RelayAdapt7702ExecutionType,
): Promise<Record<string, bigint>> => {
  const erc20PaymentAmounts: Record<string, bigint> = {};

  const railgunTxs: TransactionStructOutput[] = getRailgunTransactionRequestsV2(
    chain,
    transactionRequest,
    transactionName,
    contractAddress,
    relayAdapt7702ExecutionType,
  );

  await Promise.all(
    railgunTxs.map(async (railgunTx: TransactionStructOutput) => {
      const { commitments, boundParams } = railgunTx;

      // Extract first commitment (index 0)
      const index = 0;
      const commitmentCiphertextStructOutput = boundParams.commitmentCiphertext[index];
      const commitmentHash: string = commitments[index];
      if (!isDefined(commitmentCiphertextStructOutput)) {
        EngineDebug.log('no ciphertext found for commitment at index 0');
        return;
      }

      const commitmentCiphertext = V2Events.formatCommitmentCiphertext(
        commitmentCiphertextStructOutput,
      );

      const decryptedReceiverNote = await decryptReceiverNoteSafeV2(
        chain,
        commitmentCiphertext,
        receivingViewingPrivateKey,
        receivingRailgunAddressData,
        tokenDataGetter,
      );

      const erc20PaymentAmount = await extractERC20AmountFromTransactNote(
        decryptedReceiverNote,
        commitmentHash,
        receivingRailgunAddressData,
      );
      if (!isDefined(erc20PaymentAmount)) {
        return;
      }

      const { tokenAddress, amount } = erc20PaymentAmount;

      erc20PaymentAmounts[tokenAddress] ??= 0n;
      erc20PaymentAmounts[tokenAddress] += amount;
    }),
  );

  return erc20PaymentAmounts;
};

const extractRailgunTransactionDataV2 = async (
  chain: Chain,
  transactionRequest: ContractTransaction,
  transactionName: TransactionName,
  contractAddress: string,
  receivingViewingPrivateKey: Uint8Array,
  receivingRailgunAddressData: AddressData,
  tokenDataGetter: TokenDataGetter,
  relayAdapt7702ExecutionType?: RelayAdapt7702ExecutionType,
): Promise<ExtractedRailgunTransactionData> => {
  const railgunTxs: TransactionStructOutput[] = getRailgunTransactionRequestsV2(
    chain,
    transactionRequest,
    transactionName,
    contractAddress,
    relayAdapt7702ExecutionType,
    true, // run the advisory execution-signature check on the txid-extraction pass only
  );

  const extractedRailgunTransactionData: ExtractedRailgunTransactionData = await Promise.all(
    railgunTxs.map(async (railgunTx: TransactionStructOutput, railgunTxIndex: number) => {
      const { commitments, nullifiers, boundParams } = railgunTx;

      const boundParamsHash = ByteUtils.nToHex(
        hashBoundParamsV2(boundParams),
        ByteLength.UINT_256,
        true,
      );
      const railgunTxid = getRailgunTransactionIDHex({
        nullifiers,
        commitments,
        boundParamsHash,
      });

      if (railgunTxIndex > 0) {
        return {
          railgunTxid,
          utxoTreeIn: boundParams.treeNumber,
          firstCommitmentNotePublicKey: undefined,
          firstCommitment: commitments[0],
        };
      }

      // Extract first commitment (index 0)
      const index = 0;
      const commitmentCiphertextStructOutput = boundParams.commitmentCiphertext[index];

      if (!isDefined(commitmentCiphertextStructOutput)) {
        throw new Error('No ciphertext found for commitment at index 0');
      }

      const commitmentCiphertext = V2Events.formatCommitmentCiphertext(
        commitmentCiphertextStructOutput,
      );

      // Get NPK for first note, if addressed to current wallet.
      const firstCommitmentNotePublicKey = await extractNPKFromCommitmentCiphertextV2(
        chain,
        commitmentCiphertext,
        receivingViewingPrivateKey,
        receivingRailgunAddressData,
        tokenDataGetter,
      );

      return {
        railgunTxid,
        utxoTreeIn: boundParams.treeNumber,
        firstCommitmentNotePublicKey,
        firstCommitment: commitments[0],
      };
    }),
  );

  return extractedRailgunTransactionData;
};

const decryptReceiverNoteSafeV2 = async (
  chain: Chain,
  commitmentCiphertext: CommitmentCiphertextV2,
  receivingViewingPrivateKey: Uint8Array,
  receivingRailgunAddressData: AddressData,
  tokenDataGetter: TokenDataGetter,
): Promise<Optional<TransactNote>> => {
  try {
    const blindedSenderViewingKey = ByteUtils.hexStringToBytes(
      commitmentCiphertext.blindedSenderViewingKey,
    );
    const blindedReceiverViewingKey = ByteUtils.hexStringToBytes(
      commitmentCiphertext.blindedReceiverViewingKey,
    );
    const sharedKey = await getSharedSymmetricKey(
      receivingViewingPrivateKey,
      blindedSenderViewingKey,
    );
    if (!sharedKey) {
      EngineDebug.log('invalid sharedKey');
      return undefined;
    }

    const note = await TransactNote.decrypt(
      TXIDVersion.V2_PoseidonMerkle,
      chain,
      receivingRailgunAddressData,
      commitmentCiphertext.ciphertext,
      sharedKey,
      commitmentCiphertext.memo,
      commitmentCiphertext.annotationData,
      blindedReceiverViewingKey, // blindedReceiverViewingKey
      blindedSenderViewingKey, // blindedSenderViewingKey
      undefined, // senderRandom - not used
      false, // isSentNote
      false, // isLegacyDecryption
      tokenDataGetter,
      undefined, // blockNumber - not used
      undefined, // transactCommitmentBatchIndexV3 - not used
    );
    return note;
  } catch (cause) {
    const ignoreInTests = true;
    EngineDebug.error(
      new Error('Failed to decrypt receiver note safe V2', { cause }),
      ignoreInTests,
    );
    return undefined;
  }
};

export const extractNPKFromCommitmentCiphertextV2 = async (
  chain: Chain,
  commitmentCiphertext: CommitmentCiphertextV2,
  receivingViewingPrivateKey: Uint8Array,
  receivingRailgunAddressData: AddressData,
  tokenDataGetter: TokenDataGetter,
): Promise<Optional<bigint>> => {
  const decryptedReceiverNote = await decryptReceiverNoteSafeV2(
    chain,
    commitmentCiphertext,
    receivingViewingPrivateKey,
    receivingRailgunAddressData,
    tokenDataGetter,
  );
  return decryptedReceiverNote?.notePublicKey;
};

export const extractERC20AmountFromTransactNote = async (
  decryptedReceiverNote: Optional<TransactNote>,
  commitmentHash: string,
  receivingRailgunAddressData: AddressData,
): Promise<Optional<{ tokenAddress: string; amount: bigint }>> => {
  if (!decryptedReceiverNote) {
    // Addressed to us, but different note than fee.
    EngineDebug.log('invalid decryptedReceiverNote');
    return undefined;
  }

  if (
    decryptedReceiverNote.receiverAddressData.masterPublicKey !==
    receivingRailgunAddressData.masterPublicKey
  ) {
    EngineDebug.log('invalid masterPublicKey');
    return undefined;
  }

  const noteHash = ByteUtils.nToHex(decryptedReceiverNote.hash, ByteLength.UINT_256);
  const commitHash = ByteUtils.formatToByteLength(commitmentHash, ByteLength.UINT_256);
  if (noteHash !== commitHash) {
    EngineDebug.log('invalid commitHash');
    return undefined;
  }

  const { tokenData } = decryptedReceiverNote;
  if (tokenData.tokenType !== TokenType.ERC20) {
    EngineDebug.log('not an erc20');
    return undefined;
  }

  const tokenAddress = ByteUtils.formatToByteLength(
    tokenData.tokenAddress,
    ByteLength.Address,
    true,
  ).toLowerCase();

  const amount = decryptedReceiverNote.value;
  return {
    tokenAddress,
    amount,
  };
};
