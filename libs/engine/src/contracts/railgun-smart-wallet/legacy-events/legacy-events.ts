import { BigNumber } from 'ethers';
import {
  LegacyNullifiersEvent,
  LegacyCommitmentBatchEvent,
  LegacyCommitmentPreimageStructOutput,
  LegacyGeneratedCommitmentBatchEvent,
  LegacyGeneratedCommitmentBatchEventObject,
  LegacyCommitmentBatchEventObject,
  LegacyCommitmentCiphertextStructOutput,
  LegacyNullifiersEventObject,
} from './RailgunLogic_LegacyEvents';
import {
  CommitmentEvent,
  EventsListener,
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
  encryptedRandoms: [BigNumber, BigNumber][],
  blockNumber: number,
): LegacyGeneratedCommitment[] {
  const randomFormatted = encryptedRandoms.map(
    (encryptedRandom) =>
      [
        formatToByteLength(encryptedRandom[0].toHexString(), ByteLength.UINT_256),
        formatToByteLength(encryptedRandom[1].toHexString(), ByteLength.UINT_128),
      ] as [string, string],
  );
  return preImages.map((commitmentPreImage, index) => {
    const npk = formatToByteLength(commitmentPreImage.npk.toHexString(), ByteLength.UINT_256);
    const tokenData = serializeTokenData(
      commitmentPreImage.token.tokenAddress,
      commitmentPreImage.token.tokenType,
      commitmentPreImage.token.tokenSubID.toHexString(),
    );
    const value = commitmentPreImage.value.toBigInt();
    const preImage = serializePreImage(npk, tokenData, value);
    const noteHash = getNoteHash(npk, tokenData, value);

    return {
      commitmentType: CommitmentType.LegacyGeneratedCommitment,
      hash: nToHex(noteHash, ByteLength.UINT_256),
      txid: transactionHash,
      blockNumber,
      preImage,
      encryptedRandom: randomFormatted[index],
    };
  });
}

export function formatLegacyGeneratedCommitmentBatchEvent(
  commitmentBatchArgs: LegacyGeneratedCommitmentBatchEventObject,
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
    treeNumber: treeNumber.toNumber(),
    startPosition: startPosition.toNumber(),
    commitments: formattedCommitments,
    blockNumber,
  };
}

function formatLegacyCommitmentCiphertext(
  commitment: LegacyCommitmentCiphertextStructOutput,
): LegacyCommitmentCiphertext {
  const { ephemeralKeys, memo } = commitment;
  const ciphertext = commitment.ciphertext.map(
    (el) => formatToByteLength(el.toHexString(), ByteLength.UINT_256), // 32 bytes each.
  );
  const ivTag = ciphertext[0];

  return {
    ciphertext: {
      iv: ivTag.substring(0, 32),
      tag: ivTag.substring(32),
      data: ciphertext.slice(1),
    },
    ephemeralKeys: ephemeralKeys.map(
      (key) => formatToByteLength(key.toHexString(), ByteLength.UINT_256), // 32 bytes each.
    ),
    memo: memo.map(
      (el) => formatToByteLength(el.toHexString(), ByteLength.UINT_256), // 32 bytes each.
    ),
  };
}

export function formatLegacyCommitmentBatchCommitments(
  transactionHash: string,
  hash: BigNumber[],
  commitments: LegacyCommitmentCiphertextStructOutput[],
  blockNumber: number,
): LegacyEncryptedCommitment[] {
  return commitments.map((commitment, index) => {
    return {
      commitmentType: CommitmentType.LegacyEncryptedCommitment,
      hash: formatToByteLength(hash[index].toHexString(), ByteLength.UINT_256),
      txid: transactionHash,
      blockNumber,
      ciphertext: formatLegacyCommitmentCiphertext(commitment),
    };
  });
}

export function formatLegacyCommitmentBatchEvent(
  commitmentBatchArgs: LegacyCommitmentBatchEventObject,
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
    treeNumber: treeNumber.toNumber(),
    startPosition: startPosition.toNumber(),
    commitments: formattedCommitments,
    blockNumber,
  };
}

export async function processGeneratedCommitmentEvents(
  eventsListener: EventsListener,
  events: LegacyGeneratedCommitmentBatchEvent[],
): Promise<void> {
  const filtered = events.filter((event) => event.args);
  await Promise.all(
    filtered.map(async (event) => {
      const { args, transactionHash, blockNumber } = event;
      return eventsListener(
        formatLegacyGeneratedCommitmentBatchEvent(args, transactionHash, blockNumber),
      );
    }),
  );
}

export async function processCommitmentBatchEvents(
  eventsListener: EventsListener,
  events: LegacyCommitmentBatchEvent[],
): Promise<void> {
  const filtered = events.filter((event) => event.args);
  await Promise.all(
    filtered.map(async (event) => {
      const { args, transactionHash, blockNumber } = event;
      return eventsListener(formatLegacyCommitmentBatchEvent(args, transactionHash, blockNumber));
    }),
  );
}

export function formatLegacyNullifierEvents(
  nullifierEventArgs: LegacyNullifiersEventObject,
  transactionHash: string,
  blockNumber: number,
): Nullifier[] {
  const nullifiers: Nullifier[] = [];

  nullifierEventArgs.nullifier.forEach((nullifier: BigNumber) => {
    nullifiers.push({
      txid: formatToByteLength(transactionHash, ByteLength.UINT_256),
      nullifier: formatToByteLength(nullifier.toHexString(), ByteLength.UINT_256),
      treeNumber: nullifierEventArgs.treeNumber.toNumber(),
      blockNumber,
    });
  });

  return nullifiers;
}

export async function processLegacyGeneratedCommitmentEvents(
  eventsListener: EventsListener,
  events: LegacyGeneratedCommitmentBatchEvent[],
): Promise<void> {
  const filtered = events.filter((event) => event.args);
  await Promise.all(
    filtered.map(async (event) => {
      const { args, transactionHash, blockNumber } = event;
      return eventsListener(
        formatLegacyGeneratedCommitmentBatchEvent(args, transactionHash, blockNumber),
      );
    }),
  );
}

export async function processLegacyCommitmentBatchEvents(
  eventsListener: EventsListener,
  events: LegacyCommitmentBatchEvent[],
): Promise<void> {
  const filtered = events.filter((event) => event.args);
  await Promise.all(
    filtered.map(async (event) => {
      const { args, transactionHash, blockNumber } = event;
      return eventsListener(formatLegacyCommitmentBatchEvent(args, transactionHash, blockNumber));
    }),
  );
}

export async function processLegacyNullifierEvents(
  eventsNullifierListener: EventsNullifierListener,
  events: LegacyNullifiersEvent[],
): Promise<void> {
  const nullifiers: Nullifier[] = [];

  const filtered = events.filter((event) => event.args);
  filtered.forEach((event) => {
    const { args, transactionHash, blockNumber } = event;
    nullifiers.push(...formatLegacyNullifierEvents(args, transactionHash, blockNumber));
  });

  await eventsNullifierListener(nullifiers);
}
