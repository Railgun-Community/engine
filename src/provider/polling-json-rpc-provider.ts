import { JsonRpcProvider } from 'ethers';

/**
 * Uses a setting in JsonRpcProvider to poll for events,
 * rather than using sparsely-implemented eth_filter events.
 */
export class PollingJsonRpcProvider extends JsonRpcProvider {
  constructor(url: string) {
    super(url, undefined, { polling: true });
  }
}
