import { InvalidResponseDataError, RetryError } from 'ai';

const DELAYS_MS = [2_000, 5_000, 10_000];

/**
 * Errors worth another try on top of the SDK's own retries: gateway outages
 * that exhausted the SDK retries, and answers the SDK rejected as inconsistent
 * (e.g. Jev picking a choice that isn't its highest-probability option).
 */
function retryable(error: unknown): boolean {
  return RetryError.isInstance(error) || InvalidResponseDataError.isInstance(error);
}

/** Runs `call`, retrying retryable errors with backoff. Failed attempts are listed in `errors`. */
export async function withRetries<T>(call: () => Promise<T>): Promise<{ value: T; errors: string[] }> {
  const errors: string[] = [];
  for (let attempt = 0; ; attempt++) {
    try {
      return { value: await call(), errors };
    } catch (error) {
      if (!retryable(error) || attempt >= DELAYS_MS.length) throw error;
      errors.push(error instanceof Error ? error.message : String(error));
      await new Promise((resolve) => setTimeout(resolve, DELAYS_MS[attempt]));
    }
  }
}
