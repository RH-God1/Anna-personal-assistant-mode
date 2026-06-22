import { Router } from "express";
import type { PaymentController } from "../controllers/payment.controller.js";
import { requireUserConfirmationMiddleware } from "../middleware/require-user-confirmation.middleware.js";
import { asyncRoute } from "../utils/async-route.js";

export function createPaymentRouter(controller: PaymentController): Router {
  const router = Router();

  router.post("/setup-intent", asyncRoute(controller.createSetupIntent));
  router.post("/confirm", requireUserConfirmationMiddleware, asyncRoute(controller.confirm));
  router.post("/refund", asyncRoute(controller.refund));
  router.get("/status/:paymentId", asyncRoute(controller.status));

  return router;
}
