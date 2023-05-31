import { BigNumber } from '@ethersproject/bignumber';
import { Interface } from '@ethersproject/abi';
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
import ABIRailgunSmartWallet_Legacy_PreMar23 from './legacy-events/RailgunSmartWallet_Legacy_PreMar23.json' assert { type: 'json' };

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
      timestamp: undefined,
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
  commitmentCiphertext: CommitmentCiphertextStructOutput,
): CommitmentCiphertext {
  const { blindedSenderViewingKey, blindedReceiverViewingKey, annotationData, memo } =
    commitmentCiphertext;
  const ciphertext = commitmentCiphertext.ciphertext.map(
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
      timestamp: undefined,
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
  eventLogIndex: number,
): UnshieldStoredEvent {
  const { to, token, amount, fee } = unshieldEventArgs;
  return {
    txid: formatToByteLength(transactionHash, ByteLength.UINT_256),
    timestamp: undefined,
    toAddress: to,
    tokenType: token.tokenType,
    tokenAddress: token.tokenAddress,
    tokenSubID: token.tokenSubID.toHexString(),
    amount: amount.toHexString(),
    fee: fee.toHexString(),
    blockNumber,
    eventLogIndex,
  };
}

export async function processShieldEvents(
  eventsListener: EventsListener,
  events: ShieldEvent[],
): Promise<void> {
  const filtered = events.filter((event) => event.args);
  if (events.length !== filtered.length) {
    throw new Error('Args required for Shield events');
  }
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
  // NOTE: Legacy "Shield" event of the same name conflicts with the current ABI's Shield event.
  // It seems that the first ABI to load, with "Shield" event, for a given contract address,
  // sets a cached version of the ABI interface.
  // So, we need to custom-decode the legacy Shield event here.

  const iface = new Interface(
    ABIRailgunSmartWallet_Legacy_PreMar23.filter((fragment) => fragment.type === 'event'),
  );
  // eslint-disable-next-line no-restricted-syntax
  for (const event of events) {
    const args = iface.decodeEventLog('Shield', event.data);
    event.args = args as any;
  }

  const filtered = events.filter((event) => event.args);
  if (events.length !== filtered.length) {
    throw new Error('Args required for Legacy Shield events');
  }

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
  if (events.length !== filtered.length) {
    throw new Error('Args required for Transact events');
  }
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
  if (events.length !== filtered.length) {
    throw new Error('Args required for Unshield events');
  }
  filtered.forEach((event) => {
    const { args, transactionHash, blockNumber } = event;
    unshields.push(formatUnshieldEvent(args, transactionHash, blockNumber, event.logIndex));
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
  if (events.length !== filtered.length) {
    throw new Error('Args required for Nullified events');
  }

  filtered.forEach((event) => {
    const { args, transactionHash, blockNumber } = event;
    nullifiers.push(...formatNullifiedEvents(args, transactionHash, blockNumber));
  });

  await eventsNullifierListener(nullifiers);
}
