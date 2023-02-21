import { BigNumber } from '@ethersproject/bignumber';
import {
  CommitmentCiphertext,
  CommitmentType,
  Nullifier,
  ShieldCommitment,
  TransactCommitment,
} from '../../models/formatted-types';
import { ByteLength, formatToByteLength, nToHex } from '../../utils/bytes';
import EngineDebug from '../../debugger/debugger';
import {
  CommitmentEvent,
  EventsListener,
  EventsNullifierListener,
  EventsUnshieldListener,
  UnshieldStoredEvent,
} from '../../models/event-types';
import {
  CommitmentCiphertextStructOutput,
  CommitmentPreimageStructOutput,
  NullifiedEvent,
  NullifiedEventObject,
  ShieldCiphertextStructOutput,
  ShieldEvent,
  ShieldEventObject,
  TransactEvent,
  TransactEventObject,
  UnshieldEvent,
  UnshieldEventObject,
} from '../../typechain-types/contracts/logic/RailgunSmartWallet';
import { serializeTokenData, serializePreImage, getNoteHash } from '../../note/note-util';
import {
  ShieldEventObject_LegacyShield_PreMar23,
  ShieldEvent_LegacyShield_PreMar23,
} from './legacy-events/RailgunSmartWallet_LegacyShield_PreMar23';

/**
 * Parse event data for database
 */
export function formatShieldCommitments(
  transactionHash: string,
  preImages: CommitmentPreimageStructOutput[],
  shieldCiphertext: ShieldCiphertextStructOutput[],
  blockNumber: number,
  fees: Optional<BigNumber[]>,
): ShieldCommitment[] {
  const shieldCommitments = preImages.map((commitmentPreImage, index) => {
    const npk = formatToByteLength(commitmentPreImage.npk, ByteLength.UINT_256);
    const tokenData = serializeTokenData(
      commitmentPreImage.token.tokenAddress,
      commitmentPreImage.token.tokenType,
      commitmentPreImage.token.tokenSubID.toHexString(),
    );
    const value = commitmentPreImage.value.toBigInt();
    const preImage = serializePreImage(npk, tokenData, value);
    const noteHash = getNoteHash(npk, tokenData, value);

    const commitment: ShieldCommitment = {
      commitmentType: CommitmentType.ShieldCommitment,
      hash: nToHex(noteHash, ByteLength.UINT_256),
      txid: formatToByteLength(transactionHash, ByteLength.UINT_256),
      blockNumber,
      preImage,
      encryptedBundle: shieldCiphertext[index].encryptedBundle,
      shieldKey: shieldCiphertext[index].shieldKey,
      fee: fees ? fees[index].toHexString() : undefined,
    };
    return commitment;
  });
  return shieldCommitments;
}

export function formatShieldEvent(
  shieldEventArgs: ShieldEventObject | ShieldEventObject_LegacyShield_PreMar23,
  transactionHash: string,
  blockNumber: number,
  fees: Optional<BigNumber[]>,
): CommitmentEvent {
  const { treeNumber, startPosition, commitments, shieldCiphertext } = shieldEventArgs;
  if (
    treeNumber == null ||
    startPosition == null ||
    commitments == null ||
    shieldCiphertext == null
  ) {
    const err = new Error('Invalid ShieldEventArgs');
    EngineDebug.error(err);
    throw err;
  }

  const formattedCommitments = formatShieldCommitments(
    transactionHash,
    commitments,
    shieldCiphertext,
    blockNumber,
    fees,
  );
  return {
    txid: formatToByteLength(transactionHash, ByteLength.UINT_256),
    treeNumber: treeNumber.toNumber(),
    startPosition: startPosition.toNumber(),
    commitments: formattedCommitments,
    blockNumber,
  };
}

export function formatCommitmentCiphertext(
  commitment: CommitmentCiphertextStructOutput,
): CommitmentCiphertext {
  const { blindedSenderViewingKey, blindedReceiverViewingKey, annotationData, memo } = commitment;
  const ciphertext = commitment.ciphertext.map(
    (el) => formatToByteLength(el, ByteLength.UINT_256), // 32 bytes each.
  );
  const ivTag = ciphertext[0];

  return {
    ciphertext: {
      iv: ivTag.substring(0, 32),
      tag: ivTag.substring(32),
      data: ciphertext.slice(1),
    },
    blindedSenderViewingKey: formatToByteLength(blindedSenderViewingKey, ByteLength.UINT_256), // 32 bytes each.
    blindedReceiverViewingKey: formatToByteLength(blindedReceiverViewingKey, ByteLength.UINT_256), // 32 bytes each.
    annotationData,
    memo,
  };
}

