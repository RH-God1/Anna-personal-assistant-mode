import type { FlightProvider } from "../providers/flight/FlightProvider.js";
import type { HotelProvider } from "../providers/hotel/HotelProvider.js";
import type {
  FlightSearchInput,
  HotelSearchInput,
  ProviderKey,
  RequestContext,
  PriceFlightOfferInput,
  PriceHotelOfferInput,
  ConfirmFlightBookingInput,
  PrepareFlightBookingInput,
  PayHoldOrderInput,
  DuffelStaySearchInput,
  DuffelStayRateInput,
  DuffelStayQuoteInput,
  DuffelStayBookingInput
} from "../models/types.js";
import { CredentialResolver } from "./credential-resolver.service.js";
import { LocalEnvelopeEncryptionService } from "./envelope-encryption.service.js";
import { InMemoryTokenBucketRateLimiter } from "./rate-limit.service.js";
import { ProviderCacheService } from "./provider-cache.service.js";
import { ProviderCredentialService } from "./provider-credential.service.js";
import { UsageService } from "./usage.service.js";
import { auditLog } from "../utils/audit-log.js";
import { DuffelFlightProvider } from "../providers/flight/DuffelFlightProvider.js";
import { DuffelStayProvider } from "../providers/hotel/DuffelStayProvider.js";
import { DuffelProvider } from "../providers/duffel/DuffelProvider.js";
import { createId, mockDb, nowIso } from "../store/mock-db.js";

export class TravelOrchestrator {
  constructor(
    private readonly flightProvider: FlightProvider = new DuffelFlightProvider(),
    private readonly hotelProvider: HotelProvider = new DuffelStayProvider(),
    private readonly credentialResolver: CredentialResolver = new CredentialResolver(
      new ProviderCredentialService(new LocalEnvelopeEncryptionService())
    ),
    private readonly rateLimiter: InMemoryTokenBucketRateLimiter = new InMemoryTokenBucketRateLimiter(),
    private readonly usageService: UsageService = new UsageService(),
    private readonly cacheService: ProviderCacheService = new ProviderCacheService(),
    private readonly duffelProvider: DuffelProvider = new DuffelProvider()
  ) {}

  async searchFlights(input: FlightSearchInput, context: RequestContext) {
    return this.cachedProviderCall("duffel", "flights.search", input, context, 5, () => this.flightProvider.searchFlights(input));
  }

  async priceFlightOffer(input: PriceFlightOfferInput, context: RequestContext) {
    return this.providerCall("duffel", "flights.price", input, context, 2, () => this.flightProvider.priceFlightOffer(input));
  }

  async getOffer(offerId: string, context: RequestContext) {
    return this.providerCall("duffel", "flights.offer.get", { offerId }, context, 1, () => this.duffelProvider.getOffer(offerId));
  }

  async refreshOffer(offerId: string, context: RequestContext, idempotencyKey?: string) {
    return this.providerCall("duffel", "flights.offer.refresh", { offerId, idempotencyKey }, context, 2, () =>
      this.duffelProvider.refreshOffer(offerId, idempotencyKey)
    );
  }

  async prepareFlightBooking(input: PrepareFlightBookingInput, context: RequestContext) {
    return this.providerCall("duffel", "flights.booking.prepare", input, context, 2, () =>
      this.duffelProvider.prepareBooking(input)
    );
  }

  async confirmFlightBooking(input: ConfirmFlightBookingInput, context: RequestContext) {
    return this.providerCall("duffel", "flights.booking.confirm", input, context, 10, () =>
      this.duffelProvider.confirmBooking(input)
    );
  }

  async createFlightBooking(
    offerId: string,
    bookingId: string,
    context: RequestContext,
    options: Partial<Omit<ConfirmFlightBookingInput, "offerId" | "bookingId" | "userConfirmed">> = {}
  ) {
    return this.providerCall("duffel", "flights.book", { offerId, bookingId, ...options }, context, 10, () =>
      this.flightProvider.createFlightBooking({
        offerId,
        bookingId,
        idempotencyKey: options.idempotencyKey,
        orderType: options.orderType,
        passengers: options.passengers,
        payment: options.payment
      })
    );
  }

  async getFlightBooking(bookingId: string, context: RequestContext) {
    return this.providerCall("duffel", "flights.booking_status", { bookingId }, context, 1, () =>
      this.flightProvider.getFlightBooking(bookingId)
    );
  }

  async payHoldOrder(input: PayHoldOrderInput, context: RequestContext) {
    return this.providerCall("duffel", "flights.order.pay_hold", input, context, 4, () =>
      this.duffelProvider.payHoldOrder(input).then((result) => {
        this.recordUserConfirmation(context, "pay_hold_order", input.orderId, input.idempotencyKey);
        this.recordOrderStatus({
          bookingId: input.orderId,
          supplierOrderId: input.orderId,
          status: stringField(result, "status", "payment_submitted"),
          paymentStatus: stringField(result, "status", "payment_submitted"),
          raw: supplierStatusSnapshot(result)
        });
        return result;
      })
    );
  }

  async getDuffelOrder(orderId: string, context: RequestContext) {
    return this.providerCall("duffel", "flights.order.get", { orderId }, context, 1, () =>
      this.duffelProvider.getOrder(orderId)
    );
  }

  async searchHotels(input: HotelSearchInput, context: RequestContext) {
    return this.cachedProviderCall("duffel", "stays.search", input, context, 5, () => this.hotelProvider.searchHotels(input));
  }

  async getHotelDetails(hotelId: string, context: RequestContext) {
    return this.providerCall("duffel", "stays.details", { hotelId }, context, 1, () => this.hotelProvider.getHotelDetails(hotelId));
  }

