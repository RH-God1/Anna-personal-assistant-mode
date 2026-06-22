import { mockDb, createId, nowIso } from "../store/mock-db.js";
import type { AuditLogEntry } from "../models/types.js";

export function auditLog(entry: Omit<AuditLogEntry, "id" | "createdAt">): AuditLogEntry {
  const record: AuditLogEntry = {
    id: createId("audit"),
    createdAt: nowIso(),
    ...entry
  };
  mockDb.auditLogs.push(record);
  return record;
}
