import crypto from "node:crypto";
import type { CachedProviderResponse, ProviderKey } from "../models/types.js";
import { mockDb, nowIso } from "../store/mock-db.js";

export class ProviderCacheService {
  constructor(private readonly ttlMs = Number(process.env.SEARCH_CACHE_TTL_MS ?? 5 * 60 * 1000)) {}

  requestHash(input: unknown): string {
    return crypto.createHash("sha256").update(stableStringify(input)).digest("hex");
  }

  get<T>(provider: ProviderKey, endpoint: string, requestHash: string): T | null {
    const key = this.key(provider, endpoint, requestHash);
    const cached = mockDb.providerResponseCache.get(key);
    if (!cached) {
      return null;
    }
    if (Date.parse(cached.expiresAt) <= Date.now()) {
      mockDb.providerResponseCache.delete(key);
      return null;
    }
    return cached.value as T;
  }

  set<T>(provider: ProviderKey, endpoint: string, requestHash: string, value: T): CachedProviderResponse<T> {
    const key = this.key(provider, endpoint, requestHash);
    const record: CachedProviderResponse<T> = {
      key,
      provider,
      endpoint,
      requestHash,
      value,
      createdAt: nowIso(),
      expiresAt: new Date(Date.now() + this.ttlMs).toISOString()
    };
    mockDb.providerResponseCache.set(key, record);
    return record;
  }

  private key(provider: ProviderKey, endpoint: string, requestHash: string) {
    return `${provider}:${endpoint}:${requestHash}`;
  }
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${stableStringify(child)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
