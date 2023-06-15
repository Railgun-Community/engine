import { AbstractProvider, JsonRpcProvider } from 'ethers';

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
