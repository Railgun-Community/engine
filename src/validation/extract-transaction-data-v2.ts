import { Contract, ContractTransaction } from 'ethers';
import { ABIRailgunSmartWallet, ABIRelayAdapt } from '../abi/abi';
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

enum TransactionName {
  RailgunSmartWallet = 'transact',
  RelayAdapt = 'relay',
}

const getABIForTransaction = (transactionName: TransactionName): Array<any> => {
  switch (transactionName) {
    case TransactionName.RailgunSmartWallet:
      return ABIRailgunSmartWallet;
    case TransactionName.RelayAdapt:
      return ABIRelayAdapt;
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
): Promise<Record<string, bigint>> => {
  const transactionName = useRelayAdapt
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
): Promise<ExtractedRailgunTransactionData> => {
  const transactionName = useRelayAdapt
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
  );
};

const getRailgunTransactionRequestsV2 = (
  chain: Chain,
  transactionRequest: ContractTransaction,
  transactionName: TransactionName,
  contractAddress: string,
): TransactionStructOutput[] => {
  const abi = getABIForTransaction(transactionName);

  if (
    !transactionRequest.to ||
    transactionRequest.to.toLowerCase() !== contractAddress.toLowerCase()
  ) {
    throw new Error(
      `Invalid contract address: got ${transactionRequest.to}, expected ${contractAddress} for network ${chain.type}:${chain.id}`,
    );
  }

  const contract = new Contract(contractAddress, abi);

  const parsedTransaction = contract.interface.parseTransaction({
    data: transactionRequest.data ?? '',
    value: transactionRequest.value,
  });
  if (!parsedTransaction) {
    throw new Error('No transaction parsable from request');
  }
  if (parsedTransaction.name !== transactionName) {
    throw new Error(
      `Contract method ${parsedTransaction.name} invalid: expected ${transactionName}`,
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const args = recursivelyDecodeResult(parsedTransaction.args);

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
): Promise<Record<string, bigint>> => {
  const erc20PaymentAmounts: Record<string, bigint> = {};

  const railgunTxs: TransactionStructOutput[] = getRailgunTransactionRequestsV2(
    chain,
    transactionRequest,
    transactionName,
    contractAddress,
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
): Promise<ExtractedRailgunTransactionData> => {
  const railgunTxs: TransactionStructOutput[] = getRailgunTransactionRequestsV2(
    chain,
    transactionRequest,
    transactionName,
    contractAddress,
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
