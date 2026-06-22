import { Pool } from "pg";
import { z } from "zod";
import { newId, type ActorContext } from "@anna/shared";

export const auditEventSchema = z.object({
  id: z.string(),
  type: z.string().min(1),
  actor: z.unknown(),
  toolId: z.string().optional(),
  taskId: z.string().optional(),
  approvalId: z.string().optional(),
  riskLevel: z.string().optional(),
  policyEffect: z.string().optional(),
  input: z.unknown().optional(),
  output: z.unknown().optional(),
  error: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
  createdAt: z.string()
});

export type AuditEvent = z.infer<typeof auditEventSchema>;

export type AuditSink = {
  append(event: AuditEvent): Promise<void>;
  list?(limit?: number): Promise<AuditEvent[]>;
};

export class MemoryAuditSink implements AuditSink {
  private readonly events: AuditEvent[] = [];

  async append(event: AuditEvent): Promise<void> {
    this.events.unshift(event);
  }

  async list(limit = 100): Promise<AuditEvent[]> {
    return this.events.slice(0, limit);
  }
}

export class PostgresAuditSink implements AuditSink {
  private readonly pool: Pool;

  constructor(connectionString: string) {
    this.pool = new Pool({ connectionString });
  }

  async append(event: AuditEvent): Promise<void> {
    await this.pool.query(
      `insert into audit_logs
        (id, type, actor, tool_id, task_id, approval_id, risk_level, policy_effect, input, output, error, metadata, created_at)
       values
        ($1, $2, $3::jsonb, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb, $11, $12::jsonb, $13)`,
      [
        event.id,
        event.type,
        JSON.stringify(event.actor),
        event.toolId ?? null,
        event.taskId ?? null,
        event.approvalId ?? null,
        event.riskLevel ?? null,
        event.policyEffect ?? null,
        JSON.stringify(event.input ?? null),
        JSON.stringify(event.output ?? null),
        event.error ?? null,
        JSON.stringify(event.metadata ?? {}),
        event.createdAt
      ]
    );
  }
}

export class AuditLogger {
  constructor(private readonly sink: AuditSink) {}

  async record(event: Omit<AuditEvent, "id" | "createdAt"> & { actor: ActorContext | Record<string, unknown> }): Promise<AuditEvent> {
    const fullEvent = auditEventSchema.parse({
      id: newId("audit"),
      createdAt: new Date().toISOString(),
      ...event
    });
    await this.sink.append(fullEvent);
    return fullEvent;
  }

  async list(limit?: number): Promise<AuditEvent[]> {
    if (!this.sink.list) {
      return [];
    }
    return this.sink.list(limit);
  }
}

export function createAuditLoggerFromEnv(env: NodeJS.ProcessEnv): AuditLogger {
  if (env.DATABASE_URL) {
    return new AuditLogger(new PostgresAuditSink(env.DATABASE_URL));
  }
  return new AuditLogger(new MemoryAuditSink());
}
