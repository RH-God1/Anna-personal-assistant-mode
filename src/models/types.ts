export type Currency = "USD" | "EUR" | "CNY" | "JPY" | "GBP";
export type ProviderKey =
  | "duffel"
  | "amadeus"
  | "travelport"
  | "expedia"
  | "hotelbeds"
  | "agoda"
  | "stripe"
  | "cybersource";

export type SupplierResultCode =
  | "ok"
  | "supplier_no_result"
  | "invalid_search_params"
  | "route_maybe_unsupported"
  | "supplier_error"
  | "rate_limited";

export interface SupplierResult<T> {
  data: T;
  supplier: ProviderKey;
  resultCode: SupplierResultCode;
  message?: string;
  idempotencyKey?: string;
}

export interface Money {
  amount: number;
  currency: Currency;
}

export interface PassengerInput {
  type: "adult" | "child" | "infant";
  count: number;
}

export interface FlightSearchInput {
  origin: string;
  destination: string;
  departureDate: string;
  returnDate?: string;
  passengers: PassengerInput[];
  cabinClass?: "economy" | "premium_economy" | "business" | "first";
}

export interface FlightOffer {
  id: string;
  provider: string;
  origin: string;
  destination: string;
  departureDate: string;
  returnDate?: string;
  airline: string;
  flightNumber: string;
  cabinClass: string;
  price: Money;
  expiresAt: string;
}

export interface PriceFlightOfferInput {
  offerId: string;
}

export interface PricedFlightOffer extends FlightOffer {
  pricedAt: string;
  tax: Money;
  total: Money;
}

export interface CreateFlightBookingInput {
  offerId: string;
  bookingId: string;
  idempotencyKey?: string;
  orderType?: "instant" | "hold";
  passengers?: DuffelPassengerInput[];
  payment?: DuffelPaymentInput;
}

export interface FlightBookingRecord {
  id: string;
  supplierBookingId: string;
  confirmationNumber: string;
  status: "created" | "ticketed" | "cancelled";
  ticketStatus: "not_ticketed" | "ticketed" | "voided";
  offer: PricedFlightOffer;
}

export interface HotelSearchInput {
  cityCode: string;
  checkInDate: string;
  checkOutDate: string;
  guests: number;
  rooms: number;
}

export interface HotelSummary {
  id: string;
  provider: string;
  name: string;
  cityCode: string;
  rating: number;
  address: string;
}

export interface HotelOffer {
  id: string;
  provider: string;
  hotelId: string;
  roomName: string;
  checkInDate: string;
  checkOutDate: string;
  guests: number;
  rooms: number;
  price: Money;
  cancellable: boolean;
  expiresAt: string;
}

export interface HotelDetails extends HotelSummary {
  amenities: string[];
  offers: HotelOffer[];
}

export interface PriceHotelOfferInput {
  offerId: string;
}

export interface PricedHotelOffer extends HotelOffer {
  pricedAt: string;
  taxesAndFees: Money;
  total: Money;
}

export interface CreateHotelBookingInput {
  offerId: string;
  bookingId: string;
}

export interface HotelBookingRecord {
  id: string;
  supplierBookingId: string;
  confirmationNumber: string;
  status: "created" | "cancelled";
  offer: PricedHotelOffer;
}

export interface DuffelPassengerInput {
  id?: string;
  type?: "adult" | "child" | "infant";
  title?: string;
  givenName: string;
  familyName: string;
  bornOn: string;
  gender?: "m" | "f";
  email?: string;
  phoneNumber?: string;
}

export interface DuffelPaymentInput {
  type?: "balance";
  amount?: string;
  currency?: Currency;
  threeDSecureSessionId?: string;
}

export interface PrepareFlightBookingInput {
  offerId: string;
  passengers: DuffelPassengerInput[];
  orderType?: "instant" | "hold";
  idempotencyKey?: string;
}

export interface ConfirmFlightBookingInput extends PrepareFlightBookingInput {
  bookingId?: string;
  userConfirmed: true;
  payment?: DuffelPaymentInput;
}

export interface PayHoldOrderInput {
  orderId: string;
  amount?: string;
  currency?: Currency;
  userConfirmed?: true;
  idempotencyKey?: string;
}

