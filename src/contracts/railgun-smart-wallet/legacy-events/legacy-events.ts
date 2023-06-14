import {
  NullifiersEvent as LegacyNullifiersEvent,
  CommitmentBatchEvent as LegacyCommitmentBatchEvent,
  CommitmentPreimageStructOutput as LegacyCommitmentPreimageStructOutput,
  GeneratedCommitmentBatchEvent as LegacyGeneratedCommitmentBatchEvent,
  CommitmentCiphertextStructOutput as LegacyCommitmentCiphertextStructOutput,
} from '../../../abi/typechain/RailgunLogic_LegacyEvents';
import {
  CommitmentEvent,
  EventsCommitmentListener,
  EventsNullifierListener,
} from '../../../models/event-types';
import {
  CommitmentType,
  LegacyCommitmentCiphertext,
  LegacyEncryptedCommitment,
  LegacyGeneratedCommitment,
  Nullifier,
} from '../../../models/formatted-types';
import { getNoteHash, serializePreImage, serializeTokenData } from '../../../note/note-util';
import { ByteLength, formatToByteLength, nToHex } from '../../../utils';
import EngineDebug from '../../../debugger/debugger';

export function formatLegacyGeneratedCommitmentBatchCommitments(
  transactionHash: string,
  preImages: LegacyCommitmentPreimageStructOutput[],
  encryptedRandoms: [bigint, bigint][],
  blockNumber: number,
): LegacyGeneratedCommitment[] {
  const randomFormatted: [string, string][] = encryptedRandoms.map((encryptedRandom) => [
    nToHex(encryptedRandom[0], ByteLength.UINT_256),
    nToHex(encryptedRandom[1], ByteLength.UINT_128),
  ]);
  return preImages.map((commitmentPreImage, index) => {
    const npk = formatToByteLength(commitmentPreImage.npk.toString(), ByteLength.UINT_256);
    const tokenData = serializeTokenData(
      commitmentPreImage.token.tokenAddress,
      commitmentPreImage.token.tokenType,
      commitmentPreImage.token.tokenSubID.toString(),
    );
    const { value } = commitmentPreImage;
    const preImage = serializePreImage(npk, tokenData, value);
    const noteHash = getNoteHash(npk, tokenData, value);

    return {
      commitmentType: CommitmentType.LegacyGeneratedCommitment,
      hash: nToHex(noteHash, ByteLength.UINT_256),
      txid: transactionHash,
      timestamp: undefined,
      blockNumber,
      preImage,
      encryptedRandom: randomFormatted[index],
    };
  });
}

export function formatLegacyGeneratedCommitmentBatchEvent(
  commitmentBatchArgs: LegacyGeneratedCommitmentBatchEvent.OutputObject,
  transactionHash: string,
  blockNumber: number,
): CommitmentEvent {
  const { treeNumber, startPosition, commitments, encryptedRandom } = commitmentBatchArgs;
  if (
    treeNumber == null ||
    startPosition == null ||
    commitments == null ||
    encryptedRandom == null
  ) {
    const err = new Error('Invalid GeneratedCommitmentBatchEventArgs');
    EngineDebug.error(err);
    throw err;
  }

  const formattedCommitments: LegacyGeneratedCommitment[] =
    formatLegacyGeneratedCommitmentBatchCommitments(
      transactionHash,
      commitments,
      encryptedRandom,
      blockNumber,
    );
  return {
    txid: formatToByteLength(transactionHash, ByteLength.UINT_256),
    treeNumber: Number(treeNumber),
    startPosition: Number(startPosition),
    commitments: formattedCommitments,
    blockNumber,
  };
}

function formatLegacyCommitmentCiphertext(
  commitment: LegacyCommitmentCiphertextStructOutput,
): LegacyCommitmentCiphertext {
  const { ephemeralKeys, memo } = commitment;
  const ciphertext = commitment.ciphertext.map(
    (el) => nToHex(el, ByteLength.UINT_256), // 32 bytes each.
  );
  const ivTag = ciphertext[0];

  return {
    ciphertext: {
      iv: ivTag.substring(0, 32),
      tag: ivTag.substring(32),
      data: ciphertext.slice(1),
    },
    ephemeralKeys: ephemeralKeys.map(
      (key) => nToHex(key, ByteLength.UINT_256), // 32 bytes each.
    ),
    memo: memo.map(
      (el) => nToHex(el, ByteLength.UINT_256), // 32 bytes each.
    ),
  };
}

