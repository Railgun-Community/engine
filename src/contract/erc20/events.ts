import type { BigNumber, Event } from 'ethers';
import {
  BytesData,
  Commitment,
  EncryptedCommitment,
  EncryptedData,
  GeneratedCommitment,
  Nullifier,
} from '../../models/transaction-types';
import { ByteLength, formatToByteLength, hexlify, nToHex } from '../../utils/bytes';
import { ERC20WithdrawNote } from '../../note/erc20-withdraw';
import LeptonDebug from '../../debugger';

export type CommitmentEvent = {
  txid: BytesData;
  treeNumber: number;
  startPosition: number;
  commitments: Commitment[];
};

export type EventsListener = (event: CommitmentEvent) => Promise<void>;
export type EventsNullifierListener = (nullifiers: Nullifier[]) => Promise<void>;

export type CommitmentCiphertextArgs = {
  ciphertext: [BigNumber, BigNumber, BigNumber, BigNumber];
  ephemeralKeys: [BigNumber, BigNumber];
  memo: string;
};

export type CommitmentTokenData = {
  tokenType: BigNumber;
  tokenAddress: string;
  tokenSubID: BigNumber;
};

export type EncryptedDataArgs = [BigNumber, BigNumber];

export type CommitmentPreimageArgs = {
  npk: BigNumber;
  token: CommitmentTokenData;
  value: BigNumber;
};

export type EventTokenData = { tokenType: BigNumber; tokenAddress: string; tokenSubID: BigNumber };

/**
 * event.args of GeneratedCommitmentBatch Event
 */
export type GeneratedCommitmentBatchEventArgs = {
  treeNumber: BigNumber;
  startPosition: BigNumber;
  commitments: CommitmentPreimageArgs[];
  encryptedRandom: EncryptedDataArgs[];
};

/**
 * event.args of CommitmentBatch Event
 */
export type CommitmentBatchEventArgs = {
  treeNumber: BigNumber;
  startPosition: BigNumber;
  hash: BigNumber[];
  ciphertext: CommitmentCiphertextArgs[];
};

export type NullifierEventArgs = {
  treeNumber: BigNumber;
  nullifier: BigNumber[];
};

/**
 * Parse event data for database
 */
export function formatGeneratedCommitmentBatchCommitments(
  transactionHash: string,
  preImages: CommitmentPreimageArgs[],
  encryptedRandom: EncryptedDataArgs[],
): GeneratedCommitment[] {
  const randomFormatted = encryptedRandom.map(
    (el) => el.map((key) => key.toHexString()) as EncryptedData,
  );
  const generatedCommitments = preImages.map((item, index) => {
    // TODO: This event is formatted exactly like a withdraw note, but
    // we should not use this type here. It is NOT a withdraw note.
    const note = new ERC20WithdrawNote(
      item.npk.toHexString(),
      item.value.toBigInt(),
      item.token.tokenAddress,
    );
    return {
      hash: nToHex(note.hash, ByteLength.UINT_256),
      txid: transactionHash,
      preImage: note.serialize(false),
      encryptedRandom: randomFormatted[index],
    };
  });
  return generatedCommitments;
}

export function formatGeneratedCommitmentBatchEvent(
  commitmentBatchArgs: GeneratedCommitmentBatchEventArgs,
  transactionHash: string,
): CommitmentEvent {
  const { treeNumber, startPosition, commitments, encryptedRandom } = commitmentBatchArgs;
  if (
    treeNumber == null ||
    startPosition == null ||
    commitments == null ||
    encryptedRandom == null
  ) {
    const err = new Error('Invalid GeneratedCommitmentBatchEventArgs');
    LeptonDebug.error(err);
    throw err;
  }

  const formattedCommitments = formatGeneratedCommitmentBatchCommitments(
    transactionHash,
    commitments,
    encryptedRandom,
  );
  return {
    txid: hexlify(transactionHash),
    treeNumber: treeNumber.toNumber(),
    startPosition: startPosition.toNumber(),
    commitments: formattedCommitments,
  };
}

export function formatCommitmentBatchCommitments(
  transactionHash: string,
  hash: BigNumber[],
  commitments: CommitmentCiphertextArgs[],
): EncryptedCommitment[] {
  return commitments.map((commitment, index) => {
    const { ephemeralKeys, memo } = commitment;
    const ciphertext = commitment.ciphertext.map(
      (el) => formatToByteLength(el.toHexString(), ByteLength.UINT_256), // 32 bytes each.
    );
    const ivTag = ciphertext[0];

    return {
      hash: hash[index].toHexString(),
      txid: transactionHash,
      ciphertext: {
        ciphertext: {
          iv: ivTag.substring(0, 32),
          tag: ivTag.substring(32),
          data: ciphertext.slice(1),
        },
        ephemeralKeys: ephemeralKeys.map(
          (key) => formatToByteLength(key.toHexString(), ByteLength.UINT_256), // 32 bytes each.
        ),
        memo,
      },
    };
  });
}

export function formatCommitmentBatchEvent(
  commitmentBatchArgs: CommitmentBatchEventArgs,
  transactionHash: string,
) {
  const { treeNumber, startPosition, hash, ciphertext } = commitmentBatchArgs;
  if (treeNumber == null || startPosition == null || hash == null || ciphertext == null) {
    const err = new Error('Invalid CommitmentBatchEventArgs');
    LeptonDebug.error(err);
    throw err;
  }

  const formattedCommitments = formatCommitmentBatchCommitments(transactionHash, hash, ciphertext);
  return {
    txid: hexlify(transactionHash),
    treeNumber: treeNumber.toNumber(),
    startPosition: startPosition.toNumber(),
    commitments: formattedCommitments,
  };
}

export async function processGeneratedCommitmentEvents(
  eventsListener: EventsListener,
  events: Event[],
) {
  const filtered = events.filter((event) => event.args);
  await Promise.all(
    filtered.map(async (event) => {
      const { args, transactionHash } = event;
      return eventsListener(
        formatGeneratedCommitmentBatchEvent(
          args as unknown as GeneratedCommitmentBatchEventArgs,
          transactionHash,
        ),
      );
    }),
  );
}

export async function processCommitmentBatchEvents(
  eventsListener: EventsListener,
  events: Event[],
) {
  const filtered = events.filter((event) => event.args);
  await Promise.all(
    filtered.map(async (event) => {
      const { args, transactionHash } = event;
      return eventsListener(
        formatCommitmentBatchEvent(args as unknown as CommitmentBatchEventArgs, transactionHash),
      );
    }),
  );
}

export function formatNullifierEvents(
  nullifierEventArgs: NullifierEventArgs,
  transactionHash: string,
): Nullifier[] {
  const nullifiers: Nullifier[] = [];

  nullifierEventArgs.nullifier.forEach((nullifier: BigNumber) => {
    nullifiers.push({
      txid: hexlify(transactionHash),
      nullifier: nullifier.toHexString(),
      treeNumber: nullifierEventArgs.treeNumber.toNumber(),
    });
  });

  return nullifiers;
}

export async function processNullifierEvents(
  eventsNullifierListener: EventsNullifierListener,
  events: Event[],
) {
  const nullifiers: Nullifier[] = [];

  const filtered = events.filter((event) => event.args);
  filtered.forEach((event) => {
    const { args, transactionHash } = event;
    nullifiers.push(
      ...formatNullifierEvents(args as unknown as NullifierEventArgs, transactionHash),
    );
  });

  await eventsNullifierListener(nullifiers);
}
