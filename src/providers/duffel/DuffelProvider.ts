import type {
  ConfirmFlightBookingInput,
  Currency,
  DuffelPassengerInput,
  DuffelPaymentInput,
  DuffelStayBookingInput,
  DuffelStayQuoteInput,
  DuffelStayRateInput,
  DuffelStaySearchInput,
  FlightBookingRecord,
  FlightOffer,
  FlightSearchInput,
  PayHoldOrderInput,
  PrepareFlightBookingInput,
  PricedFlightOffer
} from "../../models/types.js";
import { createId, mockDb, nowIso } from "../../store/mock-db.js";
import { NotFoundError, SupplierResponseError, ValidationError } from "../../utils/errors.js";

const DUFFEL_NO_RESULT_MESSAGE = "当前通过 Duffel 没有查到可预订报价。";

interface DuffelProviderOptions {
  accessToken?: string;
  baseUrl?: string;
  staysEnabled?: boolean;
  fetchImpl?: typeof fetch;
}

export class DuffelProvider {
  readonly name = "duffel";
  private readonly accessToken: string;
  private readonly baseUrl: string;
  private readonly staysEnabled: boolean;
  private readonly fetchImpl: typeof fetch;

  constructor(options: DuffelProviderOptions = {}) {
    this.accessToken = options.accessToken ?? process.env.DUFFEL_ACCESS_TOKEN ?? "";
    this.baseUrl = (options.baseUrl ?? process.env.DUFFEL_BASE_URL ?? "https://api.duffel.com").replace(/\/$/, "");
    this.staysEnabled = options.staysEnabled ?? isTruthy(process.env.DUFFEL_STAYS_ENABLED);
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  isConfigured(): boolean {
    return Boolean(this.accessToken);
  }

  supportsStays(): boolean {
    return this.staysEnabled;
  }

  async searchFlights(input: FlightSearchInput, idempotencyKey?: string): Promise<FlightOffer[]> {
    validateFlightSearch(input);
    if (maybeUnsupportedRoute(input)) {
      throw new SupplierResponseError("route_maybe_unsupported", DUFFEL_NO_RESULT_MESSAGE, 502);
    }
    if (!this.isConfigured()) {
      return this.fixtureFlights(input);
    }

    const data = await this.request<Record<string, unknown>>("/air/offer_requests?return_offers=true", {
      method: "POST",
      idempotencyKey,
      body: {
        data: {
          slices: flightSlices(input),
          passengers: duffelSearchPassengers(input),
          cabin_class: input.cabinClass ?? "economy"
        }
      }
    });
    const offers = arrayFrom(asRecord(data).offers).map((offer) => this.mapOffer(offer, input));
    for (const offer of offers) {
      mockDb.flightOffers.set(offer.id, offer);
    }
    return offers;
  }

  async getOffer(offerId: string): Promise<PricedFlightOffer> {
    if (!this.isConfigured()) {
      return this.fixturePricedOffer(offerId);
    }
    const data = await this.request<Record<string, unknown>>(`/air/offers/${encodeURIComponent(offerId)}?return_available_services=true`, {
      method: "GET"
    });
    return this.storePricedOffer(this.mapPricedOffer(data));
  }

  async refreshOffer(offerId: string, idempotencyKey?: string): Promise<PricedFlightOffer> {
    if (!this.isConfigured()) {
      return this.fixturePricedOffer(offerId);
    }
    const data = await this.request<Record<string, unknown>>(`/air/offers/${encodeURIComponent(offerId)}/actions/price`, {
      method: "POST",
      idempotencyKey,
      body: { data: { intended_services: [] } }
    });
    return this.storePricedOffer(this.mapPricedOffer(data));
  }

  async prepareBooking(input: PrepareFlightBookingInput): Promise<PricedFlightOffer> {
    validatePassengers(input.passengers);
    const offer = await this.refreshOffer(input.offerId, input.idempotencyKey);
    if (Date.parse(offer.expiresAt) <= Date.now()) {
      throw new SupplierResponseError("supplier_no_result", "Duffel offer has expired; prepare a new booking.", 409);
    }
    return offer;
  }

  async confirmBooking(input: ConfirmFlightBookingInput): Promise<FlightBookingRecord> {
    if (input.userConfirmed !== true) {
      throw new ValidationError("confirmBooking requires userConfirmed: true");
    }
    validatePassengers(input.passengers);
    const offer = mockDb.pricedFlightOffers.get(input.offerId) ?? await this.refreshOffer(input.offerId, input.idempotencyKey);
    if (!this.isConfigured()) {
      return this.fixtureBooking(input, offer);
    }

    const orderType = input.orderType ?? "hold";
    const data: Record<string, unknown> = {
      selected_offers: [input.offerId],
      passengers: input.passengers.map(toDuffelOrderPassenger),
      type: orderType,
      metadata: {
        anna_booking_id: input.bookingId ?? "",
        anna_phase: "test"
      }
    };
    if (orderType === "instant") {
      data.payments = [paymentForOffer(offer, input.payment)];
    }

    const order = await this.request<Record<string, unknown>>("/air/orders", {
      method: "POST",
      idempotencyKey: input.idempotencyKey,
      body: { data }
    });
    return this.storeFlightBooking(input.bookingId ?? createId("booking"), order, offer);
  }

  async holdOrder(input: ConfirmFlightBookingInput): Promise<FlightBookingRecord> {
    return this.confirmBooking({ ...input, orderType: "hold" });
  }

  async payHoldOrder(input: PayHoldOrderInput): Promise<Record<string, unknown>> {
    if (input.userConfirmed !== true) {
      throw new ValidationError("payHoldOrder requires userConfirmed: true");
    }
    if (!this.isConfigured()) {
      return {
        id: createId("duffel_payment"),
        order_id: input.orderId,
        status: "succeeded",
        live_mode: false
      };
    }
    const order = await this.request<Record<string, unknown>>(`/air/orders/${encodeURIComponent(input.orderId)}`, { method: "GET" });
    const amount = input.amount ?? stringField(order, "total_amount", "0.00");
    const currency = input.currency ?? currencyField(order, "total_currency", "USD");
    return this.request<Record<string, unknown>>("/air/payments", {
      method: "POST",
      idempotencyKey: input.idempotencyKey,
      body: {
        data: {
          order_id: input.orderId,
          payment: {
            type: "balance",
            amount,
            currency
          }
        }
      }
    });
  }

  async getOrder(orderId: string): Promise<Record<string, unknown>> {
    if (!this.isConfigured()) {
      const booking = [...mockDb.flightBookings.values()].find((item) => item.supplierBookingId === orderId || item.id === orderId);
      if (!booking) throw new NotFoundError("Duffel test order not found");
      return {
        id: booking.supplierBookingId,
        booking_reference: booking.confirmationNumber,
        status: booking.status,
        payment_status: { paid: booking.ticketStatus === "ticketed" },
        live_mode: false
      };
    }
    return this.request<Record<string, unknown>>(`/air/orders/${encodeURIComponent(orderId)}`, { method: "GET" });
  }

  async searchStays(input: DuffelStaySearchInput, idempotencyKey?: string): Promise<Record<string, unknown>> {
    this.assertStaysEnabled();
    return this.request<Record<string, unknown>>("/stays/search", {
      method: "POST",
      idempotencyKey,
      body: {
        data: {
          location: { query: input.location },
          check_in_date: input.checkInDate,
          check_out_date: input.checkOutDate,
          guests: [{ type: "adult" }],
          rooms: input.rooms
        }
      }
    });
  }

  async getStayRates(input: DuffelStayRateInput, idempotencyKey?: string): Promise<Record<string, unknown>> {
    this.assertStaysEnabled();
    return this.request<Record<string, unknown>>(`/stays/search_results/${encodeURIComponent(input.searchResultId)}/actions/fetch_all_rates`, {
      method: "POST",
      idempotencyKey,
      body: { data: {} }
    });
  }

  async createStayQuote(input: DuffelStayQuoteInput, idempotencyKey?: string): Promise<Record<string, unknown>> {
    this.assertStaysEnabled();
    return this.request<Record<string, unknown>>("/stays/quotes", {
      method: "POST",
      idempotencyKey,
      body: { data: { rate_id: input.rateId } }
    });
  }

  async createStayBooking(input: DuffelStayBookingInput): Promise<Record<string, unknown>> {
    if (input.userConfirmed !== true) {
      throw new ValidationError("createStayBooking requires userConfirmed: true");
    }
    this.assertStaysEnabled();
    return this.request<Record<string, unknown>>("/stays/bookings", {
      method: "POST",
      idempotencyKey: input.idempotencyKey,
      body: {
        data: {
          quote_id: input.quoteId,
          guests: input.guests.map((guest) => ({
            given_name: guest.givenName,
            family_name: guest.familyName
          }))
        }
      }
    });
  }

  async getStayBooking(bookingId: string): Promise<Record<string, unknown>> {
    this.assertStaysEnabled();
    return this.request<Record<string, unknown>>(`/stays/bookings/${encodeURIComponent(bookingId)}`, { method: "GET" });
  }

  private async request<T>(path: string, options: { method: "GET" | "POST" | "PATCH"; body?: unknown; idempotencyKey?: string }): Promise<T> {
    const headers: Record<string, string> = {
      Accept: "application/json",
      "Duffel-Version": "v2",
      Authorization: `Bearer ${this.accessToken}`
    };
    if (options.body !== undefined) headers["Content-Type"] = "application/json";
    if (options.idempotencyKey) headers["Idempotency-Key"] = options.idempotencyKey;

    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method: options.method,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body)
    });
    const payload = await parseResponse(response);
    if (!response.ok) {
      throw classifyDuffelError(response.status, payload);
    }
    const record = asRecord(payload);
    return (record.data ?? record) as T;
  }

  private mapOffer(raw: unknown, fallback: FlightSearchInput): FlightOffer {
    const offer = asRecord(raw);
    const firstSegment = firstFlightSegment(offer);
    const owner = asRecord(offer.owner);
    return {
      id: stringField(offer, "id", createId("duffel_offer")),
      provider: this.name,
      origin: stringField(firstSegment, "origin_iata_code", fallback.origin.toUpperCase()),
      destination: stringField(firstSegment, "destination_iata_code", fallback.destination.toUpperCase()),
      departureDate: stringField(firstSegment, "departing_at", fallback.departureDate).slice(0, 10),
      returnDate: fallback.returnDate,
      airline: stringField(owner, "iata_code", stringField(owner, "name", "Duffel")),
      flightNumber: segmentFlightNumber(firstSegment),
      cabinClass: fallback.cabinClass ?? "economy",
      price: {
        amount: numberField(offer, "total_amount", 0),
        currency: currencyField(offer, "total_currency", "USD")
      },
      expiresAt: stringField(offer, "expires_at", new Date(Date.now() + 20 * 60 * 1000).toISOString())
    };
  }

  private mapPricedOffer(raw: unknown): PricedFlightOffer {
    const offer = asRecord(raw);
    const firstSegment = firstFlightSegment(offer);
    const owner = asRecord(offer.owner);
    const totalCurrency = currencyField(offer, "total_currency", "USD");
    const taxCurrency = currencyField(offer, "tax_currency", totalCurrency);
    const id = stringField(offer, "id", createId("duffel_offer"));
    const base: FlightOffer = mockDb.flightOffers.get(id) ?? {
      id,
      provider: this.name,
      origin: stringField(firstSegment, "origin_iata_code", "UNKNOWN"),
      destination: stringField(firstSegment, "destination_iata_code", "UNKNOWN"),
      departureDate: stringField(firstSegment, "departing_at", nowIso()).slice(0, 10),
      airline: stringField(owner, "iata_code", stringField(owner, "name", "Duffel")),
      flightNumber: segmentFlightNumber(firstSegment),
      cabinClass: "economy",
      price: {
        amount: numberField(offer, "base_amount", numberField(offer, "total_amount", 0)),
        currency: totalCurrency
      },
      expiresAt: stringField(offer, "expires_at", new Date(Date.now() + 20 * 60 * 1000).toISOString())
    };
    return {
      ...base,
      provider: this.name,
      pricedAt: nowIso(),
      tax: {
        amount: numberField(offer, "tax_amount", 0),
        currency: taxCurrency
      },
      total: {
        amount: numberField(offer, "total_amount", base.price.amount),
        currency: totalCurrency
      }
    };
  }

  private storePricedOffer(offer: PricedFlightOffer): PricedFlightOffer {
    mockDb.flightOffers.set(offer.id, offer);
    mockDb.pricedFlightOffers.set(offer.id, offer);
    return offer;
  }

  private storeFlightBooking(bookingId: string, rawOrder: unknown, offer: PricedFlightOffer): FlightBookingRecord {
    const order = asRecord(rawOrder);
    const supplierOrderId = stringField(order, "id", createId("duffel_order"));
    const status = stringField(order, "status", "created") as FlightBookingRecord["status"];
    const booking: FlightBookingRecord = {
      id: bookingId,
      supplierBookingId: supplierOrderId,
      confirmationNumber: stringField(order, "booking_reference", supplierOrderId.slice(-8).toUpperCase()),
      status: status === "cancelled" ? "cancelled" : status === "ticketed" ? "ticketed" : "created",
      ticketStatus: status === "ticketed" ? "ticketed" : "not_ticketed",
      offer
    };
    mockDb.flightBookings.set(booking.id, booking);
    mockDb.orderStatuses.set(booking.id, {
      id: createId("order_status"),
      bookingId: booking.id,
      supplier: "duffel",
      supplierOrderId,
      status: booking.status,
      paymentStatus: JSON.stringify(order.payment_status ?? {}),
      ticketStatus: booking.ticketStatus,
      raw: sanitizeRaw(order),
      createdAt: nowIso(),
      updatedAt: nowIso()
    });
    return booking;
  }

  private fixtureFlights(input: FlightSearchInput): FlightOffer[] {
    const passengerCount = input.passengers.reduce((sum, passenger) => sum + passenger.count, 0);
    const base = Math.max(240, 160 + passengerCount * 110);
    const offers = [0, 1].map((index) => ({
      id: createId("duffel_test_offer"),
      provider: this.name,
      origin: input.origin.toUpperCase(),
      destination: input.destination.toUpperCase(),
      departureDate: input.departureDate,
      returnDate: input.returnDate,
      airline: index === 0 ? "Duffel Test Air" : "Duffel Test Connect",
      flightNumber: index === 0 ? "DU218" : "DU426",
      cabinClass: input.cabinClass ?? "economy",
      price: { amount: base + index * 96, currency: "USD" as Currency },
      expiresAt: new Date(Date.now() + 20 * 60 * 1000).toISOString()
    }));
    for (const offer of offers) mockDb.flightOffers.set(offer.id, offer);
    return offers;
  }

  private fixturePricedOffer(offerId: string): PricedFlightOffer {
    const offer = mockDb.flightOffers.get(offerId);
    if (!offer) throw new NotFoundError("Duffel test flight offer not found");
    const tax = Math.round(offer.price.amount * 0.11);
    const priced: PricedFlightOffer = {
      ...offer,
      pricedAt: nowIso(),
      tax: { amount: tax, currency: offer.price.currency },
      total: { amount: offer.price.amount + tax, currency: offer.price.currency }
    };
    mockDb.pricedFlightOffers.set(priced.id, priced);
    return priced;
  }

  private fixtureBooking(input: ConfirmFlightBookingInput, offer: PricedFlightOffer): FlightBookingRecord {
    const booking: FlightBookingRecord = {
      id: input.bookingId ?? createId("booking"),
      supplierBookingId: createId(input.orderType === "instant" ? "duffel_test_order" : "duffel_test_hold"),
      confirmationNumber: `DU${Date.now().toString(36).toUpperCase()}`,
      status: input.orderType === "instant" ? "ticketed" : "created",
      ticketStatus: input.orderType === "instant" ? "ticketed" : "not_ticketed",
      offer
    };
    mockDb.flightBookings.set(booking.id, booking);
    mockDb.orderStatuses.set(booking.id, {
      id: createId("order_status"),
      bookingId: booking.id,
      supplier: "duffel",
      supplierOrderId: booking.supplierBookingId,
      status: booking.status,
      paymentStatus: input.orderType === "instant" ? "paid_test" : "awaiting_payment_test",
      ticketStatus: booking.ticketStatus,
      raw: { live_mode: false, test_fixture: true },
      createdAt: nowIso(),
      updatedAt: nowIso()
    });
    return booking;
  }

  private assertStaysEnabled() {
    if (!this.staysEnabled) {
      throw new SupplierResponseError(
        "route_maybe_unsupported",
        "Duffel Stays permission is not enabled for this backend. The route may be unsupported by the current supplier.",
        501
      );
    }
    if (!this.isConfigured()) {
      throw new SupplierResponseError("supplier_error", "DUFFEL_ACCESS_TOKEN is required for Duffel Stays.", 503);
    }
  }
}