export function formatLegacyCommitmentBatchCommitments(
  transactionHash: string,
  hash: bigint[],
  commitments: LegacyCommitmentCiphertextStructOutput[],
  blockNumber: number,
): LegacyEncryptedCommitment[] {
  return commitments.map((commitment, index) => {
    return {
      commitmentType: CommitmentType.LegacyEncryptedCommitment,
      hash: nToHex(hash[index], ByteLength.UINT_256),
      txid: transactionHash,
      timestamp: undefined,
      blockNumber,
      ciphertext: formatLegacyCommitmentCiphertext(commitment),
    };
  });
}

export function formatLegacyCommitmentBatchEvent(
  commitmentBatchArgs: LegacyCommitmentBatchEvent.OutputObject,
  transactionHash: string,
  blockNumber: number,
): CommitmentEvent {
  const { treeNumber, startPosition, hash, ciphertext } = commitmentBatchArgs;
  if (treeNumber == null || startPosition == null || hash == null || ciphertext == null) {
    const err = new Error('Invalid CommitmentBatchEventArgs');
    EngineDebug.error(err);
    throw err;
  }

  const formattedCommitments: LegacyEncryptedCommitment[] = formatLegacyCommitmentBatchCommitments(
    transactionHash,
    hash,
    ciphertext,
    blockNumber,
  );
  return {
    txid: formatToByteLength(transactionHash, ByteLength.UINT_256),
    treeNumber: Number(treeNumber),
    startPosition: Number(startPosition),
    commitments: formattedCommitments,
    blockNumber,
  };
}

export async function processGeneratedCommitmentEvents(
  eventsListener: EventsCommitmentListener,
  logs: LegacyGeneratedCommitmentBatchEvent.Log[],
): Promise<void> {
  const filtered = logs.filter((log) => log.args);
  await Promise.all(
    filtered.map(async (log) => {
      const { args, transactionHash, blockNumber } = log;
      return eventsListener(
        formatLegacyGeneratedCommitmentBatchEvent(args, transactionHash, blockNumber),
      );
    }),
  );
}

export async function processCommitmentBatchEvents(
  eventsListener: EventsCommitmentListener,
  logs: LegacyCommitmentBatchEvent.Log[],
): Promise<void> {
  const filtered = logs.filter((log) => log.args);
  await Promise.all(
    filtered.map(async (log) => {
      const { args, transactionHash, blockNumber } = log;
      return eventsListener(formatLegacyCommitmentBatchEvent(args, transactionHash, blockNumber));
    }),
  );
}

export function formatLegacyNullifierEvents(
  nullifierEventArgs: LegacyNullifiersEvent.OutputObject,
  transactionHash: string,
  blockNumber: number,
): Nullifier[] {
  const nullifiers: Nullifier[] = [];

  nullifierEventArgs.nullifier.forEach((nullifier: bigint) => {
    nullifiers.push({
      txid: formatToByteLength(transactionHash, ByteLength.UINT_256),
      nullifier: nToHex(nullifier, ByteLength.UINT_256),
      treeNumber: Number(nullifierEventArgs.treeNumber),
      blockNumber,
    });
  });

  return nullifiers;
}

export async function processLegacyGeneratedCommitmentEvents(
  eventsListener: EventsCommitmentListener,
  logs: LegacyGeneratedCommitmentBatchEvent.Log[],
): Promise<void> {
  const filtered = logs.filter((log) => log.args);
  await Promise.all(
    filtered.map(async (log) => {
      const { args, transactionHash, blockNumber } = log;
      return eventsListener(
        formatLegacyGeneratedCommitmentBatchEvent(args, transactionHash, blockNumber),
      );
    }),
  );
}

export async function processLegacyCommitmentBatchEvents(
  eventsListener: EventsCommitmentListener,
  logs: LegacyCommitmentBatchEvent.Log[],
): Promise<void> {
  const filtered = logs.filter((log) => log.args);
  await Promise.all(
    filtered.map(async (log) => {
      const { args, transactionHash, blockNumber } = log;
      return eventsListener(formatLegacyCommitmentBatchEvent(args, transactionHash, blockNumber));
    }),
  );
}

export async function processLegacyNullifierEvents(
  eventsNullifierListener: EventsNullifierListener,
  logs: LegacyNullifiersEvent.Log[],
): Promise<void> {
  const nullifiers: Nullifier[] = [];

  const filtered = logs.filter((log) => log.args);
  filtered.forEach((event) => {
    const { args, transactionHash, blockNumber } = event;
    nullifiers.push(...formatLegacyNullifierEvents(args, transactionHash, blockNumber));
  });

  await eventsNullifierListener(nullifiers);
}
