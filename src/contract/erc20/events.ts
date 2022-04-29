import type { BigNumber, Event } from 'ethers';
import {
  BytesData,
  Commitment,
  EncryptedCommitment,
  EncryptedData,
  GeneratedCommitment,
  Nullifier,
} from '../../models/transaction-types';
import { ByteLength, hexlify, nToHex } from '../../utils/bytes';
import { ERC20WithdrawNote } from '../../note/erc20-withdraw';

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

export function formatGeneratedCommitmentBatchEvent(event: Event): CommitmentEvent {
  const args = event.args as unknown as GeneratedCommitmentBatchEventArgs;
  const formattedCommitments = formatGeneratedCommitmentBatchCommitments(
    event.transactionHash,
    args.commitments,
    args.encryptedRandom,
  );
  return {
    txid: hexlify(event.transactionHash),
    treeNumber: args.treeNumber.toNumber(),
    startPosition: args.startPosition.toNumber(),
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
    const ciphertext = commitment.ciphertext.map((el) => hexlify(el.toHexString()));
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
        ephemeralKeys: ephemeralKeys.map((key) => hexlify(key.toHexString())),
        memo,
      },
    };
  });
}

export function formatCommitmentBatchEvent(event: Event) {
  const args = event.args as unknown as CommitmentBatchEventArgs;

  const { treeNumber, startPosition, hash, ciphertext } = args;
  const formattedCommitments = formatCommitmentBatchCommitments(
    event.transactionHash,
    hash,
    ciphertext,
  );
  return {
    txid: hexlify(event.transactionHash),
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
    filtered.map(async (e) => eventsListener(formatGeneratedCommitmentBatchEvent(e))),
  );
}

export async function processCommitmentBatchEvents(listener: EventsListener, events: Event[]) {
  const filtered = events.filter((event) => event.args);
  await Promise.all(
    filtered.map(async (e) => {
      listener(formatCommitmentBatchEvent(e));
    }),
  );
}

export function formatNullifierEvents(event: Event): Nullifier[] {
  const nullifiers: Nullifier[] = [];

  const { args } = event;
  args!.nullifier.forEach((nullifier: BigNumber) => {
    nullifiers.push({
      txid: hexlify(event.transactionHash),
      nullifier: nullifier.toHexString(),
      treeNumber: args!.treeNumber.toNumber(),
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
    nullifiers.push(...formatNullifierEvents(event));
  });

  await eventsNullifierListener(nullifiers);
}
