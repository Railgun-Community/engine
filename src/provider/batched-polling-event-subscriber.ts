import { EventFilter, Subscriber, AbstractProvider, Log } from 'ethers';
import { isDefined } from '../utils/is-defined';

function copyFilter(obj: EventFilter): EventFilter & { fromBlock?: number; toBlock?: number; } {
  return JSON.parse(JSON.stringify(obj));
}
/**
 * A batched event subscriber that polls once per interval instead of per-block.
 * This dramatically reduces eth_getLogs calls.
 *
 * reasoning: ethers PollingEventSubscriber fires on every "block" event,
 * this subscriber uses a timer-based approach matching the pollingInterval.
 */
export class BatchedPollingEventSubscriber implements Subscriber {
  #provider: AbstractProvider;

  #filter: EventFilter;

  #running: boolean;

  #blockNumber: number;

  #pollTimer: ReturnType<typeof setTimeout> | null;

  #pollingInterval: number;

  constructor(provider: AbstractProvider, filter: EventFilter, pollingInterval: number) {
    this.#provider = provider;
    this.#filter = copyFilter(filter);
    this.#running = false;
    this.#blockNumber = -2;
    this.#pollTimer = null;
    this.#pollingInterval = pollingInterval;
  }

  async #poll(): Promise<void> {
    if (!this.#running) {
      return;
    }

    try {
      const blockNumber = await this.#provider.getBlockNumber();

      if (this.#blockNumber === -2) {
        this.#blockNumber = blockNumber;
        this.#schedulePoll();
        return;
      }

      if (blockNumber <= this.#blockNumber) {
        this.#schedulePoll();
        return;
      }

      const filter = copyFilter(this.#filter);
      filter.fromBlock = this.#blockNumber + 1;
      filter.toBlock = blockNumber;

      const logs: Log[] = await this.#provider.getLogs(filter);

      for (const log of logs) {
        // eslint-disable-next-line @typescript-eslint/no-floating-promises
        this.#provider.emit(this.#filter, log);
      }

      if (logs.length > 0) {
        this.#blockNumber = logs[logs.length - 1].blockNumber;
      } else {
        this.#blockNumber = blockNumber;
      }
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('BatchedPollingEventSubscriber poll error:', error);
    }

    this.#schedulePoll();
  }

  #schedulePoll(): void {
    if (!this.#running) {
      return;
    }
    this.#pollTimer = setTimeout(() => {
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      this.#poll();
    }, this.#pollingInterval);
  }

  start(): void {
    if (this.#running) {
      return;
    }
    this.#running = true;

    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    this.#poll();
  }

  stop(): void {
    if (!this.#running) {
      return;
    }
    this.#running = false;

    if (this.#pollTimer != null) {
      clearTimeout(this.#pollTimer);
      this.#pollTimer = null;
    }
  }

  pause(dropWhilePaused?: boolean): void {
    this.stop();
    if (isDefined(dropWhilePaused) && dropWhilePaused) {
      this.#blockNumber = -2;
    }
  }

  resume(): void {
    this.start();
  }
}
