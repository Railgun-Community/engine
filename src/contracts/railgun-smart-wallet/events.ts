import { Interface } from 'ethers';
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
  EventsCommitmentListener,
  EventsNullifierListener,
  EventsUnshieldListener,
  UnshieldStoredEvent,
} from '../../models/event-types';
import {
  CommitmentCiphertextStructOutput,
  CommitmentPreimageStructOutput,
  NullifiedEvent,
  ShieldCiphertextStructOutput,
  ShieldEvent,
  TransactEvent,
  UnshieldEvent,
} from '../../abi/typechain/RailgunSmartWallet';
import { serializeTokenData, serializePreImage, getNoteHash } from '../../note/note-util';
import { ShieldEvent as ShieldEvent_LegacyShield_PreMar23 } from '../../abi/typechain/RailgunSmartWallet_Legacy_PreMar23';
import { ABIRailgunSmartWallet_Legacy_PreMar23 } from '../../abi/legacy/abi-legacy';

/**
 * Parse event data for database
 */
export function formatShieldCommitments(
  transactionHash: string,
  preImages: CommitmentPreimageStructOutput[],
  shieldCiphertext: ShieldCiphertextStructOutput[],
  blockNumber: number,
  fees: Optional<bigint[]>,
): ShieldCommitment[] {
  const shieldCommitments = preImages.map((commitmentPreImage, index) => {
    const npk = formatToByteLength(commitmentPreImage.npk, ByteLength.UINT_256);
    const tokenData = serializeTokenData(
      commitmentPreImage.token.tokenAddress,
      commitmentPreImage.token.tokenType,
      commitmentPreImage.token.tokenSubID.toString(),
    );
    const { value } = commitmentPreImage;
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
      fee: fees && fees[index] ? fees[index].toString() : undefined,
    };
    return commitment;
  });
  return shieldCommitments;
}

export function formatShieldEvent(
  shieldEventArgs: ShieldEvent.OutputObject | ShieldEvent_LegacyShield_PreMar23.OutputObject,
  transactionHash: string,
  blockNumber: number,
  fees: Optional<bigint[]>,
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
    treeNumber: Number(treeNumber),
    startPosition: Number(startPosition),
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
  transactEventArgs: TransactEvent.OutputObject,
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
    treeNumber: Number(treeNumber),
    startPosition: Number(startPosition),
    commitments: formattedCommitments,
    blockNumber,
  };
}

export function formatUnshieldEvent(
  unshieldEventArgs: UnshieldEvent.OutputObject,
  transactionHash: string,
  blockNumber: number,
  eventLogIndex: number,
): UnshieldStoredEvent {
  const { to, token, amount, fee } = unshieldEventArgs;
  return {
    txid: formatToByteLength(transactionHash, ByteLength.UINT_256),
    timestamp: undefined,
    toAddress: to,
    tokenType: Number(token.tokenType),
    tokenAddress: token.tokenAddress,
    tokenSubID: token.tokenSubID.toString(),
    amount: amount.toString(),
    fee: fee.toString(),
    blockNumber,
    eventLogIndex,
  };
}

export async function processShieldEvents(
  eventsListener: EventsCommitmentListener,
  logs: ShieldEvent.Log[],
): Promise<void> {
  const filtered = logs.filter((log) => log.args);
  if (logs.length !== filtered.length) {
    throw new Error('Args required for Shield events');
  }
  await Promise.all(
    filtered.map(async (log) => {
      const { args, transactionHash, blockNumber } = log;
      const { fees } = args;
      return eventsListener(formatShieldEvent(args, transactionHash, blockNumber, fees));
    }),
  );
}

export async function processShieldEvents_LegacyShield_PreMar23(
  eventsListener: EventsCommitmentListener,
  logs: ShieldEvent_LegacyShield_PreMar23.Log[],
): Promise<void> {
  // NOTE: Legacy "Shield" event of the same name conflicts with the current ABI's Shield event.
  // It seems that the first ABI to load, with "Shield" event, for a given contract address,
  // sets a cached version of the ABI interface.
  // So, we need to custom-decode the legacy Shield event here.

  const iface = new Interface(
    ABIRailgunSmartWallet_Legacy_PreMar23.filter((fragment) => fragment.type === 'event'),
  );
  // eslint-disable-next-line no-restricted-syntax
  for (const log of logs) {
    const args = iface.decodeEventLog('Shield', log.data);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    log.args = args as any;
  }

  const filtered = logs.filter((log) => log.args);
  if (logs.length !== filtered.length) {
    throw new Error('Args required for Legacy Shield events');
  }

  await Promise.all(
    filtered.map(async (event) => {
      const { args, transactionHash, blockNumber } = event;
      const fees: Optional<bigint[]> = undefined;
      return eventsListener(formatShieldEvent(args, transactionHash, blockNumber, fees));
    }),
  );
}

export async function processTransactEvents(
  eventsListener: EventsCommitmentListener,
  logs: TransactEvent.Log[],
): Promise<void> {
  const filtered = logs.filter((log) => log.args);
  if (logs.length !== filtered.length) {
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
  logs: UnshieldEvent.Log[],
): Promise<void> {
  const unshields: UnshieldStoredEvent[] = [];

  const filtered = logs.filter((log) => log.args);
  if (logs.length !== filtered.length) {
    throw new Error('Args required for Unshield events');
  }
  filtered.forEach((log) => {
    const { args, transactionHash, blockNumber } = log;
    unshields.push(formatUnshieldEvent(args, transactionHash, blockNumber, log.index));
  });

  await eventsUnshieldListener(unshields);
}

export function formatNullifiedEvents(
  nullifierEventArgs: NullifiedEvent.OutputObject,
  transactionHash: string,
  blockNumber: number,
): Nullifier[] {
  const nullifiers: Nullifier[] = [];

  nullifierEventArgs.nullifier.forEach((nullifier: string) => {
    nullifiers.push({
      txid: formatToByteLength(transactionHash, ByteLength.UINT_256),
      nullifier: formatToByteLength(nullifier, ByteLength.UINT_256),
      treeNumber: Number(nullifierEventArgs.treeNumber),
      blockNumber,
    });
  });

  return nullifiers;
}

export async function processNullifiedEvents(
  eventsNullifierListener: EventsNullifierListener,
  logs: NullifiedEvent.Log[],
): Promise<void> {
  const nullifiers: Nullifier[] = [];

  const filtered = logs.filter((log) => log.args);
  if (logs.length !== filtered.length) {
    throw new Error('Args required for Nullified events');
  }

  filtered.forEach((log) => {
    const { args, transactionHash, blockNumber } = log;
    nullifiers.push(...formatNullifiedEvents(args, transactionHash, blockNumber));
  });

  await eventsNullifierListener(nullifiers);
}
