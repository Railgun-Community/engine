import { mnemonicToSeedSync } from 'ethereum-cryptography/bip39';
import { HDKey } from 'ethereum-cryptography/hdkey';
import artifacts from 'railgun-artifacts-node';
import { ethers } from 'ethers';
import { bytesToHex } from 'ethereum-cryptography/utils';
import { PublicInputs } from '../src/prover';
import { AccumulatedEvents, QuickSync } from '../src';
import { CommitmentEvent } from '../src/contracts/railgun-proxy/events';
import { Nullifier } from '../src/models/formatted-types';
import { LeptonEvent, ScannedEventData } from '../src/models/event-types';
import { AbstractWallet } from '../src/wallet/abstract-wallet';

export const DECIMALS_18 = BigInt(10) ** BigInt(18);
const WALLET_PATH = "m/44'/60'/0'/0/0";
export const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

export const artifactsGetter = (inputs: PublicInputs) => {
  if (
    !artifacts[inputs.nullifiers.length] ||
    !artifacts[inputs.nullifiers.length][inputs.commitmentsOut.length]
  ) {
    throw new Error(
      `No artifacts for inputs: ${inputs.nullifiers.length}-${inputs.commitmentsOut.length}`,
    );
  }
  return artifacts[inputs.nullifiers.length][inputs.commitmentsOut.length];
};

export const mockQuickSync: QuickSync = (
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _chainID: number,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _startingBlock: number,
): Promise<AccumulatedEvents> =>
  Promise.resolve({
    commitmentEvents: [] as CommitmentEvent[],
    nullifierEvents: [] as Nullifier[],
  });

export const awaitScan = (wallet: AbstractWallet, chainID: number) =>
  new Promise((resolve, reject) =>
    wallet.once(LeptonEvent.WalletScanComplete, ({ chainID: returnedChainID }: ScannedEventData) =>
      returnedChainID === chainID ? resolve(returnedChainID) : reject(),
    ),
  );

export const awaitMultipleScans = async (
  wallet: AbstractWallet,
  chainID: number,
  numScans: number,
) => {
  let i = 0;
  while (i < numScans) {
    // eslint-disable-next-line no-await-in-loop
    await awaitScan(wallet, chainID);
    i += 1;
  }
  return Promise.resolve();
};

export const getEthersWallet = (
  mnemonic: string,
  provider: ethers.providers.JsonRpcProvider,
): ethers.Wallet => {
  const node = HDKey.fromMasterSeed(mnemonicToSeedSync(mnemonic)).derive(WALLET_PATH);
  const wallet = new ethers.Wallet(bytesToHex(node.privateKey as Uint8Array), provider);
  return wallet;
};
