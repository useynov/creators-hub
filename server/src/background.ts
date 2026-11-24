// Work that runs after the HTTP answer has gone out: reading a profile, checking a link.
// Calls to Instagram and TikTok through the provider can take a minute, and no request of
// the mini app may wait that long. Every such job is started with `track`, so a failure is
// logged instead of crashing the process, and tests can wait for all of it with `idle`.

const running = new Set<Promise<unknown>>();

export function track(label: string, work: Promise<unknown>): void {
  const guarded = work
    .catch((error: unknown) => console.error(`[background] ${label} failed:`, (error as Error).message ?? error))
    .finally(() => running.delete(guarded));
  running.add(guarded);
}

/** Resolves once every tracked job (including jobs started by them) has finished. */
export async function idle(): Promise<void> {
  while (running.size) await Promise.allSettled([...running]);
}

/** Rejects after `ms`. The provider's own timeouts are longer than we want to wait anywhere. */
export function withTimeout<T>(work: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${Math.round(ms / 1000)} s`)), ms);
    timer.unref?.();
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}