function validateFlightSearch(input: FlightSearchInput) {
  if (!/^[A-Z0-9]{3,}$/i.test(input.origin) || !/^[A-Z0-9]{3,}$/i.test(input.destination)) {
    throw new SupplierResponseError("invalid_search_params", "origin and destination must be valid airport or city codes.", 400);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.departureDate)) {
    throw new SupplierResponseError("invalid_search_params", "departureDate must use YYYY-MM-DD.", 400);
  }
}

function maybeUnsupportedRoute(input: FlightSearchInput): boolean {
  return /^(ZZZ|XXX|TST)$/i.test(input.origin) || /^(ZZZ|XXX|TST)$/i.test(input.destination);
}

function flightSlices(input: FlightSearchInput) {
  const slices = [
    {
      origin: input.origin.toUpperCase(),
      destination: input.destination.toUpperCase(),
      departure_date: input.departureDate
    }
  ];
  if (input.returnDate) {
    slices.push({
      origin: input.destination.toUpperCase(),
      destination: input.origin.toUpperCase(),
      departure_date: input.returnDate
    });
  }
  return slices;
}

function duffelSearchPassengers(input: FlightSearchInput) {
  return input.passengers.flatMap((passenger) =>
    Array.from({ length: passenger.count }, () => ({ type: passenger.type }))
  );
}

