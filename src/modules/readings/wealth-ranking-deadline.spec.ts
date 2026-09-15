import { GatewayTimeoutException } from '@nestjs/common';
import { WealthRankingDeadline } from './wealth-ranking-deadline.js';

describe('Wealth ranking shared deadline', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('counts elapsed preparation/queue time and aborts unfinished work at 300 seconds', async () => {
    const deadline = new WealthRankingDeadline(Date.now() + 300_000);
    await vi.advanceTimersByTimeAsync(40_000);
    expect(deadline.remainingMs(5000)).toBe(255_000);
    const operation = deadline
      .run(() => new Promise<never>(() => {}))
      .catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(259_999);
    expect(deadline.signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await operation).toBeInstanceOf(GatewayTimeoutException);
    expect(deadline.signal.aborted).toBe(true);
    expect(() => deadline.remainingMs()).toThrow(GatewayTimeoutException);
    deadline.dispose();
  });

  it('does not begin work after expiry and cleans up the timer on success', async () => {
    const expired = new WealthRankingDeadline(Date.now() - 1);
    const work = vi.fn();
    await expect(expired.run(work)).rejects.toBeInstanceOf(
      GatewayTimeoutException,
    );
    expect(work).not.toHaveBeenCalled();
    expired.dispose();
    const active = new WealthRankingDeadline();
    expect(await active.run(async () => 'done')).toBe('done');
    active.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });
});
