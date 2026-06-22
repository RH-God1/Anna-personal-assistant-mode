import assert from "node:assert/strict";
import { createApp } from "../dist/app.js";
import { mockDb } from "../dist/store/mock-db.js";

const app = createApp();
const server = app.listen(0, "127.0.0.1");

await new Promise((resolve) => server.once("listening", resolve));

const { port } = server.address();
const base = `http://127.0.0.1:${port}`;

try {
  await runSmoke();
} finally {
  await new Promise((resolve) => server.close(resolve));
}

async function runSmoke() {
  const flightSearch = await request("POST", "/api/travel/flights/search", {
    origin: "PVG",
    destination: "NRT",
    departureDate: "2026-08-12",
    returnDate: "2026-08-18",
    passengers: [{ type: "adult", count: 1 }],
    cabinClass: "economy"
  }, "duffel-smoke-search-001");
  assert.equal(flightSearch.supplier, "duffel");
  assert.equal(flightSearch.resultCode, "ok");
  assert.ok(flightSearch.data.length >= 1, "flight search should return Duffel test offers");

  const offerId = flightSearch.data[0].id;
  const offer = await request("GET", `/api/travel/flights/offers/${encodeURIComponent(offerId)}`, null, "duffel-smoke-offer-001");
  assert.equal(offer.resultCode, "ok");
  assert.equal(offer.data.id, offerId);

  const refreshed = await request("POST", `/api/travel/flights/offers/${encodeURIComponent(offerId)}/refresh`, {}, "duffel-smoke-refresh-001");
  assert.equal(refreshed.resultCode, "ok");
  assert.equal(refreshed.data.id, offerId);
  assert.ok(refreshed.data.total.amount > 0, "refresh should price the offer");

  const passenger = {
    type: "adult",
    givenName: "Anna",
    familyName: "Test",
    bornOn: "1990-01-01"
  };
  const prepareBody = {
    offerId,
    orderType: "hold",
    passengers: [passenger]
  };
  const prepared = await request("POST", "/api/travel/flights/prepare", prepareBody, "duffel-smoke-prepare-001", 201);
  assert.equal(prepared.resultCode, "ok");
  assert.equal(prepared.data.status, "pending");
  assert.equal(prepared.data.requiresUserConfirmation, true);
  assert.equal(prepared.data.userConfirmed, false);

  const preparedAgain = await request("POST", "/api/travel/flights/prepare", prepareBody, "duffel-smoke-prepare-001", 201);
  assert.equal(preparedAgain.data.id, prepared.data.id, "reused idempotency key must return the original prepare response");

  const confirmBody = {
    bookingId: prepared.data.id,
    offerId,
    orderType: "hold",
    userConfirmed: true,
    passengers: [passenger]
  };
  const confirmed = await request("POST", "/api/travel/flights/confirm", confirmBody, "duffel-smoke-confirm-001");
  assert.equal(confirmed.resultCode, "ok");
  assert.equal(confirmed.data.status, "supplier_confirmed");
  assert.match(confirmed.data.supplierBookingId, /^duffel_test_hold_/);

  const order = await request("GET", `/api/travel/flights/orders/${encodeURIComponent(confirmed.data.supplierBookingId)}`, null, "duffel-smoke-order-001");
  assert.equal(order.resultCode, "ok");
  assert.equal(order.data.live_mode, false);

  const paid = await request("POST", "/api/travel/flights/orders/pay-hold", {
    orderId: confirmed.data.supplierBookingId,
    amount: String(confirmed.data.amount),
    currency: confirmed.data.currency,
    userConfirmed: true
  }, "duffel-smoke-pay-hold-001");
  assert.equal(paid.resultCode, "ok");
  assert.equal(paid.data.status, "succeeded");

  const unsupported = await request("POST", "/api/travel/flights/search", {
    origin: "ZZZ",
    destination: "NRT",
    departureDate: "2026-08-12",
    passengers: [{ type: "adult", count: 1 }]
  }, "duffel-smoke-unsupported-001", 502);
  assert.equal(unsupported.error.resultCode, "route_maybe_unsupported");
  assert.equal(unsupported.error.message, "当前通过 Duffel 没有查到可预订报价。");
  assert.equal(unsupported.error.idempotencyKey, "duffel-smoke-unsupported-001");

  const stays = await request("POST", "/api/travel/stays/search", {
    location: "Tokyo",
    checkInDate: "2026-08-12",
    checkOutDate: "2026-08-14",
    guests: 1,
    rooms: 1
  }, "duffel-smoke-stays-001", 501);
  assert.equal(stays.error.resultCode, "route_maybe_unsupported");
  assert.equal(stays.error.supplier, "duffel");
  assert.equal(stays.error.idempotencyKey, "duffel-smoke-stays-001");

  assertRuntimeRecords(prepared, confirmed);

  console.log(JSON.stringify({
    ok: true,
    supplier: "duffel",
    checks: [
      "flights.search",
      "flights.offer.get",
      "flights.offer.refresh",
      "flights.prepare",
      "flights.confirm_hold_order",
      "flights.order.get",
    "flights.order.pay_hold",
    "flights.order.pay_hold_user_confirm",
    "flights.route_maybe_unsupported",
    "stays.permission_gate",
    "supplier_error_audit_logs",
      "idempotency_records",
      "audit_logs",
      "rate_limit_buckets",
      "user_confirmation_records",
      "order_status_records"
    ],
    bookingId: prepared.data.id,
    supplierBookingId: confirmed.data.supplierBookingId
  }, null, 2));
}

