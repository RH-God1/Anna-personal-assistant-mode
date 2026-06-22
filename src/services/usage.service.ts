import type { ProviderKey, RequestContext, UsageRecord } from "../models/types.js";
import { createId, mockDb, nowIso } from "../store/mock-db.js";
import { auditLog } from "../utils/audit-log.js";
import { RateLimitError } from "../utils/errors.js";

export class UsageService {
  private readonly userQuota = Number(process.env.USAGE_USER_DAILY_QUOTA ?? 1000);
  private readonly tenantQuota = Number(process.env.USAGE_TENANT_DAILY_QUOTA ?? 10000);

  assertQuota(context: RequestContext, estimatedCostUnit: number) {
    const since = Date.now() - 24 * 60 * 60 * 1000;
    const userUsed = this.sumUsage((record) => record.userId === context.userId && Date.parse(record.createdAt) >= since);
    const tenantUsed = this.sumUsage((record) => record.tenantId === context.tenantId && Date.parse(record.createdAt) >= since);
    if (userUsed + estimatedCostUnit > this.userQuota) {
      throw new RateLimitError("User plan quota exceeded", "BILLING_REQUIRED");
    }
    if (tenantUsed + estimatedCostUnit > this.tenantQuota) {
      throw new RateLimitError("Tenant plan quota exceeded", "BILLING_REQUIRED");
    }
  }

  record(input: {
    context: RequestContext;
    provider: ProviderKey;
    endpoint: string;
    requestHash: string;
    cacheHit: boolean;
    estimatedCostUnit: number;
  }): UsageRecord {
    const record: UsageRecord = {
      id: createId("usage"),
      userId: input.context.userId,
      tenantId: input.context.tenantId,
      provider: input.provider,
      endpoint: input.endpoint,
      requestHash: input.requestHash,
      cacheHit: input.cacheHit,
      estimatedCostUnit: input.estimatedCostUnit,
      createdAt: nowIso()
    };
    mockDb.usageRecords.push(record);
    auditLog({
      action: "provider_usage.record",
      actor: "backend",
      targetId: record.id,
      metadata: {
        provider: record.provider,
        endpoint: record.endpoint,
        cacheHit: record.cacheHit,
        estimatedCostUnit: record.estimatedCostUnit
      }
    });
    return record;
  }

  getUserUsage(userId: string) {
    return this.summarize(mockDb.usageRecords.filter((record) => record.userId === userId));
  }

  getTenantUsage(tenantId: string) {
    return this.summarize(mockDb.usageRecords.filter((record) => record.tenantId === tenantId));
  }

  private summarize(records: UsageRecord[]) {
    const totalCostUnit = records.reduce((sum, record) => sum + record.estimatedCostUnit, 0);
    const byProvider: Record<string, number> = {};
    for (const record of records) {
      byProvider[record.provider] = (byProvider[record.provider] ?? 0) + record.estimatedCostUnit;
    }
    return {
      totalCalls: records.length,
      totalCostUnit,
      cacheHits: records.filter((record) => record.cacheHit).length,
      byProvider,
      records
    };
  }

  private sumUsage(predicate: (record: UsageRecord) => boolean) {
    return mockDb.usageRecords.filter(predicate).reduce((sum, record) => sum + record.estimatedCostUnit, 0);
  }
}
