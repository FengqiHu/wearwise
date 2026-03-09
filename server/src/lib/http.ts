interface FetchTimeoutOptions extends RequestInit {
  timeoutMs?: number;
}

export async function fetchWithTimeout(url: string, options: FetchTimeoutOptions = {}): Promise<globalThis.Response> {
  const { timeoutMs = 10000, signal, ...requestInit } = options;
  const controller = new AbortController();

  const timeoutId = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  const abortHandler = () => {
    controller.abort();
  };

  if (signal) {
    signal.addEventListener("abort", abortHandler, { once: true });
  }

  try {
    return await fetch(url, {
      ...requestInit,
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeoutId);

    if (signal) {
      signal.removeEventListener("abort", abortHandler);
    }
  }
}
