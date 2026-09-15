import { WEALTH_RANKING_JOB_TIMEOUT_MS } from '../../config/wealth-ranking-runtime.config.js';
import { wealthRankingFailure } from './wealth-ranking-failure.js';

/** One deadline shared by preparation, the cancellable AI request and saving. */
export class WealthRankingDeadline {
  private readonly controller = new AbortController();
  private readonly timer: ReturnType<typeof setTimeout>;
  readonly signal = this.controller.signal;

  constructor(readonly expiresAt = Date.now() + WEALTH_RANKING_JOB_TIMEOUT_MS) {
    this.timer = setTimeout(
      () => this.controller.abort(),
      Math.max(0, expiresAt - Date.now()),
    );
    this.timer.unref();
  }

  remainingMs(reserveMs = 0) {
    const remaining = this.expiresAt - Date.now() - reserveMs;
    if (this.signal.aborted || remaining <= 0) {
      this.controller.abort();
      throw wealthRankingFailure('pipeline_timeout');
    }
    return remaining;
  }

  async run<T>(work: () => Promise<T>): Promise<T> {
    this.remainingMs();
    let onAbort = () => {};
    const timeout = new Promise<never>((_resolve, reject) => {
      onAbort = () => reject(wealthRankingFailure('pipeline_timeout'));
      this.signal.addEventListener('abort', onAbort, { once: true });
    });
    try {
      // Late DB/KASI resolutions cannot start AI or publish a result: callers
      // check the same deadline at phase boundaries and before transaction commit.
      return await Promise.race([work(), timeout]);
    } finally {
      this.signal.removeEventListener('abort', onAbort);
    }
  }

  dispose() {
    clearTimeout(this.timer);
  }
}
