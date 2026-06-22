import { Router } from "express";
import type { ProviderCredentialController } from "../controllers/provider-credential.controller.js";
import { denyAgentMiddleware } from "../middleware/deny-agent.middleware.js";
import { asyncRoute } from "../utils/async-route.js";

export function createProviderCredentialRouter(controller: ProviderCredentialController): Router {
  const router = Router();

  router.use(denyAgentMiddleware);
  router.post("/", asyncRoute(controller.create));
  router.get("/", asyncRoute(controller.list));
  router.delete("/:id", asyncRoute(controller.delete));
  router.post("/:id/rotate", asyncRoute(controller.rotate));

  return router;
}
