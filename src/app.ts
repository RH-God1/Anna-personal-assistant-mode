import "dotenv/config";
import express, { type NextFunction, type Request, type Response } from "express";
import { ZodError } from "zod";
import { BookingController } from "./controllers/booking.controller.js";
import { PaymentController } from "./controllers/payment.controller.js";
import { ProviderCredentialController } from "./controllers/provider-credential.controller.js";
import { TravelController } from "./controllers/travel.controller.js";
import { UsageController } from "./controllers/usage.controller.js";
import { authMiddleware } from "./middleware/auth.middleware.js";
import { sensitiveFieldsMiddleware } from "./middleware/sensitive-fields.middleware.js";
import { createBookingRouter } from "./routes/booking.routes.js";
import { createPaymentRouter } from "./routes/payment.routes.js";
import { createProviderCredentialRouter } from "./routes/provider-credential.routes.js";
import { createTravelRouter } from "./routes/travel.routes.js";
import { createUsageRouter } from "./routes/usage.routes.js";
import { createWebhookRouter } from "./routes/webhook.routes.js";
import { BookingService } from "./services/booking.service.js";
import { CredentialResolver } from "./services/credential-resolver.service.js";
import { LocalEnvelopeEncryptionService } from "./services/envelope-encryption.service.js";
import { PaymentService } from "./services/payment.service.js";
import { ProviderCacheService } from "./services/provider-cache.service.js";
import { ProviderCredentialService } from "./services/provider-credential.service.js";
import { InMemoryTokenBucketRateLimiter } from "./services/rate-limit.service.js";
import { TravelOrchestrator } from "./services/travel-orchestrator.service.js";
import { UsageService } from "./services/usage.service.js";
import { mockDb } from "./store/mock-db.js";
import { AppError, SupplierResponseError } from "./utils/errors.js";

export function createApp() {
  const app = express();
  const encryptionService = new LocalEnvelopeEncryptionService();
  const credentialService = new ProviderCredentialService(encryptionService);
  seedLocalPlatformCredentials(credentialService);
  const credentialResolver = new CredentialResolver(credentialService);
  const usageService = new UsageService();
  const rateLimiter = new InMemoryTokenBucketRateLimiter();
  const providerCache = new ProviderCacheService();
  const travelOrchestrator = new TravelOrchestrator(
    undefined,
    undefined,
    credentialResolver,
    rateLimiter,
    usageService,
    providerCache
  );
  const bookingService = new BookingService(travelOrchestrator);
  const paymentService = new PaymentService(bookingService, undefined, credentialResolver, rateLimiter, usageService, providerCache);

  app.use(express.json({ limit: "1mb" }));
  app.use(authMiddleware);
  app.use(sensitiveFieldsMiddleware);

  app.get("/health", (_req, res) => {
    res.json({ status: "ok", providerMode: process.env.PROVIDER_MODE ?? "mock" });
  });

  app.get("/api/audit-log", (_req, res) => {
    res.json({ data: mockDb.auditLogs });
  });

  app.use("/api/travel", createTravelRouter(new TravelController(travelOrchestrator, bookingService)));
  app.use("/api/booking", createBookingRouter(new BookingController(bookingService)));
  app.use("/api/payment", createPaymentRouter(new PaymentController(paymentService)));
  app.use("/api/provider-credentials", createProviderCredentialRouter(new ProviderCredentialController(credentialService)));
  app.use("/api/usage", createUsageRouter(new UsageController(usageService)));
  app.use("/api/webhooks", createWebhookRouter());

  app.use((_req, _res, next) => {
    next(new AppError(404, "Route not found", "ROUTE_NOT_FOUND"));
  });

  app.use((error: unknown, req: Request, res: Response, _next: NextFunction) => {
    const idempotencyKey = requestIdempotencyKey(req);
    if (error instanceof ZodError) {
      res.status(400).json({
        error: {
          code: "VALIDATION_ERROR",
          message: "Request validation failed",
          ...(idempotencyKey ? { idempotencyKey } : {}),
          details: error.flatten()
        }
      });
      return;
    }

    if (error instanceof AppError) {
      res.status(error.statusCode).json({
        error: {
          code: error.code,
          message: error.message,
          ...(idempotencyKey ? { idempotencyKey } : {}),
          ...(error instanceof SupplierResponseError ? { resultCode: error.supplierResultCode, supplier: "duffel" } : {})
        }
      });
      return;
    }

    const message = error instanceof Error ? error.message : "Unexpected error";
    res.status(500).json({ error: { code: "INTERNAL_ERROR", message, ...(idempotencyKey ? { idempotencyKey } : {}) } });
  });

  return app;
}

function requestIdempotencyKey(req: Request): string | undefined {
  const header = req.header("Idempotency-Key") ?? req.header("X-Idempotency-Key");
  const bodyKey = typeof req.body?.idempotencyKey === "string" ? req.body.idempotencyKey : undefined;
  const key = String(header ?? bodyKey ?? "").trim();
  return key || undefined;
}

function seedLocalPlatformCredentials(credentialService: ProviderCredentialService) {
  if ((process.env.PROVIDER_MODE ?? "mock") !== "mock") {
    return;
  }

  credentialService.seedPlatformCredential("duffel", process.env.PLATFORM_DUFFEL_SECRET ?? "local-mock-duffel-secret");
  credentialService.seedPlatformCredential("stripe", process.env.PLATFORM_STRIPE_SECRET ?? "local-mock-stripe-secret");
}
