import {
  JsonRpcProvider,
  JsonRpcApiProviderOptions,
  Network,
  Subscriber,
} from 'ethers';
import { BatchedPollingEventSubscriber } from './batched-polling-event-subscriber';

/**
 * Uses a setting in JsonRpcProvider to poll for events,
 * rather than using sparsely-implemented eth_filter events.
 *
 * Overrides _getSubscriber to use BatchedPollingEventSubscriber for events,
 * which polls once per pollingInterval instead of per-block.
 */
export class PollingJsonRpcProvider extends JsonRpcProvider {
  readonly isPollingProvider: boolean = true;

  #eventPollingInterval: number;

  #isPaused: boolean = false;

  constructor(url: string, chainId: number, pollingInterval = 10000, maxLogsPerBatch = 100) {
    const network = Network.from(chainId);
    const options: JsonRpcApiProviderOptions = {
      polling: true,
      staticNetwork: network,
      batchMaxCount: maxLogsPerBatch,
    };
    super(url, network, options);
    this.pollingInterval = pollingInterval;
    this.#eventPollingInterval = pollingInterval;
  }

  get paused(): boolean {
    return this.#isPaused;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any, no-underscore-dangle
  _getSubscriber(sub: any): Subscriber {
    if (sub.type === 'event') {
      return new BatchedPollingEventSubscriber(this, sub.filter, this.#eventPollingInterval);
    }
    // eslint-disable-next-line no-underscore-dangle
    return super._getSubscriber(sub);
  }

  pause(): void {
    this.#isPaused = true;
    // eslint-disable-next-line no-underscore-dangle
    this._forEachSubscriber((sub) => {
      sub.pause(false);
    });
  }

  resume(): void {
    this.#isPaused = false;
    // eslint-disable-next-line no-underscore-dangle
    this._forEachSubscriber((sub) => {
      sub.resume();
    });
  }
}
