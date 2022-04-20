/* eslint-disable @typescript-eslint/no-unused-vars */
import { mnemonicToSeedSync } from 'ethereum-cryptography/bip39';
import { HDKey } from 'ethereum-cryptography/hdkey';
// @ts-ignore
import artifacts from 'railgun-artifacts-node';
import { ethers } from 'ethers';
import { bytesToHex } from 'ethereum-cryptography/utils';
import { PublicInputs } from '../src/prover';
import { ScannedEventData, Wallet } from '../src/wallet';
import { AccumulatedEvents, QuickSync } from '../src';
import { CommitmentEvent } from '../src/contract/erc20';
import { Nullifier } from '../src/merkletree';
import { AddressData } from '../src/keyderivation/bech32-encode';
import { randomPubkey } from '../src/utils/babyjubjub';
import { randomPublicKey } from '../src/utils/ed25519';

export const artifactsGetter = (inputs: PublicInputs) =>
  artifacts[inputs.nullifiers.length][inputs.commitmentsOut.length];

export const quicksync: QuickSync = (
  chainID: number,
  startingBlock: number,
): Promise<AccumulatedEvents> =>
  Promise.resolve({
    commitmentEvents: [] as CommitmentEvent[],
    nullifierEvents: [] as Nullifier[],
  });
/*
export const quicksync: QuickSync = (
  _chainID: number,
  _startingBlock: number,
): Promise<{ commitmentEvents: CommitmentEvent[]; nullifierEvents: Nullifier[] }> => ({
  commitmentEvents: [],
  nullifierEvents: [],
});
*/
export const DECIMALS = 10n ** 18n;

export const awaitScan = (wallet: Wallet, chainID: number) =>
  new Promise((resolve, reject) =>
    wallet.once('scanned', ({ chainID: returnedChainID }: ScannedEventData) =>
      returnedChainID === chainID ? resolve(returnedChainID) : reject(),
    ),
  );

const WALLET_PATH = "m/44'/60'/0'/0/0";

export const getEthersWallet = (
  mnemonic: string,
  provider: ethers.providers.JsonRpcProvider,
): ethers.Wallet => {
  const node = HDKey.fromMasterSeed(mnemonicToSeedSync(mnemonic)).derive(WALLET_PATH);
  const wallet = new ethers.Wallet(bytesToHex(node.privateKey as Uint8Array), provider);
  return wallet;
};

export const generateRandomAddress = async (): Promise<AddressData> => ({
  masterPublicKey: randomPubkey(),
  viewingPublicKey: await randomPublicKey(),
});
