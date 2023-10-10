import { Merkletree } from '../merkletree/merkletree';
import { TXIDMerkletree } from '../merkletree/txid-merkletree';
import { UnshieldStoredEvent } from '../models';
import {
  SentCommitment,
  TXO,
  TXOsReceivedPOIStatusInfo,
  TXOsSpentPOIStatusInfo,
} from '../models/txo-types';
import { getUnshieldEventNoteHash } from '../note';
import { nToHex, ByteLength } from '../utils/bytes';
import { emojiHashForPOIStatusInfo } from '../utils/hash-emoji';
import { isDefined } from '../utils/is-defined';
import { POI } from './poi';

export const formatTXOsReceivedPOIStatusInfo = async (TXOs: TXO[]) => {
  const statusInfos: TXOsReceivedPOIStatusInfo[] = [];

  await Promise.all(
    TXOs.map(async (txo) => {
      const { tree, position, txid } = txo;

      const statusInfo: TXOsReceivedPOIStatusInfo = {
        strings: {
          tree,
          position,
          txid,
          commitment: `${nToHex(txo.note.hash, ByteLength.UINT_256, true)} (${txo.commitmentType})`,
          blindedCommitment: txo.blindedCommitment ?? 'Unavailable',
          poisPerList: txo.poisPerList,
        },
        emojis: {
          tree,
          position,
          txid: emojiHashForPOIStatusInfo(txid),
          commitment: `${emojiHashForPOIStatusInfo(nToHex(txo.note.hash, ByteLength.UINT_256))} (${
            txo.commitmentType
          })`,
          blindedCommitment: isDefined(txo.blindedCommitment)
            ? emojiHashForPOIStatusInfo(txo.blindedCommitment)
            : 'Unavailable',
          poisPerList: txo.poisPerList,
        },
      };

      return statusInfos.push(statusInfo);
    }),
  );

  // Sort descending by global tree/position.
  return statusInfos.sort(
    ({ strings: stringsA }, { strings: stringsB }) =>
      Merkletree.getGlobalPosition(stringsB.tree, stringsB.position) -
      Merkletree.getGlobalPosition(stringsA.tree, stringsA.position),
  );
};

export const formatTXOsSpentPOIStatusInfo = async (
  txidMerkletree: TXIDMerkletree,
  sentCommitments: SentCommitment[],
  TXOs: TXO[],
  unshieldEvents: UnshieldStoredEvent[],
) => {
  const txidGroups: {
    [txid: string]: { sentCommitments: SentCommitment[]; unshieldEvents: UnshieldStoredEvent[] };
  } = {};
  sentCommitments.forEach((sentCommitment) => {
    txidGroups[sentCommitment.txid] ??= {
      sentCommitments: [],
      unshieldEvents: [],
    };
    txidGroups[sentCommitment.txid].sentCommitments.push(sentCommitment);
  });
  unshieldEvents.forEach((unshieldEvent) => {
    txidGroups[unshieldEvent.txid] ??= {
      sentCommitments: [],
      unshieldEvents: [],
    };
    txidGroups[unshieldEvent.txid].unshieldEvents.push(unshieldEvent);
  });

  const statusInfos: TXOsSpentPOIStatusInfo[] = [];

  await Promise.all(
    Object.keys(txidGroups).map(async (txid) => {
      const txidGroup = txidGroups[txid];

      const railgunTxidGroups: {
        [txid: string]: {
          sentCommitments: SentCommitment[];
          unshieldEvents: UnshieldStoredEvent[];
        };
      } = {};
      txidGroup.sentCommitments.forEach((sentCommitment) => {
        if (!isDefined(sentCommitment.railgunTxid)) {
          return;
        }
        railgunTxidGroups[sentCommitment.railgunTxid] ??= {
          sentCommitments: [],
          unshieldEvents: [],
        };
        railgunTxidGroups[sentCommitment.railgunTxid].sentCommitments.push(sentCommitment);
      });
      txidGroup.unshieldEvents.forEach((unshieldEvent) => {
        if (!isDefined(unshieldEvent.railgunTxid)) {
          return;
        }
        railgunTxidGroups[unshieldEvent.railgunTxid] ??= {
          sentCommitments: [],
          unshieldEvents: [],
        };
        railgunTxidGroups[unshieldEvent.railgunTxid].unshieldEvents.push(unshieldEvent);
      });

      await Promise.all(
        Object.keys(railgunTxidGroups).map(async (railgunTxid) => {
          const sentCommitmentsForRailgunTxid = railgunTxidGroups[railgunTxid].sentCommitments;
          const unshieldEventsForRailgunTxid = railgunTxidGroups[railgunTxid].unshieldEvents;

          return statusInfos.push(
            await formatSpentStatusInfo(
              txid,
              railgunTxid,
              txidMerkletree,
              sentCommitmentsForRailgunTxid,
              unshieldEventsForRailgunTxid,
              TXOs,
            ),
          );
        }),
      );
    }),
  );

  // Sort descending by blockNumber.
  return statusInfos.sort(
    ({ strings: stringsA }, { strings: stringsB }) => stringsB.blockNumber - stringsA.blockNumber,
  );
};