function validatePassengers(passengers: DuffelPassengerInput[]) {
  if (!Array.isArray(passengers) || passengers.length < 1) {
    throw new ValidationError("At least one passenger is required before confirm.");
  }
  for (const passenger of passengers) {
    if (!passenger.givenName || !passenger.familyName || !/^\d{4}-\d{2}-\d{2}$/.test(passenger.bornOn)) {
      throw new ValidationError("Passenger givenName, familyName and bornOn are required.");
    }
  }
}

function toDuffelOrderPassenger(passenger: DuffelPassengerInput) {
  return {
    ...(passenger.id ? { id: passenger.id } : {}),
    type: passenger.type,
    title: passenger.title,
    given_name: passenger.givenName,
    family_name: passenger.familyName,
    born_on: passenger.bornOn,
    gender: passenger.gender,
    email: passenger.email,
    phone_number: passenger.phoneNumber
  };
}

function paymentForOffer(offer: PricedFlightOffer, payment?: DuffelPaymentInput) {
  return {
    type: payment?.type ?? "balance",
    amount: payment?.amount ?? offer.total.amount.toFixed(2),
    currency: payment?.currency ?? offer.total.currency,
    ...(payment?.threeDSecureSessionId ? { three_d_secure_session_id: payment.threeDSecureSessionId } : {})
  };
}

