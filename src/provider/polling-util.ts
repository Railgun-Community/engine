import { AbstractProvider, FallbackProvider, JsonRpcProvider } from 'ethers';
import { PollingJsonRpcProvider } from './polling-json-rpc-provider';
import { isDefined } from '../utils/is-defined';

export const isNonPollingJsonRpcProvider = (provider: AbstractProvider) => {
  if (!(provider instanceof JsonRpcProvider)) {
    return false;
  }
  // eslint-disable-next-line no-underscore-dangle
  return !isDefined(provider._getOption('polling')) || provider._getOption('polling') === false;
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

  if ('pollingInterval' in provider) {
    // eslint-disable-next-line no-underscore-dangle
    const { url } = provider._getConnection();
    const { chainId } = await provider.getNetwork();
    return new PollingJsonRpcProvider(url, Number(chainId));
  }

  if ('quorum' in provider) {
    // FallbackProvider only

    if (!provider.providerConfigs.length) {
      throw new Error('Requires 1+ providers in FallbackProvider');
    }
    const firstProvider = provider.providerConfigs[0].provider as JsonRpcProvider;
    if (!('pollingInterval' in firstProvider)) {
      throw new Error('First provider in FallbackProvider must be JsonRpcProvider');
    }

    // eslint-disable-next-line no-underscore-dangle
    const { url } = firstProvider._getConnection();
    const { chainId } = await provider.getNetwork();
    // eslint-disable-next-line no-underscore-dangle
    const maxLogsPerBatch = firstProvider._getOption('batchMaxCount');
    return new PollingJsonRpcProvider(url, Number(chainId), pollingInterval, maxLogsPerBatch);
  }

  throw new Error('Invalid ethers provider type');
};
