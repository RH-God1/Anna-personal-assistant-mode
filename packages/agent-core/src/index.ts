import { InMemoryApprovalStore, type ApprovalRecord } from "@anna/approval-engine";
import { AuditLogger } from "@anna/audit-logger";
import { PolicyEngine } from "@anna/policy-engine";
import { AnnaError, newId, type ActorContext, type TaskRecord, type ToolCallRequest } from "@anna/shared";
import { ToolRegistry, type ToolDefinition } from "@anna/tool-registry";

export type CreateTaskResult = {
  task: TaskRecord;
  approval?: ApprovalRecord;
};

export class AgentRuntime {
  private readonly tasks = new Map<string, TaskRecord>();

  constructor(
    private readonly registry: ToolRegistry,
    private readonly policyEngine: PolicyEngine,
    private readonly approvals: InMemoryApprovalStore,
    private readonly audit: AuditLogger
  ) {}

  async createTask(request: ToolCallRequest, actor: ActorContext): Promise<CreateTaskResult> {
    const tool = this.registry.get(request.toolId);
    const parsedInput = this.registry.parseInput(tool, request.input);
    const task = this.createTaskRecord(tool.id, parsedInput, actor);

    await this.audit.record({
      type: "task.created",
      actor,
      taskId: task.id,
      toolId: tool.id,
      riskLevel: tool.riskLevel,
      input: parsedInput
    });

    const decision = this.policyEngine.evaluate({
      actor,
      input: parsedInput,
      tool: {
        id: tool.id,
        riskLevel: tool.riskLevel,
        description: tool.description,
        capabilities: tool.capabilities
      }
    });

    await this.audit.record({
      type: "policy.evaluated",
      actor,
      taskId: task.id,
      toolId: tool.id,
      riskLevel: tool.riskLevel,
      policyEffect: decision.effect,
      metadata: { reason: decision.reason, code: "code" in decision ? decision.code : undefined }
    });

    if (decision.effect === "deny") {
      task.status = "denied";
      task.error = decision.reason;
      task.updatedAt = new Date().toISOString();
      return { task };
    }

    if (decision.effect === "requires_approval") {
      const approval = this.approvals.create({
        taskId: task.id,
        toolId: tool.id,
        reason: decision.reason,
        toolInput: parsedInput,
        requestedBy: actor
      });
      task.status = "waiting_approval";
      task.approvalId = approval.id;
      task.updatedAt = new Date().toISOString();
      await this.audit.record({
        type: "approval.requested",
        actor,
        taskId: task.id,
        approvalId: approval.id,
        toolId: tool.id,
        riskLevel: tool.riskLevel,
        input: parsedInput,
        metadata: { reason: decision.reason }
      });
      return { task, approval };
    }

    await this.executeTask(task, tool, parsedInput, actor);
    return { task };
  }

  async approveAndRun(approvalId: string, actor: ActorContext): Promise<CreateTaskResult> {
    const approval = this.approvals.approve(approvalId, actor);
    await this.audit.record({
      type: "approval.approved",
      actor,
      taskId: approval.taskId,
      approvalId: approval.id,
      toolId: approval.toolId
    });

    const task = this.getTask(approval.taskId);
    const tool = this.registry.get(task.toolId);
    await this.executeTask(task, tool, task.input, actor);
    return { task, approval };
  }

  async rejectApproval(approvalId: string, actor: ActorContext): Promise<CreateTaskResult> {
    const approval = this.approvals.reject(approvalId, actor);
    const task = this.getTask(approval.taskId);
    task.status = "rejected";
    task.updatedAt = new Date().toISOString();
    await this.audit.record({
      type: "approval.rejected",
      actor,
      taskId: task.id,
      approvalId,
      toolId: task.toolId
    });
    return { task, approval };
  }

  getTask(taskId: string): TaskRecord {
    const task = this.tasks.get(taskId);
    if (!task) {
      throw new AnnaError("TASK_NOT_FOUND", "Task was not found.", 404);
    }
    return task;
  }

  listTasks(): TaskRecord[] {
    return Array.from(this.tasks.values()).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  listApprovals(): ApprovalRecord[] {
    return this.approvals.list();
  }

  listTools() {
    return this.registry.list();
  }

  async listAudit(limit?: number) {
    return this.audit.list(limit);
  }

  private createTaskRecord(toolId: string, input: unknown, actor: ActorContext): TaskRecord {
    const now = new Date().toISOString();
    const task: TaskRecord = {
      id: newId("task"),
      toolId,
      input,
      status: "queued",
      actor,
      createdAt: now,
      updatedAt: now
    };
    this.tasks.set(task.id, task);
    return task;
  }

  private async executeTask(task: TaskRecord, tool: ToolDefinition, input: unknown, actor: ActorContext): Promise<void> {
    task.status = "running";
    task.updatedAt = new Date().toISOString();
    await this.audit.record({
      type: "tool.started",
      actor,
      taskId: task.id,
      toolId: tool.id,
      riskLevel: tool.riskLevel,
      input
    });

    try {
      const result = await tool.handler(input as never, { actor, taskId: task.id });
      task.status = "succeeded";
      task.result = result;
      task.updatedAt = new Date().toISOString();
      await this.audit.record({
        type: "tool.succeeded",
        actor,
        taskId: task.id,
        toolId: tool.id,
        riskLevel: tool.riskLevel,
        output: result
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Tool failed.";
      task.status = "failed";
      task.error = message;
      task.updatedAt = new Date().toISOString();
      await this.audit.record({
        type: "tool.failed",
        actor,
        taskId: task.id,
        toolId: tool.id,
        riskLevel: tool.riskLevel,
        error: message
      });
    }
  }
}
