import type { BigNumber } from 'ethers';
import { EncryptedCommitment, GeneratedCommitment, Nullifier } from '../../models/formatted-types';
import { ByteLength, formatToByteLength, nToHex } from '../../utils/bytes';
import { ERC20WithdrawNote } from '../../note/erc20-withdraw';
import EngineDebug from '../../debugger';
import {
  CommitmentBatchEvent,
  GeneratedCommitmentBatchEvent,
  NullifiersEvent,
} from '../../typechain-types/contracts/logic/RailgunLogic';
import {
  CommitmentPreimageArgs,
  EncryptedDataArgs,
  GeneratedCommitmentBatchEventArgs,
  CommitmentEvent,
  CommitmentCiphertextArgs,
  CommitmentBatchEventArgs,
  EventsListener,
  NullifierEventArgs,
  EventsNullifierListener,
} from '../../models/event-types';

/**
 * Parse event data for database
 */
export function formatGeneratedCommitmentBatchCommitments(
  transactionHash: string,
  preImages: CommitmentPreimageArgs[],
  encryptedRandoms: EncryptedDataArgs[],
  blockNumber: number,
): GeneratedCommitment[] {
  const randomFormatted = encryptedRandoms.map(
    (encryptedRandom) =>
      [
        formatToByteLength(encryptedRandom[0].toHexString(), ByteLength.UINT_256),
        formatToByteLength(encryptedRandom[1].toHexString(), ByteLength.UINT_128),
      ] as [string, string],
  );
  const generatedCommitments = preImages.map((item, index) => {
    // TODO: This event is formatted exactly like a withdraw note, but
    // we should not use this type here. It is NOT a withdraw note.
    const note = new ERC20WithdrawNote( // SEE TODO
      formatToByteLength(item.npk.toHexString(), ByteLength.UINT_256),
      item.value.toBigInt(),
      item.token.tokenAddress,
    );
    return {
      hash: nToHex(note.hash, ByteLength.UINT_256),
      txid: transactionHash,
      blockNumber,
      preImage: note.serialize(false),
      encryptedRandom: randomFormatted[index],
    };
  });
  return generatedCommitments;
}

export function formatGeneratedCommitmentBatchEvent(
  commitmentBatchArgs: GeneratedCommitmentBatchEventArgs,
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

  const formattedCommitments = formatGeneratedCommitmentBatchCommitments(
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

export function formatCommitmentBatchCommitments(
  transactionHash: string,
  hash: BigNumber[],
  commitments: CommitmentCiphertextArgs[],
  blockNumber: number,
): EncryptedCommitment[] {
  return commitments.map((commitment, index) => {
    const { ephemeralKeys, memo } = commitment;
    const ciphertext = commitment.ciphertext.map(
      (el) => formatToByteLength(el.toHexString(), ByteLength.UINT_256), // 32 bytes each.
    );
    const ivTag = ciphertext[0];

    return {
      hash: formatToByteLength(hash[index].toHexString(), ByteLength.UINT_256),
      txid: transactionHash,
      blockNumber,
      ciphertext: {
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
      },
    };
  });
}

export function formatCommitmentBatchEvent(
  commitmentBatchArgs: CommitmentBatchEventArgs,
  transactionHash: string,
  blockNumber: number,
): CommitmentEvent {
  const { treeNumber, startPosition, hash, ciphertext } = commitmentBatchArgs;
  if (treeNumber == null || startPosition == null || hash == null || ciphertext == null) {
    const err = new Error('Invalid CommitmentBatchEventArgs');
    EngineDebug.error(err);
    throw err;
  }

  const formattedCommitments = formatCommitmentBatchCommitments(
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
  events: GeneratedCommitmentBatchEvent[],
) {
  const filtered = events.filter((event) => event.args);
  await Promise.all(
    filtered.map(async (event) => {
      const { args, transactionHash, blockNumber } = event;
      return eventsListener(
        formatGeneratedCommitmentBatchEvent(args, transactionHash, blockNumber),
      );
    }),
  );
}

export async function processCommitmentBatchEvents(
  eventsListener: EventsListener,
  events: CommitmentBatchEvent[],
): Promise<void> {
  const filtered = events.filter((event) => event.args);
  await Promise.all(
    filtered.map(async (event) => {
      const { args, transactionHash, blockNumber } = event;
      return eventsListener(formatCommitmentBatchEvent(args, transactionHash, blockNumber));
    }),
  );
}

export function formatNullifierEvents(
  nullifierEventArgs: NullifierEventArgs,
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

export async function processNullifierEvents(
  eventsNullifierListener: EventsNullifierListener,
  events: NullifiersEvent[],
) {
  const nullifiers: Nullifier[] = [];

  const filtered = events.filter((event) => event.args);
  filtered.forEach((event) => {
    const { args, transactionHash, blockNumber } = event;
    nullifiers.push(...formatNullifierEvents(args, transactionHash, blockNumber));
  });

  await eventsNullifierListener(nullifiers);
}
