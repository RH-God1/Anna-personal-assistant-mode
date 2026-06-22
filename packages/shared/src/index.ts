import { randomBytes } from "node:crypto";
import { z } from "zod";

export const riskLevelSchema = z.enum(["low", "medium", "high", "critical"]);
export type RiskLevel = z.infer<typeof riskLevelSchema>;

export const actorContextSchema = z.object({
  userId: z.string().min(1),
  sessionId: z.string().min(1).optional(),
  client: z.string().min(1).default("api"),
  ipAddress: z.string().optional()
});
export type ActorContext = z.infer<typeof actorContextSchema>;

export const toolCallRequestSchema = z.object({
  toolId: z.string().min(1),
  input: z.unknown().default({}),
  idempotencyKey: z.string().optional()
});
export type ToolCallRequest = z.infer<typeof toolCallRequestSchema>;

export const taskStatusSchema = z.enum(["queued", "waiting_approval", "running", "succeeded", "failed", "denied", "rejected"]);
export type TaskStatus = z.infer<typeof taskStatusSchema>;

export type TaskRecord = {
  id: string;
  toolId: string;
  input: unknown;
  status: TaskStatus;
  createdAt: string;
  updatedAt: string;
  actor: ActorContext;
  approvalId?: string;
  result?: unknown;
  error?: string;
};

export type PolicyDecision =
  | {
      effect: "allow";
      reason: string;
    }
  | {
      effect: "requires_approval";
      reason: string;
    }
  | {
      effect: "deny";
      reason: string;
      code: string;
    };

export class AnnaError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode = 400
  ) {
    super(message);
  }
}

export function newId(prefix: string): string {
  const suffix = randomBytes(12).toString("hex");
  return `${prefix}_${suffix}`;
}
