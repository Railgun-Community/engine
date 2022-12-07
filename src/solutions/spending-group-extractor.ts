import { RailgunEngine } from '../railgun-engine';
import { AddressData } from '../key-derivation/bech32';
import { SpendingSolutionGroup } from '../models/txo-types';

type ExtractedSpendingSolutionGroupsData = {
  utxoTxids: string[];
  utxoValues: bigint[];
  outputValues: bigint[];
  outputAddressDatas: AddressData[];
  tokenHash: string;
};

type SerializedSpendingSolutionGroupsData = {
  utxoTxids: string[];
  utxoValues: string[];
  outputValues: string[];
  outputAddresses: string[];
  tokenHash: string;
};

export const serializeExtractedSpendingSolutionGroupsData = (
  datas: ExtractedSpendingSolutionGroupsData[],
): SerializedSpendingSolutionGroupsData[] => {
  return datas.map((data) => {
    return {
      utxoTxids: data.utxoTxids,
      utxoValues: data.utxoValues.map((val) => val.toString(10)),
      outputValues: data.outputValues.map((val) => val.toString(10)),
      outputAddresses: data.outputAddressDatas.map(RailgunEngine.encodeAddress),
      tokenHash: data.tokenHash,
    };
  });
};

export const extractSpendingSolutionGroupsData = (
  spendingSolutionGroups: SpendingSolutionGroup[],
): ExtractedSpendingSolutionGroupsData[] => {
  return spendingSolutionGroups.map((spendingSolutionGroup) => ({
    utxoTxids: spendingSolutionGroup.utxos.map((utxo) => utxo.txid),
    utxoValues: spendingSolutionGroup.utxos.map((utxo) => utxo.note.value),
    outputValues: spendingSolutionGroup.tokenOutputs.map((note) => note.value),
    outputAddressDatas: spendingSolutionGroup.tokenOutputs.map((note) => note.receiverAddressData),
    tokenHash: spendingSolutionGroup.tokenHash,
  }));
};
