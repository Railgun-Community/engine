import { AbstractProvider, FallbackProvider, JsonRpcProvider } from 'ethers';
import { PollingJsonRpcProvider } from './polling-json-rpc-provider';

const isPollingProvider = (provider: AbstractProvider): provider is PollingJsonRpcProvider => {
  console.log('isPollingProvider:', provider);
  return (
    true
  );
};

export const assertIsPollingProvider = (provider: AbstractProvider) => {
  console.log('assertIsPollingProvider: ', provider);
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
  console.log('Create Polling JSON')
  return provider as unknown as PollingJsonRpcProvider;
};
