import type { CreateSetupIntentInput, ProviderKey, RefundInput, RequestContext } from "../models/types.js";
import { MockPaymentProvider } from "../providers/payment/MockPaymentProvider.js";
import type { PaymentProvider } from "../providers/payment/PaymentProvider.js";
import { mockDb, nowIso } from "../store/mock-db.js";
import { auditLog } from "../utils/audit-log.js";
import { ForbiddenError, NotFoundError } from "../utils/errors.js";
import type { BookingService } from "./booking.service.js";
import { CredentialResolver } from "./credential-resolver.service.js";
import { LocalEnvelopeEncryptionService } from "./envelope-encryption.service.js";
import { ProviderCacheService } from "./provider-cache.service.js";
import { ProviderCredentialService } from "./provider-credential.service.js";
import { InMemoryTokenBucketRateLimiter } from "./rate-limit.service.js";
import { UsageService } from "./usage.service.js";

export class PaymentService {
  constructor(
    private readonly bookingService: BookingService,
    private readonly paymentProvider: PaymentProvider = new MockPaymentProvider(),
    private readonly credentialResolver: CredentialResolver = new CredentialResolver(
      new ProviderCredentialService(new LocalEnvelopeEncryptionService())
    ),
    private readonly rateLimiter: InMemoryTokenBucketRateLimiter = new InMemoryTokenBucketRateLimiter(),
    private readonly usageService: UsageService = new UsageService(),
    private readonly cacheService: ProviderCacheService = new ProviderCacheService()
  ) {}

  createSetupIntent(input: CreateSetupIntentInput, context: RequestContext) {
    auditLog({
      action: "payment.setup_intent.create",
      actor: "backend",
      targetId: input.bookingId,
      metadata: { provider: this.paymentProvider.name }
    });
    return this.providerCall("stripe", "payment.setup_intent", input, context, 1, () =>
      this.paymentProvider.createSetupIntent(input)
    );
  }

  async confirmPayment(input: { bookingId: string; userConfirmed: boolean; paymentMethodId?: string; context: RequestContext }) {
    if (!input.userConfirmed) {
      throw new ForbiddenError("Payment confirmation requires userConfirmed: true");
    }

    const booking = this.bookingService.confirmUser(input.bookingId, input.userConfirmed);
    const payment = await this.providerCall("stripe", "payment.charge", { bookingId: booking.id }, input.context, 3, () =>
      this.paymentProvider.charge({
        bookingId: booking.id,
        amount: booking.amount,
        currency: booking.currency,
        paymentMethodId: input.paymentMethodId
      })
    );

    booking.paymentId = payment.id;
    booking.status = "payment_succeeded";
    booking.updatedAt = nowIso();
    auditLog({
      action: "payment.charge.succeeded",
      actor: "backend",
      targetId: booking.id,
      metadata: { paymentId: payment.id, amount: payment.amount, currency: payment.currency }
    });

    const confirmedBooking = await this.bookingService.createSupplierBooking(booking.id, input.context);
    return { payment, booking: confirmedBooking };
  }

  async refund(input: RefundInput, context: RequestContext) {
    const payment = mockDb.payments.get(input.paymentId);
    if (!payment) {
      throw new NotFoundError("Payment not found");
    }

    const refunded = await this.providerCall("stripe", "payment.refund", input, context, 2, () => this.paymentProvider.refund(input));
    const booking = mockDb.bookings.get(payment.bookingId);
    if (booking) {
      booking.status = "cancelled";
      booking.updatedAt = nowIso();
    }
    auditLog({
      action: "payment.refund",
      actor: "backend",
      targetId: payment.bookingId,
      metadata: { paymentId: payment.id, amount: input.amount ?? payment.amount }
    });
    return refunded;
  }

  getPaymentStatus(paymentId: string, context: RequestContext) {
    return this.providerCall("stripe", "payment.status", { paymentId }, context, 1, () =>
      this.paymentProvider.getPaymentStatus(paymentId)
    );
  }

  private async providerCall<T>(
    provider: ProviderKey,
    endpoint: string,
    request: unknown,
    context: RequestContext,
    estimatedCostUnit: number,
    call: () => Promise<T>
  ): Promise<T> {
    const requestHash = this.cacheService.requestHash(request);
    this.usageService.assertQuota(context, estimatedCostUnit);
    this.rateLimiter.assertAllowed(context, provider, Math.max(1, estimatedCostUnit));
    this.credentialResolver.resolve(provider, context.tenantId, context.userId);
    const result = await call();
    this.usageService.record({
      context,
      provider,
      endpoint,
      requestHash,
      cacheHit: false,
      estimatedCostUnit
    });
    return result;
  }
}
