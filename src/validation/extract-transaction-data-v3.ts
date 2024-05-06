import { Contract, ContractTransaction } from 'ethers';
import { Chain } from '../models/engine-types';
import { AddressData } from '../key-derivation';
import { isDefined } from '../utils/is-defined';
import { ByteLength, ByteUtils } from '../utils/bytes';
import { recursivelyDecodeResult } from '../utils/ethers';
import { ExtractedRailgunTransactionData } from '../models/transaction-types';
import { getRailgunTransactionIDHex } from '../transaction/railgun-txid';
import { TransactNote } from '../note/transact-note';
import { getSharedSymmetricKey } from '../utils/keys-utils';
import { TokenDataGetter } from '../token/token-data-getter';
import { TXIDVersion } from '../models/poi-types';
import { ABIPoseidonMerkleVerifier } from '../abi/abi';
import { PoseidonMerkleVerifier } from '../abi/typechain/PoseidonMerkleVerifier';
import EngineDebug from '../debugger/debugger';
import { V3Events } from '../contracts/railgun-smart-wallet/V3/V3-events';
import { extractERC20AmountFromTransactNote } from './extract-transaction-data-v2';
import { CommitmentCiphertextV3 } from '../models';
import { hashBoundParamsV3 } from '../transaction/bound-params';

enum TransactionName {
  Execute = 'execute',
}

const getABIForTransaction = (transactionName: TransactionName): Array<any> => {
  switch (transactionName) {
    case TransactionName.Execute:
      return ABIPoseidonMerkleVerifier;
  }
  throw new Error('Unsupported transactionName');
};

export const extractFirstNoteERC20AmountMapFromTransactionRequestV3 = (
  chain: Chain,
  transactionRequest: ContractTransaction,
  contractAddress: string,
  receivingViewingPrivateKey: Uint8Array,
  receivingRailgunAddressData: AddressData,
  tokenDataGetter: TokenDataGetter,
): Promise<Record<string, bigint>> => {
  const transactionName = TransactionName.Execute;

  return extractFirstNoteERC20AmountMapV3(
    chain,
    transactionRequest,
    transactionName,
    contractAddress,
    receivingViewingPrivateKey,
    receivingRailgunAddressData,
    tokenDataGetter,
  );
};

export const extractRailgunTransactionDataFromTransactionRequestV3 = (
  chain: Chain,
  transactionRequest: ContractTransaction,
  contractAddress: string,
  receivingViewingPrivateKey: Uint8Array,
  receivingRailgunAddressData: AddressData,
  tokenDataGetter: TokenDataGetter,
): Promise<ExtractedRailgunTransactionData> => {
  const transactionName = TransactionName.Execute;

  return extractRailgunTransactionDataV3(
    chain,
    transactionRequest,
    transactionName,
    contractAddress,
    receivingViewingPrivateKey,
    receivingRailgunAddressData,
    tokenDataGetter,
  );
};

const getRailgunTransactionRequestsV3 = (
  chain: Chain,
  transactionRequest: ContractTransaction,
  transactionName: TransactionName,
  contractAddress: string,
): {
  railgunTxs: PoseidonMerkleVerifier.TransactionStructOutput[];
  globalBoundParams: PoseidonMerkleVerifier.GlobalBoundParamsStructOutput;
} => {
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

  const railgunTxs: PoseidonMerkleVerifier.TransactionStructOutput[] =
    // eslint-disable-next-line no-underscore-dangle
    args._transactions;

  for (const railgunTx of railgunTxs) {
    if (!('length' in railgunTx.boundParams.commitmentCiphertext)) {
      // 'commitmentCiphertext' is potentially parsed as an object.
      railgunTx.boundParams.commitmentCiphertext = [];
    }
  }

  const globalBoundParams: PoseidonMerkleVerifier.GlobalBoundParamsStructOutput =
    // eslint-disable-next-line no-underscore-dangle
    args._globalBoundParams;

  return { railgunTxs, globalBoundParams };
};

