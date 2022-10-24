import { RailgunEngine } from '../railgun-engine';
import { AddressData } from '../key-derivation/bech32';
import { SpendingSolutionGroup } from '../models/txo-types';

type ExtractedSpendingSolutionGroupsData = {
  utxoTxids: string[];
  utxoValues: bigint[];
  outputValues: bigint[];
  outputAddressDatas: AddressData[];
};

type SerializedSpendingSolutionGroupsData = {
  utxoTxids: string[];
  utxoValues: string[];
  outputValues: string[];
  outputAddresses: string[];
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
    };
  });
};

export const extractSpendingSolutionGroupsData = (
  spendingSolutionGroups: SpendingSolutionGroup[],
): ExtractedSpendingSolutionGroupsData[] => {
  return spendingSolutionGroups.map((spendingSolutionGroup) => ({
    utxoTxids: spendingSolutionGroup.utxos.map((utxo) => utxo.txid),
    utxoValues: spendingSolutionGroup.utxos.map((utxo) => utxo.note.value),
    outputValues: spendingSolutionGroup.outputs.map((note) => note.value),
    outputAddressDatas: spendingSolutionGroup.outputs.map((note) => note.receiverAddressData),
  }));
};
