import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { createServer } from "../server.js";

test("local preview serves UI and assistant API", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "anna-server-learning-"));
  const server = createServer({
    learningMemoryPath: path.join(dir, "learning-memory.json")
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => server.close());
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;

  const page = await fetch(base);
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(html, /个人助理模式/);
  assert.match(html, /机票酒店接管/);
  assert.match(html, /自主学习与记忆强化/);
  assert.match(html, /Anna会进行自主学习并强化本次学习的记忆/);

  const response = await fetch(`${base}/api/assistant`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message: "我该如何比较两个选择",
      preferred_model: "anna-auto"
    })
  });
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.route.intent, "decision");
  assert.match(payload.response.answer, /可逆/);
  assert.equal(payload.context.learning, undefined);
  assert.equal(payload.context.learning_memory.applied, false);

  const learningStatusResponse = await fetch(`${base}/api/learning/status`);
  assert.equal(learningStatusResponse.status, 200);
  const learningStatus = await learningStatusResponse.json();
  assert.equal(learningStatus.curriculum.length, 3);
  assert.equal(learningStatus.trigger, "user_instruction_required");

  const learningCycleResponse = await fetch(`${base}/api/learning/cycle`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: "请进行本次强化学习并记住学习经验" })
  });
  assert.equal(learningCycleResponse.status, 200);
  const learningCycle = await learningCycleResponse.json();
  assert.equal(learningCycle.mode, "autonomous_reinforcement_learning");
  assert.deepEqual(
    learningCycle.reading_batch.map((section) => section.books_read_this_cycle),
    [5, 5, 5]
  );
  assert.equal(learningCycle.memory_update.stored, true);

  const triggeredLearningResponse = await fetch(`${base}/api/assistant`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message: "请进行本次强化学习、复盘并强化记忆"
    })
  });
  assert.equal(triggeredLearningResponse.status, 200);
  const triggeredLearning = await triggeredLearningResponse.json();
  assert.equal(triggeredLearning.context.learning.reading_phase.total_books, 15);
  assert.match(triggeredLearning.response.opening, /强化学习已完成/);
  assert.equal(triggeredLearning.response.learning.memory_update.stored, true);

  const weatherResponse = await fetch(`${base}/api/weather`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      location: {
        latitude: 31.2304,
        longitude: 121.4737,
        label: "上海",
        demo: true
      }
    })
  });
  assert.equal(weatherResponse.status, 200);
  const weather = await weatherResponse.json();
  assert.equal(weather.location.label, "上海");
  assert.equal(weather.source, "Open-Meteo demo fixture");

  const preflightResponse = await fetch(`${base}/api/preflight`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      first_use: true,
      weather_demo: true,
      location: {
        latitude: 31.2304,
        longitude: 121.4737,
        label: "上海"
      }
    })
  });
  assert.equal(preflightResponse.status, 200);
  const preflight = await preflightResponse.json();
  assert.equal(preflight.context.permissions.health, "requested");
  assert.ok(preflight.messages.some((item) => item.kind === "health_permission_request"));

  const pushedHealth = await fetch(`${base}/api/healthkit/snapshot`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      observed_at: "2026-06-18T10:00:00Z",
      today_steps: 6800,
      heart_rate_bpm: 76,
      sleep_minutes_last_night: 420,
      sleep_source: "HealthKit",
      source: "Anna iOS HealthKit Companion",
      device_types: ["iphone", "apple_watch"]
    })
  });
  assert.equal(pushedHealth.status, 200);
  const acceptedHealth = await pushedHealth.json();
  assert.equal(acceptedHealth.accepted, true);
  assert.equal(acceptedHealth.provider, "ios-watchos-companion");

  const connectedHealth = await fetch(`${base}/api/health/connect`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ consent: true })
  });
  assert.equal(connectedHealth.status, 200);
  const health = await connectedHealth.json();
  assert.equal(health.bridge_kind, "ios-watchos-companion");
  assert.equal(health.snapshot.today_steps, 6800);
  assert.equal(health.snapshot.heart_rate_bpm, 76);

  const travelResponse = await fetch(`${base}/api/travel/search`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      search: {
        product: "hotel",
        destination: "Hangzhou",
        departureDate: "2026-07-02"
      }
    })
  });
  assert.equal(travelResponse.status, 200);
  const travel = await travelResponse.json();
  assert.equal(travel.offers[0].product, "hotel");
  assert.equal(travel.offers[0].can_auto_book, false);

  const officialTravelResponse = await fetch(`${base}/api/travel/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      product: "flight",
      origin: "SHA",
      destination: "NRT",
      departureDate: "2026-08-12",
      provider: "official-handoff"
    })
  });
  assert.equal(officialTravelResponse.status, 200);
  const officialTravel = await officialTravelResponse.json();
  assert.equal(officialTravel.state, "await_user_confirmation");
  assert.equal(officialTravel.next_gate, "user_booking_confirmation");
  assert.match(
    officialTravel.selected_offer.handoff.url,
    /^https:\/\/www\.expedia\.com\/Flights-Search\?/
  );

  const confirmOfficialTravelResponse = await fetch(`${base}/api/travel/continue`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      run_id: officialTravel.id,
      event: "是"
    })
  });
  assert.equal(confirmOfficialTravelResponse.status, 200);
  const confirmedOfficialTravel = await confirmOfficialTravelResponse.json();
  assert.equal(confirmedOfficialTravel.state, "await_booking_authorization");
  assert.equal(confirmedOfficialTravel.next_gate, "booking_authorization");

  const selectedOfficialTravelResponse = await fetch(`${base}/api/travel/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      product: "hotel",
      destination: "Tokyo",
      departureDate: "2026-08-12",
      provider: "official-handoff",
      official_site: "trip"
    })
  });
  assert.equal(selectedOfficialTravelResponse.status, 200);
  const selectedOfficialTravel = await selectedOfficialTravelResponse.json();
  assert.equal(selectedOfficialTravel.selected_offer.handoff.site.id, "trip");
  assert.equal(selectedOfficialTravel.selected_offer.handoff.itinerary_in_url, false);
  assert.equal(selectedOfficialTravel.selected_offer.handoff.url, "https://www.trip.com/hotels/");

  const compareResponse = await fetch(`${base}/api/travel/compare`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      bookingType: "flight_hotel",
      flightProvider: "duffel",
      hotelProvider: "duffel",
      flight: {
        origin: "SHA",
        destination: "NRT",
        departureDate: "2026-08-12",
        returnDate: "2026-08-18",
        passengers: { adults: 1 }
      },
      hotel: {
        destination: "Tokyo",
        checkinDate: "2026-08-12",
        nights: 2,
        guests: { adults: 1 }
      }
    })
  });
  assert.equal(compareResponse.status, 200);
  const comparison = await compareResponse.json();
  assert.equal(comparison.bookingType, "flight_hotel");
  assert.ok(comparison.recommendation.items.length >= 2);

  const prepareResponse = await fetch(`${base}/api/booking/prepare`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      bookingType: "flight_hotel",
      items: comparison.recommendation.items.map((item) => ({
        type: item.type,
        provider: item.provider,
        offerId: item.offerId,
        criteria: item.type === "flight"
          ? {
            origin: "SHA",
            destination: "NRT",
            departureDate: "2026-08-12",
            returnDate: "2026-08-18",
            passengers: { adults: 1 }
          }
          : {
            destination: "Tokyo",
            checkinDate: "2026-08-12",
            nights: 2,
            guests: { adults: 1 }
          }
      })),
      travelers: [{ displayName: "Anna Test" }]
    })
  });
  assert.equal(prepareResponse.status, 200);
  const prepared = await prepareResponse.json();
  assert.match(prepared.confirmationId, /^bc_/);
  assert.equal(prepared.confirmation.status, "PENDING");
  assert.equal(prepared.confirmation.payment_policy.auto_payment, false);

  const confirmationPage = await fetch(`${base}/booking/confirm/${prepared.confirmationId}`);
  assert.equal(confirmationPage.status, 200);
  const confirmationPageHtml = await confirmationPage.text();
  assert.match(confirmationPageHtml, /人工确认订单|个人助理模式/);
  assert.match(confirmationPageHtml, /href="\/style\.css"/);
  assert.match(confirmationPageHtml, /src="\/anna-tool-ids\.js"/);
  assert.match(confirmationPageHtml, /src="\/app\.js"/);

  const confirmationResponse = await fetch(`${base}/api/booking/confirmation`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ confirmationId: prepared.confirmationId })
  });
  assert.equal(confirmationResponse.status, 200);
  const confirmation = await confirmationResponse.json();
  assert.equal(confirmation.id, prepared.confirmationId);

  const missingConfirmationResponse = await fetch(`${base}/api/booking/confirm`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ confirmationId: prepared.confirmationId })
  });
  assert.equal(missingConfirmationResponse.status, 200);
  const missingConfirmation = await missingConfirmationResponse.json();
  assert.equal(missingConfirmation.code, "USER_CONFIRMATION_REQUIRED");
  assert.equal(missingConfirmation.confirmation.status, "PENDING");
  assert.equal(missingConfirmation.order_results.length, 0);

  const bookingConfirmResponse = await fetch(`${base}/api/booking/confirm`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ confirmationId: prepared.confirmationId, userConfirmed: true })
  });
  assert.equal(bookingConfirmResponse.status, 200);
  const bookingConfirm = await bookingConfirmResponse.json();
  assert.equal(bookingConfirm.code, "ORDER_CREATED");
  assert.match(bookingConfirm.confirmation.provider_order_id, /^duffel_test_order_/);
  assert.equal(bookingConfirm.checkout_handoff_queue_id, null);
  assert.equal(bookingConfirm.order_results[0].payment_required, true);
  assert.match(bookingConfirm.order_results[0].order_reference, /^DUFFEL-TEST-/);
  assert.equal(bookingConfirm.order_information.provider_order_id, bookingConfirm.confirmation.provider_order_id);
  assert.equal(bookingConfirm.order_information.payment_collected_by_anna, false);
  assert.equal(bookingConfirm.order_information.ticketing_completed_by_anna, false);
  assert.equal(bookingConfirm.order_information.traveler_identity_collected_by_anna, false);
  assert.equal(bookingConfirm.payment_policy.payment_collected_by_anna, false);

  const crossOrigin = await fetch(`${base}/api/assistant`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Origin": "https://attacker.example"
    },
    body: "{}"
  });
  assert.equal(crossOrigin.status, 403);

  const simpleRequest = await fetch(`${base}/api/assistant`, {
    method: "POST",
    headers: { "Content-Type": "text/plain" },
    body: "{}"
  });
  assert.equal(simpleRequest.status, 415);

  const malformed = await fetch(`${base}/api/assistant`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{"
  });
  assert.equal(malformed.status, 400);

  const oversized = await fetch(`${base}/api/assistant`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: "x".repeat(129 * 1024) })
  });
  assert.equal(oversized.status, 413);

  const bundle = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../bundle");
  const outside = path.join(os.tmpdir(), `assistant-preview-${process.pid}.txt`);
  const link = path.join(bundle, `leak-${process.pid}.txt`);
  fs.writeFileSync(outside, "private");
  fs.symlinkSync(outside, link);
  try {
    const leaked = await fetch(`${base}/${path.basename(link)}`);
    assert.equal(leaked.status, 404);
  } finally {
    fs.rmSync(link, { force: true });
    fs.rmSync(outside, { force: true });
  }
});

test("healthkit snapshot bridge requires token when configured", async (t) => {
  const server = createServer({ healthKitBridgeToken: "secret-token" });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => server.close());
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;
  const snapshot = {
    observed_at: "2026-06-18T10:00:00Z",
    today_steps: 6800,
    heart_rate_bpm: 76,
    sleep_minutes_last_night: 420,
    device_types: ["iphone"]
  };

  const rejected = await fetch(`${base}/api/healthkit/snapshot`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(snapshot)
  });
  assert.equal(rejected.status, 403);

  const accepted = await fetch(`${base}/api/healthkit/snapshot`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Anna-Bridge-Token": "secret-token"
    },
    body: JSON.stringify(snapshot)
  });
  assert.equal(accepted.status, 200);
  const payload = await accepted.json();
  assert.equal(payload.accepted, true);
});
