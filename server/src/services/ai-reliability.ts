export const AI_SERVICE_UNAVAILABLE_MESSAGE =
  "AI service is temporarily unavailable. Please try again later.";

export class AiServiceUnavailableError extends Error {
  readonly cause: unknown;

  constructor(message = AI_SERVICE_UNAVAILABLE_MESSAGE, cause?: unknown) {
    super(message);
    this.name = "AiServiceUnavailableError";
    this.cause = cause;
  }
}

export interface AiReliabilityOptions {
  timeoutMs?: number;
  maxRetries?: number;
  retryDelayMs?: number;
}

export const DEFAULT_AI_RELIABILITY_OPTIONS = {
  timeoutMs: 180_000,
  maxRetries: 1,
  retryDelayMs: 250
} as const;

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function isRetryableAiError(error: unknown): boolean {
  if (error instanceof AiServiceUnavailableError) {
    return true;
  }

  const message = getErrorMessage(error).toLowerCase();
  return (
    message.includes("timeout") ||
    message.includes("timed out") ||
    message.includes("abort") ||
    message.includes("rate limit") ||
    message.includes("429") ||
    message.includes("quota") ||
    message.includes("unavailable") ||
    message.includes("temporarily") ||
    message.includes("503") ||
    message.includes("502") ||
    message.includes("500")
  );
}

export async function delay(ms: number): Promise<void> {
  if (ms <= 0) {
    return;
  }

  await new Promise<void>((resolve) => setTimeout(resolve, ms));
}

export async function withTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number,
  operationName: string
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeoutId = setTimeout(() => {
      reject(new AiServiceUnavailableError(
        AI_SERVICE_UNAVAILABLE_MESSAGE,
        new Error(`${operationName} timed out after ${timeoutMs}ms.`)
      ));
    }, timeoutMs);
  });

  try {
    return await Promise.race([operation, timeoutPromise]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

export async function withAiReliability<T>(
  operationName: string,
  operation: () => Promise<T>,
  options: AiReliabilityOptions = {}
): Promise<T> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_AI_RELIABILITY_OPTIONS.timeoutMs;
  const maxRetries = options.maxRetries ?? DEFAULT_AI_RELIABILITY_OPTIONS.maxRetries;
  const retryDelayMs = options.retryDelayMs ?? DEFAULT_AI_RELIABILITY_OPTIONS.retryDelayMs;
  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      return await withTimeout(operation(), timeoutMs, operationName);
    } catch (error) {
      lastError = error;

      if (attempt >= maxRetries || !isRetryableAiError(error)) {
        break;
      }

      await delay(retryDelayMs);
    }
  }

  throw new AiServiceUnavailableError(AI_SERVICE_UNAVAILABLE_MESSAGE, lastError);
}
