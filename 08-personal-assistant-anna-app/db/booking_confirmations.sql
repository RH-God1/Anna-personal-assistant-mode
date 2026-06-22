-- Anna personal assistant travel booking confirmation table.
-- First phase stores sandbox/test snapshots only. Do not store passport numbers,
-- identity document numbers, full payment card data, CVV/CVC, or bank account data here.

CREATE TABLE IF NOT EXISTS booking_confirmations (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  booking_type TEXT NOT NULL CHECK (booking_type IN ('flight', 'hotel', 'flight_hotel')),
  flight_offer_id TEXT,
  hotel_offer_id TEXT,
  flight_snapshot JSONB,
  hotel_snapshot JSONB,
  traveler_snapshot JSONB NOT NULL,
  total_currency TEXT NOT NULL,
  total_amount NUMERIC(12, 2) NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('PENDING', 'ORDER_CREATED', 'EXPIRED', 'CANCELLED')),
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ,
  provider_order_id TEXT,
  provider_booking_id TEXT,
  idempotency_key TEXT,
  supplier_result_code TEXT,
  supplier_message TEXT
);

CREATE INDEX IF NOT EXISTS idx_booking_confirmations_user_created
  ON booking_confirmations (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_booking_confirmations_status_expires
  ON booking_confirmations (status, expires_at);

CREATE TABLE IF NOT EXISTS booking_user_confirmations (
  id TEXT PRIMARY KEY,
  confirmation_id TEXT NOT NULL REFERENCES booking_confirmations(id),
  user_id TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT 'duffel',
  action TEXT NOT NULL CHECK (action IN ('prepare', 'confirm', 'pay_hold_order')),
  idempotency_key TEXT NOT NULL,
  confirmed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_booking_user_confirmations_idempotency
  ON booking_user_confirmations (provider, action, idempotency_key);

CREATE TABLE IF NOT EXISTS booking_order_statuses (
  id TEXT PRIMARY KEY,
  confirmation_id TEXT NOT NULL REFERENCES booking_confirmations(id),
  provider TEXT NOT NULL DEFAULT 'duffel',
  provider_order_id TEXT,
  provider_booking_id TEXT,
  status TEXT NOT NULL,
  payment_status TEXT,
  ticket_status TEXT,
  raw_status JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_booking_order_statuses_confirmation
  ON booking_order_statuses (confirmation_id, updated_at DESC);