const extractFirstNoteERC20AmountMapV3 = async (
  chain: Chain,
  transactionRequest: ContractTransaction,
  transactionName: TransactionName,
  contractAddress: string,
  receivingViewingPrivateKey: Uint8Array,
  receivingRailgunAddressData: AddressData,
  tokenDataGetter: TokenDataGetter,
): Promise<Record<string, bigint>> => {
  const erc20PaymentAmounts: Record<string, bigint> = {};

  const { railgunTxs } = getRailgunTransactionRequestsV3(
    chain,
    transactionRequest,
    transactionName,
    contractAddress,
  );

  await Promise.all(
    railgunTxs.map(async (railgunTx: PoseidonMerkleVerifier.TransactionStructOutput) => {
      const { commitments, boundParams } = railgunTx;

      // Extract first commitment (index 0)
      const index = 0;
      const commitmentCiphertextStructOutput = boundParams.commitmentCiphertext[index];
      const commitmentHash: string = commitments[index];
      if (!isDefined(commitmentCiphertextStructOutput)) {
        EngineDebug.log('no ciphertext found for commitment at index 0');
        return;
      }

      const commitmentCiphertext = V3Events.formatCommitmentCiphertext(
        commitmentCiphertextStructOutput,
      );

      const decryptedReceiverNote = await decryptReceiverNoteSafeV3(
        chain,
        commitmentCiphertext,
        receivingViewingPrivateKey,
        receivingRailgunAddressData,
        tokenDataGetter,
        index,
      );

      const erc20PaymentAmount = await extractERC20AmountFromTransactNote(
        decryptedReceiverNote,
        commitmentHash,
        receivingRailgunAddressData,
      );
      if (!erc20PaymentAmount) {
        return;
      }

      const { tokenAddress, amount } = erc20PaymentAmount;

      erc20PaymentAmounts[tokenAddress] ??= 0n;
      erc20PaymentAmounts[tokenAddress] += amount;
    }),
  );

  return erc20PaymentAmounts;
};

const extractRailgunTransactionDataV3 = async (
  chain: Chain,
  transactionRequest: ContractTransaction,
  transactionName: TransactionName,
  contractAddress: string,
  receivingViewingPrivateKey: Uint8Array,
  receivingRailgunAddressData: AddressData,
  tokenDataGetter: TokenDataGetter,
): Promise<ExtractedRailgunTransactionData> => {
  const { railgunTxs, globalBoundParams } = getRailgunTransactionRequestsV3(
    chain,
    transactionRequest,
    transactionName,
    contractAddress,
  );

  const extractedRailgunTransactionData: ExtractedRailgunTransactionData = await Promise.all(
    railgunTxs.map(
      async (railgunTx: PoseidonMerkleVerifier.TransactionStructOutput, railgunTxIndex: number) => {
        const { commitments, nullifiers, boundParams } = railgunTx;

        const boundParamsHash = ByteUtils.nToHex(
          hashBoundParamsV3({
            global: globalBoundParams,
            local: boundParams,
          }),
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

        const commitmentCiphertext = V3Events.formatCommitmentCiphertext(
          commitmentCiphertextStructOutput,
        );

        // Get NPK for first note, if addressed to current wallet.
        const firstCommitmentNotePublicKey = await extractNPKFromCommitmentCiphertextV3(
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
      },
    ),
  );

  return extractedRailgunTransactionData;
};

export const extractNPKFromCommitmentCiphertextV3 = async (
  chain: Chain,
  commitmentCiphertext: CommitmentCiphertextV3,
  receivingViewingPrivateKey: Uint8Array,
  receivingRailgunAddressData: AddressData,
  tokenDataGetter: TokenDataGetter,
): Promise<Optional<bigint>> => {
  const decryptedReceiverNote = await decryptReceiverNoteSafeV3(
    chain,
    commitmentCiphertext,
    receivingViewingPrivateKey,
    receivingRailgunAddressData,
    tokenDataGetter,
    0, // Unused for this function
  );
  return decryptedReceiverNote?.notePublicKey;
};

const decryptReceiverNoteSafeV3 = async (
  chain: Chain,
  commitmentCiphertext: CommitmentCiphertextV3,
  receivingViewingPrivateKey: Uint8Array,
  receivingRailgunAddressData: AddressData,
  tokenDataGetter: TokenDataGetter,
  transactCommitmentBatchIndexV3: number,
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
      TXIDVersion.V3_PoseidonMerkle,
      chain,
      receivingRailgunAddressData,
      commitmentCiphertext.ciphertext,
      sharedKey,
      '', // memoV2
      '', // annotationData - not used
      blindedReceiverViewingKey, // blindedReceiverViewingKey
      blindedSenderViewingKey, // blindedSenderViewingKey
      undefined, // senderRandom - not used
      false, // isSentNote
      false, // isLegacyDecryption
      tokenDataGetter,
      undefined, // blockNumber - not used
      transactCommitmentBatchIndexV3,
    );
    return note;
  } catch (cause) {
    EngineDebug.error(new Error('Failed to decrypt receiver note safe V3', { cause }));
    return undefined;
  }
};
