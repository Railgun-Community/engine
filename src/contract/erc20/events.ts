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

export type EncryptedCommitmentArgs = {
  hash: BigNumber;
  ciphertext: CommitmentCiphertextArgs[];
};

export type EventTokenData = { tokenType: BigNumber; tokenAddress: string; tokenSubID: BigNumber };

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
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
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

export function formatNullifier(transactionHash: string, nullifier: BigNumber) {
  return {
    txid: transactionHash,
    nullifier: nullifier.toHexString(),
  };
}

export async function processGeneratedCommitmentEvents(
  eventsListener: EventsListener,
  events: Event[],
) {
  const filtered = events.filter((event) => event.args);
  await Promise.all(
    filtered.map(async (e) => {
      const { treeNumber, startPosition, commitments, encryptedRandom } = e.args!;
      const formattedCommitments = formatGeneratedCommitmentBatchCommitments(
        e.transactionHash,
        commitments,
        encryptedRandom,
      );
      return eventsListener({
        txid: hexlify(e.transactionHash),
        treeNumber: treeNumber.toNumber(),
        startPosition: startPosition.toNumber(),
        commitments: formattedCommitments,
      });
    }),
  );
}

export async function processCommitmentBatchEvents(listener: EventsListener, events: Event[]) {
  const filtered = events.filter((event) => event.args);
  await Promise.all(
    filtered.map(async (e) => {
      const { treeNumber, startPosition, hash, ciphertext } = e.args!;
      const formattedCommitments = formatCommitmentBatchCommitments(
        e.transactionHash,
        hash,
        ciphertext,
      );
      return listener({
        txid: hexlify(e.transactionHash),
        treeNumber: treeNumber.toNumber(),
        startPosition: startPosition.toNumber(),
        commitments: formattedCommitments,
      });
    }),
  );
}

export async function processNullifierEvents(
  eventsNullifierListener: EventsNullifierListener,
  events: Event[],
) {
  const nullifiers: Nullifier[] = [];

  events.forEach(async (event) => {
    if (!event.args) {
      return;
    }
    nullifiers.push(formatNullifier(event.transactionHash, event.args.nullifier));
  });

  await eventsNullifierListener(nullifiers);
}
