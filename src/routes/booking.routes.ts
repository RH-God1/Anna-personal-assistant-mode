import { Router } from "express";
import type { BookingController } from "../controllers/booking.controller.js";
import { requireUserConfirmationMiddleware } from "../middleware/require-user-confirmation.middleware.js";
import { asyncRoute } from "../utils/async-route.js";

export function createBookingRouter(controller: BookingController): Router {
  const router = Router();

  router.post("/prepare", asyncRoute(controller.prepare));
  router.post("/confirm", requireUserConfirmationMiddleware, asyncRoute(controller.confirm));
  router.get("/:bookingId", asyncRoute(controller.get));
  router.post("/cancel", asyncRoute(controller.cancel));

  return router;
}
