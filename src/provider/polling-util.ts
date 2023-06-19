import { AbstractProvider, FallbackProvider, JsonRpcProvider } from 'ethers';
import { PollingJsonRpcProvider } from './polling-json-rpc-provider';

export const isNonPollingJsonRpcProvider = (provider: AbstractProvider) => {
  if (!(provider instanceof JsonRpcProvider)) {
    return false;
  }
  // eslint-disable-next-line no-underscore-dangle
  return !provider._getOption('polling');
};

export const assertIsPollingProvider = (provider: AbstractProvider) => {
  if (isNonPollingJsonRpcProvider(provider)) {
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
  pollingInterval?: number,
): Promise<PollingJsonRpcProvider> => {
  if (provider instanceof PollingJsonRpcProvider) {
    return provider;
  }

  if (provider instanceof JsonRpcProvider) {
    // eslint-disable-next-line no-underscore-dangle
    const { url } = provider._getConnection();
    const { chainId } = await provider.getNetwork();
    return new PollingJsonRpcProvider(url, Number(chainId));
  }

  if (provider instanceof FallbackProvider) {
    if (!provider.providerConfigs.length) {
      throw new Error('Requires 1+ providers in FallbackProvider');
    }

    // TODO: Support WSS providers for polling.
    if (!(provider.providerConfigs[0].provider instanceof JsonRpcProvider)) {
      throw new Error('First provider in FallbackProvider must be JsonRpcProvider');
    }

    // eslint-disable-next-line no-underscore-dangle
    const { url } = provider.providerConfigs[0].provider._getConnection();
    const { chainId } = await provider.getNetwork();
    // eslint-disable-next-line no-underscore-dangle
    const maxLogsPerBatch = provider.providerConfigs[0].provider._getOption('batchMaxSize');
    return new PollingJsonRpcProvider(url, Number(chainId), pollingInterval, maxLogsPerBatch);
  }

  throw new Error('Invalid provider type - make sure you are using the same version of ethers');
};