function assertRuntimeRecords(prepared, confirmed) {
  for (const key of [
    "travel.flights.search:duffel-smoke-search-001",
    "travel.flights.offer.refresh:duffel-smoke-refresh-001",
    "travel.flights.booking.prepare:duffel-smoke-prepare-001",
    "travel.flights.booking.confirm:duffel-smoke-confirm-001",
    "travel.flights.order.pay_hold:duffel-smoke-pay-hold-001"
  ]) {
    assert.ok(mockDb.idempotencyRecords.has(key), `missing idempotency record ${key}`);
  }

  assert.equal(
    [...mockDb.bookings.values()].filter((booking) => booking.id === prepared.data.id).length,
    1,
    "idempotent prepare must leave exactly one booking record"
  );
  assert.ok(
    mockDb.userConfirmations.some((record) =>
      record.bookingId === prepared.data.id &&
      record.action === "confirm" &&
      record.supplier === "duffel" &&
      record.idempotencyKey === "duffel-smoke-confirm-001"
    ),
    "confirm must write a Duffel user confirmation record"
  );
  assert.ok(
    mockDb.userConfirmations.some((record) =>
      record.bookingId === confirmed.data.supplierBookingId &&
      record.action === "pay_hold_order" &&
      record.supplier === "duffel" &&
      record.idempotencyKey === "duffel-smoke-pay-hold-001"
    ),
    "pay hold must write a Duffel user confirmation record"
  );
  assert.ok(
    mockDb.orderStatuses.has(prepared.data.id),
    "confirm must write an order status record"
  );
  const orderStatus = mockDb.orderStatuses.get(prepared.data.id);
  assert.equal(orderStatus.supplier, "duffel");
  assert.equal(orderStatus.supplierOrderId, confirmed.data.supplierBookingId);
  assert.equal(orderStatus.status, "created");
  assert.equal(orderStatus.ticketStatus, "not_ticketed");
  assert.ok(
    mockDb.orderStatuses.has(confirmed.data.supplierBookingId),
    "pay hold must write an order payment status record"
  );
  assert.equal(mockDb.orderStatuses.get(confirmed.data.supplierBookingId).paymentStatus, "succeeded");

  for (const bucket of ["user:local-user", "tenant:local-tenant", "provider:duffel"]) {
    assert.ok(mockDb.rateLimitBuckets.has(bucket), `missing rate limit bucket ${bucket}`);
  }

  for (const action of [
    "booking.prepare",
    "booking.user_confirm",
    "booking.supplier_confirm",
    "provider.flights.search",
    "provider.flights.booking.confirm",
    "provider.flights.order.pay_hold",
    "provider.flights.search.error",
    "provider.stays.search.raw.error",
    "provider_usage.record"
  ]) {
    assert.ok(
      mockDb.auditLogs.some((entry) => entry.action === action),
      `missing audit log action ${action}`
    );
  }
}

async function request(method, path, body, idempotencyKey, expectedStatus = 200) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      ...(body == null ? {} : { "Content-Type": "application/json" }),
      "Idempotency-Key": idempotencyKey
    },
    body: body == null ? undefined : JSON.stringify(body)
  });
  const payload = await response.json();
  assert.equal(response.status, expectedStatus, `${method} ${path}: ${JSON.stringify(payload)}`);
  return payload;
}