export interface DuffelStaySearchInput {
  location: string;
  checkInDate: string;
  checkOutDate: string;
  guests: number;
  rooms: number;
}

export interface DuffelStayRateInput {
  searchResultId: string;
}

export interface DuffelStayQuoteInput {
  rateId: string;
}

export interface DuffelStayBookingInput {
  quoteId: string;
  guests: Array<{ givenName: string; familyName: string }>;
  userConfirmed?: boolean;
  idempotencyKey?: string;
}

export type BookingType = "flight" | "hotel";
export type BookingStatus =
  | "pending"
  | "user_confirmed"
  | "payment_succeeded"
  | "supplier_confirmed"
  | "cancelled"
  | "failed";

export interface BookingRecord {
  id: string;
  type: BookingType;
  offerId: string;
  provider: string;
  amount: number;
  currency: Currency;
  status: BookingStatus;
  requiresUserConfirmation: boolean;
  userConfirmed: boolean;
  paymentId?: string;
  supplierBookingId?: string;
  confirmationNumber?: string;
  failureReason?: string;
  supplierStatus?: string;
  preparedSnapshot?: Record<string, unknown>;
  idempotencyKey?: string;
  createdAt: string;
  updatedAt: string;
}

export interface UserConfirmationRecord {
  id: string;
  bookingId: string;
  userId: string;
  tenantId: string;
  action: "prepare" | "confirm" | "pay_hold_order";
  supplier: ProviderKey;
  idempotencyKey: string;
  createdAt: string;
}

export interface OrderStatusRecord {
  id: string;
  bookingId: string;
  supplier: ProviderKey;
  supplierOrderId?: string;
  status: string;
  paymentStatus?: string;
  ticketStatus?: string;
  raw?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface IdempotencyRecord<T = unknown> {
  key: string;
  scope: string;
  requestHash: string;
  response: T;
  createdAt: string;
}

export interface CreateSetupIntentInput {
  bookingId?: string;
  customerId?: string;
  currency?: Currency;
}

export interface SetupIntent {
  id: string;
  status: "requires_payment_method" | "succeeded" | "cancelled";
  clientSecret: string;
}

export interface ChargeInput {
  bookingId: string;
  amount: number;
  currency: Currency;
  paymentMethodId?: string;
}

export interface PaymentRecord {
  id: string;
  bookingId: string;
  amount: number;
  currency: Currency;
  status: "requires_confirmation" | "succeeded" | "failed" | "refunded";
  provider: string;
  createdAt: string;
}

export interface RefundInput {
  paymentId: string;
  amount?: number;
}

export interface AuditLogEntry {
  id: string;
  action: string;
  actor: string;
  targetId?: string;
  metadata?: Record<string, string | number | boolean | undefined>;
  createdAt: string;
}

export interface ProviderCredential {
  id: string;
  ownerType: "platform" | "tenant" | "user";
  ownerId: string;
  provider: ProviderKey;
  mode: "sandbox" | "production";
  authType: "api_key" | "oauth";
  encryptedSecret: string;
  encryptedRefreshToken?: string;
  accessTokenExpiresAt?: string;
  keyVersion: number;
  last4: string;
  status: "active" | "revoked" | "expired";
  createdAt: string;
  updatedAt: string;
  lastUsedAt?: string;
}

export interface SafeProviderCredential {
  id: string;
  ownerType: ProviderCredential["ownerType"];
  ownerId: string;
  provider: ProviderKey;
  mode: ProviderCredential["mode"];
  authType: ProviderCredential["authType"];
  keyVersion: number;
  last4: string;
  status: ProviderCredential["status"];
  createdAt: string;
  updatedAt: string;
  lastUsedAt?: string;
}

export interface UsageRecord {
  id: string;
  userId: string;
  tenantId: string;
  provider: ProviderKey;
  endpoint: string;
  requestHash: string;
  cacheHit: boolean;
  estimatedCostUnit: number;
  createdAt: string;
}

export interface RequestContext {
  userId: string;
  tenantId: string;
  actor: string;
  isAgent: boolean;
}

export interface CachedProviderResponse<T = unknown> {
  key: string;
  provider: ProviderKey;
  endpoint: string;
  requestHash: string;
  value: T;
  expiresAt: string;
  createdAt: string;
}
