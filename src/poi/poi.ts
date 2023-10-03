/* eslint-disable no-restricted-syntax */
/* eslint-disable no-await-in-loop */
import { Proof } from '../models/prover-types';
import { Chain } from '../models/engine-types';
import {
  BlindedCommitmentData,
  POIsPerList,
  TXIDVersion,
  TXOPOIListStatus,
} from '../models/poi-types';
import { SentCommitment, TXO } from '../models/txo-types';
import { isDefined, removeUndefineds } from '../utils/is-defined';
import { POINodeInterface } from './poi-node-interface';
import { UnshieldStoredEvent } from '../models/event-types';

export type POIList = {
  key: string;
  type: POIListType;
};

export enum POIListType {
  Active = 'Active',
  Gather = 'Gather',
}

export class POI {
  private static lists: POIList[];

  private static nodeInterface: POINodeInterface;

  static init(lists: POIList[], nodeInterface: POINodeInterface) {
    this.lists = lists;
    this.nodeInterface = nodeInterface;
  }

  static getAllListKeys(): string[] {
    return this.lists.map((list) => list.key);
  }

  private static getActiveListKeys(): string[] {
    return this.lists.filter((list) => list.type === POIListType.Active).map((list) => list.key);
  }

  private static validatePOIStatusForAllLists(
    pois: POIsPerList,
    listKeys: string[],
    statuses: TXOPOIListStatus[],
  ): boolean {
    if (!this.hasAllKeys(pois, listKeys)) {
      return false;
    }
    for (const listKey of listKeys) {
      if (!statuses.includes(pois[listKey])) {
        return false;
      }
    }
    return true;
  }

  private static hasValidPOIsAllLists(pois: POIsPerList): boolean {
    const listKeys = this.getAllListKeys();
    return this.validatePOIStatusForAllLists(pois, listKeys, [TXOPOIListStatus.Valid]);
  }

  private static hasValidPOIsActiveLists(pois: POIsPerList): boolean {
    const listKeys = this.getActiveListKeys();
    return this.validatePOIStatusForAllLists(pois, listKeys, [TXOPOIListStatus.Valid]);
  }

  private static getAllListKeysWithValidPOIs(inputPOIsPerList: POIsPerList[]): string[] {
    const listKeys = this.getAllListKeys();
    const listKeysShouldGenerateSpentPOIs: string[] = [];
    listKeys.forEach((listKey) => {
      const everyInputPOIValid = inputPOIsPerList.every((poisPerList) => {
        return poisPerList[listKey] === TXOPOIListStatus.Valid;
      });
      if (everyInputPOIValid) {
        listKeysShouldGenerateSpentPOIs.push(listKey);
      }
    });
    return listKeysShouldGenerateSpentPOIs;
  }

  private static findListsForNewPOIs(poisPerList: Optional<POIsPerList>): string[] {
    const listKeys = this.getAllListKeys();
    if (!isDefined(poisPerList)) {
      return listKeys;
    }
    const submittedStatuses = [TXOPOIListStatus.TransactProofSubmitted, TXOPOIListStatus.Valid];
    const needsSpendPOI: string[] = [];
    for (const listKey of listKeys) {
      const isUnsubmitted =
        !isDefined(poisPerList[listKey]) || !submittedStatuses.includes(poisPerList[listKey]);
      if (isUnsubmitted) {
        needsSpendPOI.push(listKey);
      }
    }
    return needsSpendPOI;
  }

  private static hasAllKeys(obj: object, keys: string[]) {
    return keys.every((key) => Object.prototype.hasOwnProperty.call(obj, key));
  }

  static getListKeysCanGenerateSpentPOIs(spentTXOs: TXO[], isLegacyPOIProof: boolean): string[] {
    if (isLegacyPOIProof) {
      // Use all list keys for legacy proofs.
      return POI.getAllListKeys();
    }
    const inputPOIsPerList = removeUndefineds(spentTXOs.map((txo) => txo.poisPerList));
    return POI.getAllListKeysWithValidPOIs(inputPOIsPerList);
  }

  static shouldRetrieveCreationPOIs(txo: TXO) {
    if (!isDefined(txo.blindedCommitment)) {
      return false;
    }
    if (!isDefined(txo.poisPerList)) {
      return true;
    }
    return !POI.hasValidPOIsAllLists(txo.poisPerList);
  }

  static shouldRetrieveSpentPOIs(sentCommitment: SentCommitment) {
    if (!isDefined(sentCommitment.blindedCommitment)) {
      return false;
    }
    if (!isDefined(sentCommitment.poisPerList)) {
      return true;
    }
    return !POI.hasValidPOIsAllLists(sentCommitment.poisPerList);
  }

  static shouldGenerateSpentPOIsSentCommitment(sentCommitment: SentCommitment) {
    if (!isDefined(sentCommitment.blindedCommitment)) {
      return false;
    }
    if (!isDefined(sentCommitment.poisPerList)) {
      return true;
    }
    const listKeys = POI.findListsForNewPOIs(sentCommitment.poisPerList);
    return listKeys.length > 0;
  }

  static shouldGenerateSpentPOIsUnshieldEvent(unshieldEvent: UnshieldStoredEvent) {
    if (!isDefined(unshieldEvent.railgunTxid)) {
      return false;
    }
    if (!isDefined(unshieldEvent.poisPerList)) {
      return true;
    }
    const listKeys = POI.findListsForNewPOIs(unshieldEvent.poisPerList);
    return listKeys.length > 0;
  }

  static isActiveForChain(chain: Chain): boolean {
    try {
      return this.nodeInterface.isActive(chain);
    } catch (err) {
      return false;
    }
  }

  static async retrievePOIsForBlindedCommitments(
    txidVersion: TXIDVersion,
    chain: Chain,
    blindedCommitmentDatas: BlindedCommitmentData[],
  ): Promise<{ [blindedCommitment: string]: POIsPerList }> {
    if (!isDefined(this.nodeInterface)) {
      throw new Error('POI node interface not initialized');
    }
    const listKeys = this.getAllListKeys();
    return this.nodeInterface.getPOIsPerList(txidVersion, chain, listKeys, blindedCommitmentDatas);
  }

  static async getPOIMerkleProofs(
    txidVersion: TXIDVersion,
    chain: Chain,
    listKey: string,
    blindedCommitmentsIn: string[],
  ) {
    if (!isDefined(this.nodeInterface)) {
      throw new Error('POI node interface not initialized');
    }

    return this.nodeInterface.getPOIMerkleProofs(txidVersion, chain, listKey, blindedCommitmentsIn);
  }

  static async submitPOI(
    txidVersion: TXIDVersion,
    chain: Chain,
    listKey: string,
    snarkProof: Proof,
    poiMerkleroots: string[],
    txidMerkleroot: string,
    txidMerklerootIndex: number,
    blindedCommitmentsOut: string[],
    railgunTxidIfHasUnshield: string,
  ): Promise<void> {
    if (!isDefined(this.nodeInterface)) {
      throw new Error('POI node interface not initialized');
    }

    await this.nodeInterface.submitPOI(
      txidVersion,
      chain,
      listKey,
      snarkProof,
      poiMerkleroots,
      txidMerkleroot,
      txidMerklerootIndex,
      blindedCommitmentsOut,
      railgunTxidIfHasUnshield,
    );
  }
}
