import { AbstractProvider, FallbackProvider, JsonRpcProvider } from 'ethers';

export const isNonPollingJsonRpcProvider = (provider: AbstractProvider) => {
  if (!(provider instanceof JsonRpcProvider)) {
    return false;
  }
  // eslint-disable-next-line no-underscore-dangle
  return !provider._getOption('polling');
};

export const isNonPollingFallbackProvider = (fallbackProvider: AbstractProvider) => {
  if (!(fallbackProvider instanceof FallbackProvider)) {
    return false;
  }
  // Do any of the providers in the fallback provider have polling disabled?
  return (
    fallbackProvider.providerConfigs.find(({ provider }) => {
      // eslint-disable-next-line no-underscore-dangle
      return isNonPollingJsonRpcProvider(provider);
    }) != null
  );
};

export const assertPollingProvider = (provider: AbstractProvider) => {
  if (isNonPollingJsonRpcProvider(provider)) {
    throw new Error(
      'The JsonRpcProvider must have polling enabled. Use PollingJsonRpcProvider to instantiate.',
    );
  }
  if (isNonPollingFallbackProvider(provider)) {
    throw new Error(
      'All JsonRpcProviders in FallbackProvider must have polling enabled. Use PollingJsonRpcProvider to instantiate.',
    );
  }
};
