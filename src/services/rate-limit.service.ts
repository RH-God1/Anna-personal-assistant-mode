import type { ProviderKey, RequestContext } from "../models/types.js";
import { mockDb } from "../store/mock-db.js";
import { RateLimitError } from "../utils/errors.js";

interface BucketPolicy {
  capacity: number;
  refillPerSecond: number;
}

export class InMemoryTokenBucketRateLimiter {
  private readonly policies = {
    user: { capacity: Number(process.env.RATE_LIMIT_USER_CAPACITY ?? 60), refillPerSecond: Number(process.env.RATE_LIMIT_USER_REFILL_PER_SECOND ?? 1) },
    tenant: { capacity: Number(process.env.RATE_LIMIT_TENANT_CAPACITY ?? 300), refillPerSecond: Number(process.env.RATE_LIMIT_TENANT_REFILL_PER_SECOND ?? 5) },
    provider: { capacity: Number(process.env.RATE_LIMIT_PROVIDER_CAPACITY ?? 500), refillPerSecond: Number(process.env.RATE_LIMIT_PROVIDER_REFILL_PER_SECOND ?? 8) }
  };

  assertAllowed(context: RequestContext, provider: ProviderKey, costUnits = 1) {
    this.consume(`user:${context.userId}`, this.policies.user, costUnits, "User-level rate limit exceeded");
    this.consume(`tenant:${context.tenantId}`, this.policies.tenant, costUnits, "Tenant-level rate limit exceeded");
    this.consume(`provider:${provider}`, this.policies.provider, costUnits, "Provider-level rate limit exceeded");
  }

  private consume(key: string, policy: BucketPolicy, tokens: number, message: string) {
    const now = Date.now();
    const bucket = mockDb.rateLimitBuckets.get(key) ?? { tokens: policy.capacity, updatedAtMs: now };
    const elapsedSeconds = Math.max(0, (now - bucket.updatedAtMs) / 1000);
    bucket.tokens = Math.min(policy.capacity, bucket.tokens + elapsedSeconds * policy.refillPerSecond);
    bucket.updatedAtMs = now;

    if (bucket.tokens < tokens) {
      mockDb.rateLimitBuckets.set(key, bucket);
      throw new RateLimitError(message);
    }

    bucket.tokens -= tokens;
    mockDb.rateLimitBuckets.set(key, bucket);
  }
}
