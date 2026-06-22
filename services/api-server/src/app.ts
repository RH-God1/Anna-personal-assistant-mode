import "dotenv/config";
import express, { type NextFunction, type Request, type Response } from "express";
import { ZodError, z } from "zod";
import { AnnaError, actorContextSchema, toolCallRequestSchema, type ActorContext } from "@anna/shared";
import { createRuntime } from "./runtime.js";

const runtime = createRuntime();

const approvalDecisionSchema = z.object({
  reason: z.string().max(1000).optional()
});

const listQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(500).default(100)
});

export function createApp() {
  const app = express();
  app.use(express.json({ limit: "1mb" }));

  app.get("/health", (_req, res) => {
    res.json({
      status: "ok",
      service: "anna-controlled-api",
      policy: "registered-tools-only",
      payments: "disabled"
    });
  });

  app.get("/v1/tools", (_req, res) => {
    res.json({ data: runtime.listTools() });
  });

  app.get("/v1/tasks", (_req, res) => {
    res.json({ data: runtime.listTasks() });
  });

  app.get("/v1/tasks/:taskId", (req, res) => {
    res.json({ data: runtime.getTask(req.params.taskId) });
  });

  app.post("/v1/tasks", async (req, res, next) => {
    try {
      const actor = actorFromRequest(req);
      const body = toolCallRequestSchema.parse(req.body);
      const result = await runtime.createTask(body, actor);
      const status = result.task.status === "waiting_approval" ? 202 : 201;
      res.status(status).json({ data: result });
    } catch (error) {
      next(error);
    }
  });

  app.get("/v1/approvals", (_req, res) => {
    res.json({ data: runtime.listApprovals() });
  });

  app.post("/v1/approvals/:approvalId/confirm", async (req, res, next) => {
    try {
      approvalDecisionSchema.parse(req.body ?? {});
      const result = await runtime.approveAndRun(req.params.approvalId, actorFromRequest(req));
      res.json({ data: result });
    } catch (error) {
      next(error);
    }
  });

  app.post("/v1/approvals/:approvalId/reject", async (req, res, next) => {
    try {
      approvalDecisionSchema.parse(req.body ?? {});
      const result = await runtime.rejectApproval(req.params.approvalId, actorFromRequest(req));
      res.json({ data: result });
    } catch (error) {
      next(error);
    }
  });

  app.get("/v1/audit-logs", async (req, res, next) => {
    try {
      const query = listQuerySchema.parse(req.query);
      res.json({ data: await runtime.listAudit(query.limit) });
    } catch (error) {
      next(error);
    }
  });

  app.use((_req, _res, next) => {
    next(new AnnaError("ROUTE_NOT_FOUND", "Route not found.", 404));
  });

  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (error instanceof ZodError) {
      res.status(400).json({
        error: {
          code: "VALIDATION_ERROR",
          message: "Request validation failed.",
          details: error.flatten()
        }
      });
      return;
    }

    if (error instanceof AnnaError) {
      res.status(error.statusCode).json({ error: { code: error.code, message: error.message } });
      return;
    }

    const message = error instanceof Error ? error.message : "Unexpected error.";
    res.status(500).json({ error: { code: "INTERNAL_ERROR", message } });
  });

  return app;
}

function actorFromRequest(req: Request): ActorContext {
  return actorContextSchema.parse({
    userId: req.header("x-user-id") ?? "local-user",
    sessionId: req.header("x-session-id") ?? undefined,
    client: req.header("x-client") ?? "api",
    ipAddress: req.ip
  });
}