const formatSpentStatusInfo = async (
  txid: string,
  railgunTxid: string,
  txidMerkletree: TXIDMerkletree,
  sentCommitmentsForRailgunTxid: SentCommitment[],
  unshieldEventsForRailgunTxid: UnshieldStoredEvent[],
  TXOs: TXO[],
): Promise<TXOsSpentPOIStatusInfo> => {
  const blockNumber = sentCommitmentsForRailgunTxid.length
    ? sentCommitmentsForRailgunTxid[0].note.blockNumber
    : unshieldEventsForRailgunTxid[0].blockNumber;

  const commitmentHashes: string[] = [
    ...sentCommitmentsForRailgunTxid.map((sentCommitment) =>
      nToHex(sentCommitment.note.hash, ByteLength.UINT_256, true),
    ),
    ...unshieldEventsForRailgunTxid.map((unshieldEvent) =>
      nToHex(getUnshieldEventNoteHash(unshieldEvent), ByteLength.UINT_256, true),
    ),
  ];

  let railgunTransactionInfo: string;
  let railgunTransactionInfoEmoji: string;
  let listKeysCanGenerateSpentPOIs: string[] = [];
  let spentTXOs: TXO[] = [];

  if (railgunTxid && railgunTxid !== 'Missing') {
    const railgunTransaction = await txidMerkletree.getRailgunTransactionByTxid(railgunTxid);
    if (railgunTransaction) {
      const nul = railgunTransaction.nullifiers;
      const hasAllNul = nul.every((n) => TXOs.some((txo) => `0x${txo.nullifier}` === n));

      const com = railgunTransaction.commitments;
      const hasAllCom = com.every((c) => commitmentHashes.includes(c));

      railgunTransactionInfo = `${nul.length} nul: ${nul.join(', ')} (${hasAllNul ? '✓' : 'x'}), ${
        com.length
      } com/unsh: ${com.join(', ')} (${hasAllCom ? '✓' : 'x'})`;

      railgunTransactionInfoEmoji = `${nul.length} nul: ${nul
        .map((hex) => emojiHashForPOIStatusInfo(hex))
        .join(', ')} (${hasAllNul ? '✓' : 'x'}), ${com.length} com/unsh: ${com
        .map((hex) => emojiHashForPOIStatusInfo(hex))
        .join(', ')} (${hasAllCom ? '✓' : 'x'})`;

      const isLegacyPOIProof = railgunTransaction.blockNumber < txidMerkletree.poiLaunchBlock;

      spentTXOs = TXOs.filter((txo) =>
        railgunTransaction.nullifiers.includes(`0x${txo.nullifier}`),
      );
      listKeysCanGenerateSpentPOIs = POI.getListKeysCanGenerateSpentPOIs(
        spentTXOs,
        sentCommitmentsForRailgunTxid,
        unshieldEventsForRailgunTxid,
        isLegacyPOIProof,
      );
    } else {
      railgunTransactionInfo = 'Not found';
      railgunTransactionInfoEmoji = 'Not found';
    }
  } else {
    railgunTransactionInfo = 'Missing';
    railgunTransactionInfoEmoji = 'Missing';
  }

  const statusInfo: TXOsSpentPOIStatusInfo = {
    strings: {
      blockNumber: blockNumber ?? 0,
      txid,
      railgunTxid,
      railgunTransactionInfo,
      poiStatusesSpentTXOs: spentTXOs.map((txo) => txo.poisPerList),
      sentCommitmentsBlinded: `${sentCommitmentsForRailgunTxid
        .map((sentCommitment) => sentCommitment.blindedCommitment ?? 'Unavailable')
        .join(', ')}`,
      poiStatusesSentCommitments: sentCommitmentsForRailgunTxid.map(
        (sentCommitment) => sentCommitment.poisPerList,
      ),
      unshieldEventsBlinded: `${unshieldEventsForRailgunTxid
        .map((unshieldEvent) => unshieldEvent.railgunTxid ?? 'Unavailable')
        .join(', ')}`,
      poiStatusesUnshieldEvents: unshieldEventsForRailgunTxid.map(
        (unshieldEvent) => unshieldEvent.poisPerList,
      ),
      listKeysCanGenerateSpentPOIs,
    },
    emojis: {
      blockNumber: blockNumber ?? 0,
      txid: emojiHashForPOIStatusInfo(txid),
      railgunTxid: emojiHashForPOIStatusInfo(railgunTxid),
      railgunTransactionInfo: railgunTransactionInfoEmoji,
      sentCommitmentsBlinded: `${sentCommitmentsForRailgunTxid
        .map((sentCommitment) => {
          return isDefined(sentCommitment.blindedCommitment)
            ? emojiHashForPOIStatusInfo(sentCommitment.blindedCommitment)
            : 'Unavailable';
        })
        .join(', ')}`,
      poiStatusesSpentTXOs: spentTXOs.map((sentCommitment) => sentCommitment.poisPerList),
      poiStatusesSentCommitments: sentCommitmentsForRailgunTxid.map(
        (sentCommitment) => sentCommitment.poisPerList,
      ),
      unshieldEventsBlinded: `${unshieldEventsForRailgunTxid
        .map((unshieldEvent) => {
          return isDefined(unshieldEvent.railgunTxid)
            ? emojiHashForPOIStatusInfo(unshieldEvent.railgunTxid)
            : 'Unavailable';
        })
        .join(', ')}`,
      poiStatusesUnshieldEvents: unshieldEventsForRailgunTxid.map(
        (unshieldEvent) => unshieldEvent.poisPerList,
      ),
      listKeysCanGenerateSpentPOIs: listKeysCanGenerateSpentPOIs.map((listKey) =>
        emojiHashForPOIStatusInfo(listKey),
      ),
    },
  };

  return statusInfo;
};
