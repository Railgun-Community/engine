import { HDNodeWallet } from 'ethers';
import { Chain } from '../models/engine-types';
import { RailgunWallet } from './railgun-wallet';

export class EphemeralKeyManager {
  private railgunWallet: RailgunWallet;
  private encryptionKey: string;

  constructor(railgunWallet: RailgunWallet, encryptionKey: string) {
    this.railgunWallet = railgunWallet;
    this.encryptionKey = encryptionKey;
  }

  async getWallet(chainId: bigint, index: number): Promise<HDNodeWallet> {
    return this.railgunWallet.getEphemeralWallet(
      this.encryptionKey,
      chainId,
      index,
    );
  }

  async getCurrentWallet(chainId: bigint): Promise<HDNodeWallet> {
    const index = await this.railgunWallet.getEphemeralKeyIndex(chainId);
    return this.getWallet(chainId, index);
  }

  async getNextWallet(chainId: bigint): Promise<HDNodeWallet> {
    const currentIndex = await this.railgunWallet.getEphemeralKeyIndex(chainId);
    const nextIndex = currentIndex + 1;
    await this.railgunWallet.setEphemeralKeyIndex(chainId, nextIndex);
    return this.getWallet(chainId, nextIndex);
  }

  async scanHistoryForEphemeralIndex(
    chain: Chain,
    scanLimit = 100,
  ): Promise<number> {
    const chainId = BigInt(chain.id);
    const history = await this.railgunWallet.getTransactionHistory(chain, undefined);

    const unshieldRecipients = new Set<string>();
    for (const entry of history) {
      for (const unshield of entry.unshieldTokenAmounts) {
        unshieldRecipients.add(unshield.recipientAddress.toLowerCase());
      }
    }

    if (unshieldRecipients.size === 0) {
      return 0;
    }

    let maxUsedIndex = -1;
    let currentIndex = 0;
    let gapCount = 0;
    const gapLimit = 20;

    while (currentIndex < scanLimit && gapCount < gapLimit) {
      // eslint-disable-next-line no-await-in-loop
      const wallet = await this.getWallet(chainId, currentIndex);
      const address = wallet.address.toLowerCase();

      if (unshieldRecipients.has(address)) {
        maxUsedIndex = currentIndex;
        gapCount = 0;
      } else {
        gapCount += 1;
      }
      currentIndex += 1;
    }

    const nextIndex = maxUsedIndex + 1;
    const storedIndex = await this.railgunWallet.getEphemeralKeyIndex(chainId);
    if (nextIndex > storedIndex) {
      await this.railgunWallet.setEphemeralKeyIndex(chainId, nextIndex);
    }

    return nextIndex;
  }
}