export function formatTransactCommitments(
  transactionHash: string,
  hash: string[],
  commitments: CommitmentCiphertextStructOutput[],
  blockNumber: number,
): TransactCommitment[] {
  return commitments.map((commitment, index) => {
    return {
      commitmentType: CommitmentType.TransactCommitment,
      hash: formatToByteLength(hash[index], ByteLength.UINT_256),
      txid: formatToByteLength(transactionHash, ByteLength.UINT_256),
      blockNumber,
      ciphertext: formatCommitmentCiphertext(commitment),
    };
  });
}

export function formatTransactEvent(
  transactEventArgs: TransactEventObject,
  transactionHash: string,
  blockNumber: number,
): CommitmentEvent {
  const { treeNumber, startPosition, hash, ciphertext } = transactEventArgs;
  if (treeNumber == null || startPosition == null || hash == null || ciphertext == null) {
    const err = new Error('Invalid TransactEventObject');
    EngineDebug.error(err);
    throw err;
  }

  const formattedCommitments = formatTransactCommitments(
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

export function formatUnshieldEvent(
  unshieldEventArgs: UnshieldEventObject,
  transactionHash: string,
  blockNumber: number,
): UnshieldStoredEvent {
  const { to, token, amount, fee } = unshieldEventArgs;
  return {
    txid: formatToByteLength(transactionHash, ByteLength.UINT_256),
    toAddress: to,
    tokenType: token.tokenType,
    tokenAddress: token.tokenAddress,
    tokenSubID: token.tokenSubID.toHexString(),
    amount: amount.toHexString(),
    fee: fee.toHexString(),
    blockNumber,
  };
}

export async function processShieldEvents(
  eventsListener: EventsListener,
  events: ShieldEvent[],
): Promise<void> {
  const filtered = events.filter((event) => event.args);
  await Promise.all(
    filtered.map(async (event) => {
      const { args, transactionHash, blockNumber } = event;
      const { fees } = args;
      return eventsListener(formatShieldEvent(args, transactionHash, blockNumber, fees));
    }),
  );
}

export async function processShieldEvents_LegacyShield_PreMar23(
  eventsListener: EventsListener,
  events: ShieldEvent_LegacyShield_PreMar23[],
): Promise<void> {
  const filtered = events.filter((event) => event.args);
  await Promise.all(
    filtered.map(async (event) => {
      const { args, transactionHash, blockNumber } = event;
      const fees: Optional<BigNumber[]> = undefined;
      return eventsListener(formatShieldEvent(args, transactionHash, blockNumber, fees));
    }),
  );
}

export async function processTransactEvents(
  eventsListener: EventsListener,
  events: TransactEvent[],
): Promise<void> {
  const filtered = events.filter((event) => event.args);
  await Promise.all(
    filtered.map(async (event) => {
      const { args, transactionHash, blockNumber } = event;
      return eventsListener(formatTransactEvent(args, transactionHash, blockNumber));
    }),
  );
}

export async function processUnshieldEvents(
  eventsUnshieldListener: EventsUnshieldListener,
  events: UnshieldEvent[],
): Promise<void> {
  const unshields: UnshieldStoredEvent[] = [];

  const filtered = events.filter((event) => event.args);
  filtered.forEach((event) => {
    const { args, transactionHash, blockNumber } = event;
    unshields.push(formatUnshieldEvent(args, transactionHash, blockNumber));
  });

  await eventsUnshieldListener(unshields);
}

export function formatNullifiedEvents(
  nullifierEventArgs: NullifiedEventObject,
  transactionHash: string,
  blockNumber: number,
): Nullifier[] {
  const nullifiers: Nullifier[] = [];

  nullifierEventArgs.nullifier.forEach((nullifier: string) => {
    nullifiers.push({
      txid: formatToByteLength(transactionHash, ByteLength.UINT_256),
      nullifier: formatToByteLength(nullifier, ByteLength.UINT_256),
      treeNumber: nullifierEventArgs.treeNumber,
      blockNumber,
    });
  });

  return nullifiers;
}

export async function processNullifiedEvents(
  eventsNullifierListener: EventsNullifierListener,
  events: NullifiedEvent[],
): Promise<void> {
  const nullifiers: Nullifier[] = [];

  const filtered = events.filter((event) => event.args);
  filtered.forEach((event) => {
    const { args, transactionHash, blockNumber } = event;
    nullifiers.push(...formatNullifiedEvents(args, transactionHash, blockNumber));
  });

  await eventsNullifierListener(nullifiers);
}
