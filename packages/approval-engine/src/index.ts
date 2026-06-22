import { AnnaError, newId, type ActorContext } from "@anna/shared";

export type ApprovalStatus = "pending" | "approved" | "rejected" | "expired";

export type ApprovalRecord = {
  id: string;
  taskId: string;
  toolId: string;
  reason: string;
  input: unknown;
  status: ApprovalStatus;
  requestedBy: ActorContext;
  decidedBy?: ActorContext;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
};

export class InMemoryApprovalStore {
  private readonly records = new Map<string, ApprovalRecord>();

  create(input: {
    taskId: string;
    toolId: string;
    reason: string;
    toolInput: unknown;
    requestedBy: ActorContext;
    ttlMs?: number;
  }): ApprovalRecord {
    const now = new Date();
    const record: ApprovalRecord = {
      id: newId("approval"),
      taskId: input.taskId,
      toolId: input.toolId,
      reason: input.reason,
      input: input.toolInput,
      status: "pending",
      requestedBy: input.requestedBy,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + (input.ttlMs ?? 15 * 60 * 1000)).toISOString()
    };
    this.records.set(record.id, record);
    return record;
  }

  get(id: string): ApprovalRecord {
    const record = this.records.get(id);
    if (!record) {
      throw new AnnaError("APPROVAL_NOT_FOUND", "Approval request was not found.", 404);
    }
    if (record.status === "pending" && Date.parse(record.expiresAt) < Date.now()) {
      record.status = "expired";
      record.updatedAt = new Date().toISOString();
    }
    return record;
  }

  approve(id: string, actor: ActorContext): ApprovalRecord {
    return this.decide(id, "approved", actor);
  }

  reject(id: string, actor: ActorContext): ApprovalRecord {
    return this.decide(id, "rejected", actor);
  }

  list(): ApprovalRecord[] {
    return Array.from(this.records.values()).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  private decide(id: string, status: "approved" | "rejected", actor: ActorContext): ApprovalRecord {
    const record = this.get(id);
    if (record.status !== "pending") {
      throw new AnnaError("APPROVAL_NOT_PENDING", `Approval is ${record.status}.`, 409);
    }
    record.status = status;
    record.decidedBy = actor;
    record.updatedAt = new Date().toISOString();
    return record;
  }
}
