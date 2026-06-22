import { Router } from "express";
import type { UsageController } from "../controllers/usage.controller.js";
import { denyAgentMiddleware } from "../middleware/deny-agent.middleware.js";
import { asyncRoute } from "../utils/async-route.js";

export function createUsageRouter(controller: UsageController): Router {
  const router = Router();

  router.use(denyAgentMiddleware);
  router.get("/me", asyncRoute(controller.me));
  router.get("/tenant", asyncRoute(controller.tenant));

  return router;
}
