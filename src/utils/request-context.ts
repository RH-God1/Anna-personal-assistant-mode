import type { Request } from "express";
import type { RequestContext } from "../models/types.js";

export function getRequestContext(req: Request): RequestContext {
  const userId = String(req.headers["x-user-id"] ?? "local-user");
  const tenantId = String(req.headers["x-tenant-id"] ?? "local-tenant");
  const isAgent = String(req.headers["x-agent"] ?? "false").toLowerCase() === "true";

  return {
    userId,
    tenantId,
    actor: isAgent ? `agent:${userId}` : `user:${userId}`,
    isAgent
  };
}
