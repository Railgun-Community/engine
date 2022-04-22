import type { BigNumber, Event } from 'ethers';
import { Commitment, EncryptedCommitment, GeneratedCommitment, Nullifier } from '../../merkletree';
import { WithdrawNote } from '../../note';
import { EncryptedRandom } from '../../transaction/types';
import { BytesData, hexlify } from '../../utils/bytes';

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

export type EncryptedRandomArgs = [BigNumber, BigNumber];

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
  encryptedRandom: EncryptedRandomArgs[];
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

const formatTokenData = (token: EventTokenData) => ({
  tokenType: token.tokenType.toString(),
  tokenAddress: token.tokenAddress,
  tokenSubID: token.tokenSubID.toString(),
});

export function formatGeneratedCommitmentBatchCommitments(
  transactionHash: string,
  preImages: CommitmentPreimageArgs[],
  encryptedRandom: EncryptedRandomArgs[],
): GeneratedCommitment[] {
  const randomFormatted = encryptedRandom.map(
    (el): EncryptedRandom => el.map((key) => key.toHexString()),
  );
  const generatedCommitments = preImages.map((preImage, index) => {
    const token = formatTokenData(preImage.token);
    const note = new WithdrawNote(preImage.npk.toHexString(), preImage.value.toBigInt(), token);
    return {
      hash: note.hash,
      txid: transactionHash,
      data: note.serialize(randomFormatted[index]),
    };
  });
  return generatedCommitments;
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
          iv: ivTag.substring(0, 16),
          tag: ivTag.substring(16),
          data: ciphertext.slice(1),
        },
        ephemeralKeys: ephemeralKeys.map((key) => hexlify(key.toHexString())),
        memo,
      },
    };
  });
}

export function processGeneratedCommitment(event: Event) {
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

export async function processGeneratedCommitmentEvents(
  eventsListener: EventsListener,
  events: Event[],
) {
  const filtered = events.filter((event) => event.args);
  await Promise.all(filtered.map(async (e) => eventsListener(processGeneratedCommitment(e))));
}

export function processCommitmentBatchEvent(event: Event) {
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

export async function processCommitmentBatchEvents(listener: EventsListener, events: Event[]) {
  const filtered = events.filter((event) => event.args);
  await Promise.all(
    filtered.map(async (e) => {
      listener(processCommitmentBatchEvent(e));
    }),
  );
}

export async function processNullifierEvents(
  eventsNullifierListener: EventsNullifierListener,
  events: Event[],
) {
  const nullifiers: Nullifier[] = [];

  const filtered = events.filter((event) => event.args);
  filtered.forEach(async (event) => {
    const { args } = event;
    args!.nullifiers.forEach((nullifier: BigNumber) => {
      nullifiers.push({
        txid: event.transactionHash,
        nullifier: nullifier.toHexString(),
        treeNumber: args!.treeNumber,
      });
    });
  });

  await eventsNullifierListener(nullifiers);
}
