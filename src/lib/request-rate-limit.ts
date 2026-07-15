type RateLimitResult = {
  readonly allowed: boolean;
  readonly retryAfterSeconds: number;
};

export async function consumeRateLimit(
  key: string,
  maxRequests: number = 8,
  windowMs: number = 60_000,
): Promise<RateLimitResult> {
  const windowSeconds = Math.ceil(windowMs / 1000);
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey =
    process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error("Supabase server key is not configured.");
  }

  const response = await fetch(`${url}/rest/v1/rpc/consume_extract_quota`, {
    method: "POST",
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      p_subject: key,
      p_limit: maxRequests,
      p_window_seconds: windowSeconds,
    }),
  });
  if (!response.ok) {
    throw new Error(`Extraction quota request failed: ${response.status}`);
  }

  const requestCount = Number(await response.json());
  if (!Number.isSafeInteger(requestCount) || requestCount < 1) {
    throw new Error("Extraction quota response is invalid.");
  }
  return {
    allowed: requestCount <= maxRequests,
    retryAfterSeconds: requestCount <= maxRequests ? 0 : windowSeconds,
  };
}
