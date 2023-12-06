/* eslint-disable no-await-in-loop */

import { ContractTransaction } from 'ethers';
import { createDummyMerkleProof } from '../merkletree/merkle-proof';
import { Chain } from '../models/engine-types';
import { PreTransactionPOIsPerTxidLeafPerList, TXIDVersion } from '../models/poi-types';
import { ExtractedRailgunTransactionData } from '../models/transaction-types';
import { getGlobalTreePositionPreTransactionPOIProof } from '../poi/global-tree-position';
import { POI } from '../poi/poi';
import { Prover } from '../prover/prover';
import { getRailgunTxidLeafHash } from '../transaction/railgun-txid';
import { hexToBigInt } from '../utils/bytes';
import { isDefined } from '../utils/is-defined';
import { extractRailgunTransactionDataFromTransactionRequest } from './extract-transaction-data';
import { POIProof, TransactProofData } from './poi-proof';
import { AddressData } from '../key-derivation';
import { TokenDataGetter } from '../token';

export class POIValidation {
  static async isValidSpendableTransaction(
    txidVersion: TXIDVersion,
    chain: Chain,
    prover: Prover,
    transactionRequest: ContractTransaction,
    useRelayAdapt: boolean,
    contractAddress: string,
    preTransactionPOIs: PreTransactionPOIsPerTxidLeafPerList,
    receivingViewingPrivateKey: Uint8Array,
    receivingRailgunAddressData: AddressData,
    tokenDataGetter: TokenDataGetter,
  ): Promise<{
    isValid: boolean;
    error?: string;
    extractedRailgunTransactionData?: ExtractedRailgunTransactionData;
  }> {
    try {
      const extractedRailgunTransactionData: ExtractedRailgunTransactionData =
        await extractRailgunTransactionDataFromTransactionRequest(
          txidVersion,
          chain,
          transactionRequest,
          useRelayAdapt,
          contractAddress,
          receivingViewingPrivateKey,
          receivingRailgunAddressData,
          tokenDataGetter,
        );

      const activeListKeys = POI.getActiveListKeys();

      // eslint-disable-next-line no-restricted-syntax
      for (const listKey of activeListKeys) {
        await this.assertIsValidSpendableTXID(
          txidVersion,
          listKey,
          chain,
          prover,
          preTransactionPOIs,
          extractedRailgunTransactionData.map((data) => data.railgunTxid),
          extractedRailgunTransactionData.map((data) => data.utxoTreeIn),
        );
      }

      return { isValid: true, extractedRailgunTransactionData };
    } catch (cause) {
      if (!(cause instanceof Error)) {
        throw new Error('Non-error thrown from isValidSpendableTransaction', { cause });
      }
      return {
        isValid: false,
        error: `Could not validate spendable TXID: ${cause.message}`,
      };
    }
  }

  static async assertIsValidSpendableTXID(
    txidVersion: TXIDVersion,
    listKey: string,
    chain: Chain,
    prover: Prover,
    preTransactionPOIs: PreTransactionPOIsPerTxidLeafPerList,
    railgunTxids: string[],
    utxoTreesIn: bigint[],
  ): Promise<boolean> {
    const txidLeafHashes: string[] = railgunTxids.map((railgunTxid, index) =>
      getRailgunTxidLeafHash(
        hexToBigInt(railgunTxid),
        utxoTreesIn[index],
        getGlobalTreePositionPreTransactionPOIProof(),
      ),
    );

    // 1. Validate list key is present
    if (!isDefined(preTransactionPOIs[listKey])) {
      throw new Error(`Missing POIs for list: ${listKey}`);
    }

    const poisForList = preTransactionPOIs[listKey];

    // eslint-disable-next-line no-restricted-syntax
    for (const txidLeafHash of txidLeafHashes) {
      // 2. Validate txid leaf hash
      if (!isDefined(poisForList[txidLeafHash])) {
        throw new Error(`Missing POI for txidLeafHash ${txidLeafHash} for list ${listKey}`);
      }

      const {
        snarkProof,
        txidMerkleroot,
        poiMerkleroots,
        blindedCommitmentsOut,
        railgunTxidIfHasUnshield,
      } = poisForList[txidLeafHash];

      // 3. Validate txidDummyMerkleProof and txid root
      const dummyMerkleProof = createDummyMerkleProof(txidLeafHash);
      if (dummyMerkleProof.root !== txidMerkleroot) {
        throw new Error('Invalid txid merkle proof');
      }

      // 4. Validate POI merkleroots for each list
      const validPOIMerkleroots = await POI.validatePOIMerkleroots(
        txidVersion,
        chain,
        listKey,
        poiMerkleroots,
      );
      if (!validPOIMerkleroots) {
        throw new Error(`Invalid POI merkleroots: list ${listKey}`);
      }

      // 5. Verify snark proof for each list
      const transactProofData: TransactProofData = {
        snarkProof,
        txidMerkleroot,
        poiMerkleroots,
        blindedCommitmentsOut,
        railgunTxidIfHasUnshield,
        txidMerklerootIndex: 0, // Unused
      };
      const validProof = await POIProof.verifyTransactProof(prover, transactProofData);
      if (!validProof) {
        throw new Error(`Could not verify POI snark proof: list ${listKey}`);
      }
    }

    return true;
  }
}
