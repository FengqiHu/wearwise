/**
 * Throttles per-user style summary generation.
 *
 * The first vote after a quiet period opens a fixed `delayMs` window.
 * Any votes that arrive while the window is open are absorbed — no
 * additional Gemini requests are made. When the window closes, exactly
 * one request fires using the latest vote state from the database.
 * The next vote after that opens a new window.
 *
 * This guarantees at most one Gemini call per `delayMs` per user, while
 * still ensuring a request is always made even if the user votes
 * continuously (unlike debounce, which would never fire in that case).
 */
export class StyleSummaryThrottler {
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  readonly delayMs: number;

  constructor(delayMs = 10_000) {
    this.delayMs = delayMs;
  }

  schedule(userId: string, task: () => Promise<void>): void {
    // A window is already open for this user — the pending timer will
    // fire at the end of the window with the latest DB state. Skip.
    if (this.timers.has(userId)) return;

    // No active window: open a new one.
    const timer = setTimeout(() => {
      this.timers.delete(userId);
      task().catch((err) => {
        console.error(`[StyleSummaryThrottler] task failed for user ${userId}:`, err);
      });
    }, this.delayMs);

    this.timers.set(userId, timer);
  }

  /** Cancel all pending timers (e.g. graceful server shutdown). */
  cancelAll(): void {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
  }
}
