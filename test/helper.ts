import { mnemonicToSeedSync } from 'ethereum-cryptography/bip39';
import { HDKey } from 'ethereum-cryptography/hdkey';
import artifacts from 'railgun-artifacts-node';
import { ethers } from 'ethers';
import { bytesToHex } from 'ethereum-cryptography/utils';
import { PublicInputs } from '../src/prover';
import { ScannedEventData, Wallet } from '../src/wallet';
import { AccumulatedEvents, QuickSync } from '../src';
import { CommitmentEvent } from '../src/contracts/railgun-proxy/events';
import { Nullifier } from '../src/models/formatted-types';

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

export const awaitScan = (wallet: Wallet, chainID: number) =>
  new Promise((resolve, reject) =>
    wallet.once('scanned', ({ chainID: returnedChainID }: ScannedEventData) =>
      returnedChainID === chainID ? resolve(returnedChainID) : reject(),
    ),
  );

export const getEthersWallet = (
  mnemonic: string,
  provider: ethers.providers.JsonRpcProvider,
): ethers.Wallet => {
  const node = HDKey.fromMasterSeed(mnemonicToSeedSync(mnemonic)).derive(WALLET_PATH);
  const wallet = new ethers.Wallet(bytesToHex(node.privateKey as Uint8Array), provider);
  return wallet;
};
