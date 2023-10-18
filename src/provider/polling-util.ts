import { AbstractProvider, FallbackProvider, JsonRpcProvider } from 'ethers';
import { PollingJsonRpcProvider } from './polling-json-rpc-provider';

const isPollingProvider = (provider: AbstractProvider): provider is PollingJsonRpcProvider => {
  return (
    provider.providerType === 'jsonrpc' && (provider as PollingJsonRpcProvider).isPollingProvider
  );
};

export const assertIsPollingProvider = (provider: AbstractProvider) => {
  if (!isPollingProvider(provider)) {
    throw new Error(
      'The JsonRpcProvider must have polling enabled. Use PollingJsonRpcProvider to instantiate.',
    );
  }
};

/**
 * Fallback Providers don't poll correctly for events.
 * This function creates a PollingJsonRpcProvider from the first provider in the FallbackProvider.
 */
export const createPollingJsonRpcProviderForListeners = async (
  provider: JsonRpcProvider | FallbackProvider,
  chainId: number,
  pollingInterval?: number,
): Promise<PollingJsonRpcProvider> => {
  if (isPollingProvider(provider)) {
    return provider;
  }

  if (provider.providerType === 'jsonrpc') {
    // eslint-disable-next-line no-underscore-dangle
    const { url } = provider._getConnection();
    return new PollingJsonRpcProvider(url, chainId, pollingInterval);
  }

  if (provider.providerType === 'fallback') {
    // FallbackProvider only

    if (!provider.providerConfigs.length) {
      throw new Error('Requires 1+ providers in FallbackProvider');
    }
    const firstProvider = provider.providerConfigs[0].provider as JsonRpcProvider;
    if (firstProvider.providerType !== 'jsonrpc') {
      throw new Error('First provider in FallbackProvider must be JsonRpcProvider');
    }

    // eslint-disable-next-line no-underscore-dangle
    const { url } = firstProvider._getConnection();
    // eslint-disable-next-line no-underscore-dangle
    const maxLogsPerBatch = firstProvider._getOption('batchMaxCount');
    return new PollingJsonRpcProvider(url, chainId, pollingInterval, maxLogsPerBatch);
  }

  throw new Error('Invalid ethers provider type');
};