  async priceHotelOffer(input: PriceHotelOfferInput, context: RequestContext) {
    return this.providerCall("duffel", "stays.price", input, context, 2, () => this.hotelProvider.priceHotelOffer(input));
  }

  async createHotelBooking(offerId: string, bookingId: string, context: RequestContext) {
    return this.providerCall("duffel", "stays.book", { offerId, bookingId }, context, 10, () =>
      this.hotelProvider.createHotelBooking({ offerId, bookingId })
    );
  }

  async getHotelBooking(bookingId: string, context: RequestContext) {
    return this.providerCall("duffel", "stays.booking_status", { bookingId }, context, 1, () =>
      this.hotelProvider.getHotelBooking(bookingId)
    );
  }

  async searchStays(input: DuffelStaySearchInput, context: RequestContext, idempotencyKey?: string) {
    return this.providerCall("duffel", "stays.search.raw", { input, idempotencyKey }, context, 5, () =>
      this.duffelProvider.searchStays(input, idempotencyKey)
    );
  }

  async getStayRates(input: DuffelStayRateInput, context: RequestContext, idempotencyKey?: string) {
    return this.providerCall("duffel", "stays.rates", { input, idempotencyKey }, context, 2, () =>
      this.duffelProvider.getStayRates(input, idempotencyKey)
    );
  }

  async createStayQuote(input: DuffelStayQuoteInput, context: RequestContext, idempotencyKey?: string) {
    return this.providerCall("duffel", "stays.quote", { input, idempotencyKey }, context, 3, () =>
      this.duffelProvider.createStayQuote(input, idempotencyKey)
    );
  }

  async createStayBooking(input: DuffelStayBookingInput, context: RequestContext) {
    return this.providerCall("duffel", "stays.booking.create", input, context, 10, () =>
      this.duffelProvider.createStayBooking(input).then((result) => {
        const supplierBookingId = stringField(result, "id", input.quoteId);
        this.recordUserConfirmation(context, "confirm", supplierBookingId, input.idempotencyKey);
        this.recordOrderStatus({
          bookingId: supplierBookingId,
          supplierOrderId: supplierBookingId,
          status: stringField(result, "status", "created"),
          paymentStatus: stringField(result, "payment_status", undefined),
          raw: supplierStatusSnapshot(result)
        });
        return result;
      })
    );
  }

  async getStayBooking(bookingId: string, context: RequestContext) {
    return this.providerCall("duffel", "stays.booking.get", { bookingId }, context, 1, () =>
      this.duffelProvider.getStayBooking(bookingId)
    );
  }

  private async cachedProviderCall<T>(
    provider: ProviderKey,
    endpoint: string,
    request: unknown,
    context: RequestContext,
    estimatedCostUnit: number,
    call: () => Promise<T>
  ): Promise<T> {
    const requestHash = this.cacheService.requestHash(request);
    const cached = this.cacheService.get<T>(provider, endpoint, requestHash);
    if (cached) {
      this.usageService.record({
        context,
        provider,
        endpoint,
        requestHash,
        cacheHit: true,
        estimatedCostUnit: 0
      });
      return cached;
    }

    const result = await this.providerCall(provider, endpoint, request, context, estimatedCostUnit, call);
    this.cacheService.set(provider, endpoint, requestHash, result);
    return result;
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
    try {
      const result = await call();
      auditLog({
        action: `provider.${endpoint}`,
        actor: context.actor,
        metadata: {
          provider,
          tenantId: context.tenantId,
          cacheHit: false,
          estimatedCostUnit
        }
      });
      this.usageService.record({
        context,
        provider,
        endpoint,
        requestHash,
        cacheHit: false,
        estimatedCostUnit
      });
      return result;
    } catch (error) {
      auditLog({
        action: `provider.${endpoint}.error`,
        actor: context.actor,
        metadata: {
          provider,
          tenantId: context.tenantId,
          estimatedCostUnit,
          errorCode: error instanceof Error && "code" in error ? String(error.code) : undefined,
          errorName: error instanceof Error ? error.name : "unknown"
        }
      });
      throw error;
    }
  }

  private recordUserConfirmation(
    context: RequestContext,
    action: "confirm" | "pay_hold_order",
    bookingId: string,
    idempotencyKey?: string
  ) {
    mockDb.userConfirmations.push({
      id: createId("confirm"),
      bookingId,
      userId: context.userId,
      tenantId: context.tenantId,
      action,
      supplier: "duffel",
      idempotencyKey: idempotencyKey ?? createId("idem"),
      createdAt: nowIso()
    });
  }

  private recordOrderStatus(input: {
    bookingId: string;
    supplierOrderId?: string;
    status: string;
    paymentStatus?: string;
    ticketStatus?: string;
    raw?: Record<string, unknown>;
  }) {
    mockDb.orderStatuses.set(input.bookingId, {
      id: createId("order_status"),
      bookingId: input.bookingId,
      supplier: "duffel",
      supplierOrderId: input.supplierOrderId,
      status: input.status,
      paymentStatus: input.paymentStatus,
      ticketStatus: input.ticketStatus,
      raw: input.raw,
      createdAt: nowIso(),
      updatedAt: nowIso()
    });
  }
}

function stringField(record: Record<string, unknown>, field: string, fallback: string): string;
function stringField(record: Record<string, unknown>, field: string, fallback?: string): string | undefined;
function stringField(record: Record<string, unknown>, field: string, fallback?: string): string | undefined {
  const value = record[field];
  return typeof value === "string" && value.trim() ? value : fallback;
}

function supplierStatusSnapshot(record: Record<string, unknown>): Record<string, unknown> {
  return {
    id: record.id,
    order_id: record.order_id,
    status: record.status,
    payment_status: record.payment_status,
    live_mode: record.live_mode,
    created_at: record.created_at
  };
}