async function parseResponse(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { message: text };
  }
}

function classifyDuffelError(status: number, payload: unknown): SupplierResponseError {
  const message = errorMessage(payload);
  const lower = message.toLowerCase();
  if (status === 429) return new SupplierResponseError("rate_limited", message || "Duffel rate limit reached.", 429);
  if (/unsupported|not supported|route|market|not available in/.test(lower)) {
    return new SupplierResponseError("route_maybe_unsupported", message || DUFFEL_NO_RESULT_MESSAGE, status);
  }
  if (/no offers|no availability|not available|sold out|expired/.test(lower)) {
    return new SupplierResponseError("supplier_no_result", DUFFEL_NO_RESULT_MESSAGE, status === 404 ? 404 : 409);
  }
  if (status === 400 || status === 422) {
    return new SupplierResponseError("invalid_search_params", message || "Duffel rejected the search parameters.", 400);
  }
  return new SupplierResponseError("supplier_error", message || "Duffel API error.", status >= 500 ? 502 : status);
}

function errorMessage(payload: unknown): string {
  const record = asRecord(payload);
  const errors = arrayFrom(record.errors);
  const first = asRecord(errors[0]);
  return stringField(first, "message", stringField(record, "message", stringField(record, "error", "Duffel API error.")));
}

function firstFlightSegment(offer: Record<string, unknown>): Record<string, unknown> {
  const slices = arrayFrom(offer.slices);
  const slice = asRecord(slices[0]);
  const segments = arrayFrom(slice.segments);
  return asRecord(segments[0]);
}

function segmentFlightNumber(segment: Record<string, unknown>): string {
  return stringField(segment, "marketing_carrier_flight_number", stringField(segment, "flight_number", "DU"));
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function arrayFrom(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringField(record: Record<string, unknown>, field: string, fallback: string): string {
  const value = record[field];
  return typeof value === "string" && value.trim() ? value : fallback;
}

function numberField(record: Record<string, unknown>, field: string, fallback: number): number {
  const value = Number(record[field]);
  return Number.isFinite(value) ? value : fallback;
}

function currencyField(record: Record<string, unknown>, field: string, fallback: Currency): Currency {
  const value = String(record[field] || fallback).toUpperCase();
  return value as Currency;
}

function sanitizeRaw(record: Record<string, unknown>): Record<string, unknown> {
  return {
    id: record.id,
    status: record.status,
    payment_status: record.payment_status,
    live_mode: record.live_mode,
    created_at: record.created_at
  };
}

function isTruthy(value: string | undefined): boolean {
  return ["1", "true", "yes", "on"].includes(String(value || "").toLowerCase());
}
