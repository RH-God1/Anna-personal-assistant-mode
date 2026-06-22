import { createHash, randomUUID } from "node:crypto";
import { mockDb, nowIso } from "../store/mock-db.js";
import { ValidationError } from "../utils/errors.js";

export class IdempotencyService {
  keyFrom(value?: string): string {
    const key = String(value || "").trim();
    return key || `idem_${randomUUID()}`;
  }

  requestHash(value: unknown): string {
    return createHash("sha256")
      .update(JSON.stringify(value ?? null))
      .digest("hex");
  }

  async run<T>(scope: string, key: string, request: unknown, call: () => Promise<T> | T): Promise<T> {
    const requestHash = this.requestHash(request);
    const recordKey = `${scope}:${key}`;
    const existing = mockDb.idempotencyRecords.get(recordKey);
    if (existing) {
      if (existing.requestHash !== requestHash) {
        throw new ValidationError("Idempotency key was reused with a different request body.");
      }
      return existing.response as T;
    }

    const response = await call();
    mockDb.idempotencyRecords.set(recordKey, {
      key,
      scope,
      requestHash,
      response,
      createdAt: nowIso()
    });
    return response;
  }
}
