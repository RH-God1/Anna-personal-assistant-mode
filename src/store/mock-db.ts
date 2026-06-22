import type {
  AuditLogEntry,
  BookingRecord,
  FlightBookingRecord,
  FlightOffer,
  HotelBookingRecord,
  HotelDetails,
  HotelOffer,
  PaymentRecord,
  PricedFlightOffer,
  PricedHotelOffer,
  ProviderCredential,
  CachedProviderResponse,
  IdempotencyRecord,
  OrderStatusRecord,
  SetupIntent,
  UserConfirmationRecord,
  UsageRecord
} from "../models/types.js";

export const mockDb = {
  flightOffers: new Map<string, FlightOffer>(),
  pricedFlightOffers: new Map<string, PricedFlightOffer>(),
  flightBookings: new Map<string, FlightBookingRecord>(),
  hotels: new Map<string, HotelDetails>(),
  hotelOffers: new Map<string, HotelOffer>(),
  pricedHotelOffers: new Map<string, PricedHotelOffer>(),
  hotelBookings: new Map<string, HotelBookingRecord>(),
  bookings: new Map<string, BookingRecord>(),
  userConfirmations: [] as UserConfirmationRecord[],
  orderStatuses: new Map<string, OrderStatusRecord>(),
  idempotencyRecords: new Map<string, IdempotencyRecord>(),
  setupIntents: new Map<string, SetupIntent>(),
  payments: new Map<string, PaymentRecord>(),
  providerCredentials: new Map<string, ProviderCredential>(),
  usageRecords: [] as UsageRecord[],
  providerResponseCache: new Map<string, CachedProviderResponse>(),
  rateLimitBuckets: new Map<string, { tokens: number; updatedAtMs: number }>(),
  auditLogs: [] as AuditLogEntry[]
};

export function nowIso(): string {
  return new Date().toISOString();
}

export function createId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
}
