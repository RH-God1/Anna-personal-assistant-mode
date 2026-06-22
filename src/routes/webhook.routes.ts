import { Router } from "express";
import { auditLog } from "../utils/audit-log.js";

export function createWebhookRouter(): Router {
  const router = Router();

  router.post("/stripe", (req, res) => {
    auditLog({
      action: "webhook.stripe.received",
      actor: "stripe",
      metadata: { eventType: String(req.body?.type ?? "unknown") }
    });
    res.json({ received: true });
  });

  router.post("/cybersource", (req, res) => {
    auditLog({
      action: "webhook.cybersource.received",
      actor: "cybersource",
      metadata: { eventType: String(req.body?.eventType ?? "unknown") }
    });
    res.json({ received: true });
  });

  router.post("/travel-provider", (req, res) => {
    auditLog({
      action: "webhook.travel_provider.received",
      actor: "travel-provider",
      metadata: { provider: String(req.body?.provider ?? "unknown") }
    });
    res.json({ received: true });
  });

  return router;
}
