import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { routeModel } from "../src/model-router.js";
import { createAssistantService } from "../src/service.js";
import { composeAssistantResponse } from "../src/companion.js";
import { createBridgeableHealthKitProvider, createHealthStore } from "../src/health-store.js";
import { getWeather } from "../src/weather.js";

test("multimodal routing requests capabilities instead of inventing model support", () => {
  const route = routeModel({
    message: "请分析这张图片和这段录音",
    attachments: [
      { name: "room.png", type: "image/png", size: 1200 },
      { name: "note.m4a", type: "audio/mp4", size: 2400 }
    ],
    preferredModel: "gemma-4-e4b-it"
  });
  assert.deepEqual(route.required_capabilities, ["text", "vision", "audio"]);
  assert.equal(route.selected_model.id, "anna-auto");
  assert.equal(route.fallback_used, true);
});

test("decision signals take precedence when a prompt also expresses uncertainty", () => {
  const route = routeModel({
    message: "我在两个选择之间纠结，请帮我区分事实、预测和代价"
  });
  assert.equal(route.intent, "decision");
  assert.equal(route.selected_model.id, "qwen3-max");
  assert.equal(route.selection_mode, "text-specialized-hint");
  assert.match(route.warning || "", /Qwen3 Max|主机另有实时能力/);
});

test("text-only intents fan out across specialized text model hints", () => {
  const general = routeModel({ message: "帮我快速总结今天的安排" });
  assert.equal(general.intent, "writing");
  assert.equal(general.selected_model.id, "qwen-plus");

  const companion = routeModel({ message: "我有点焦虑，想把话说得稳一点" });
  assert.equal(companion.intent, "companion");
  assert.equal(companion.selected_model.id, "minimax-m2-7");

  const creative = routeModel({ message: "帮我头脑风暴 5 个活动名称和一句 slogan" });
  assert.equal(creative.intent, "creative");
  assert.equal(creative.selected_model.id, "mimo-v2-flash");

  const everyday = routeModel({ message: "用三句话解释什么是向量数据库" });
  assert.equal(everyday.intent, "general");
  assert.equal(everyday.selected_model.id, "gemini-3.1-flash-lite-preview");

  const travel = routeModel({ message: "帮我规划机票和酒店，先不要付款" });
  assert.equal(travel.intent, "travel");
  assert.deepEqual(travel.required_capabilities, ["text", "tools"]);
  assert.equal(travel.selected_model.id, "anna-auto");
});

test("reinforcement learning runs only after user instruction and persists progress", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "anna-learning-"));
  const memoryPath = path.join(dir, "learning-memory.json");
  const service = createAssistantService({
    now: () => new Date("2026-06-20T08:00:00.000Z"),
    learningMemoryPath: memoryPath
  });
  const before = service.learningStatus();
  assert.equal(before.cycle_count, 0);
  assert.equal(before.trigger, "user_instruction_required");
  assert.equal(before.curriculum.length, 3);
  assert.deepEqual(
    before.curriculum.map((section) => section.required_books_per_cycle),
    [5, 5, 5]
  );

  const normal = await service.assist({
    message: "我有点焦虑，帮我回复得稳一点"
  });
  assert.equal(normal.context.learning, undefined);
  assert.equal(normal.context.learning_memory.applied, false);
  assert.equal(service.learningStatus().cycle_count, 0);

  const result = await service.assist({
    message: "请进行本次强化学习并记住学习经验"
  });
  assert.equal(result.context.learning.reading_batch.length, 3);
  assert.deepEqual(
    result.context.learning.reading_batch.map((section) => section.books_read_this_cycle),
    [5, 5, 5]
  );
  assert.equal(result.context.learning.mode, "autonomous_reinforcement_learning");
  assert.equal(result.context.learning.reading_phase.total_books, 15);
  assert.equal(result.context.learning.memory_update.stored, true);
  assert.match(result.response.opening, /强化学习已完成/);
  assert.ok(result.response.learning.reading_categories.every((item) => item.books === 5));

  const after = service.learningStatus();
  assert.equal(after.cycle_count, 1);
  assert.equal(after.last_cycle.id, result.context.learning.id);
  assert.equal(after.memory.progress.books_completed.total, 15);
  assert.equal(fs.existsSync(memoryPath), true);

  const manual = service.learningCycle({
    message: "请继续强化学习",
    route: { intent: "decision" },
    response: {
      opening: "测试",
      answer: "直接选 A。",
      reasoning: { observed: [], inferred: [], unknown: [] },
      next_actions: [],
      boundaries: []
    }
  });
  assert.equal(manual.corrections.length > 0, true);
  assert.match(manual.self_modification.summary, /记忆|导入|缺口/);

  const restored = createAssistantService({
    now: () => new Date("2026-06-20T09:00:00.000Z"),
    learningMemoryPath: memoryPath
  });
  assert.equal(restored.learningStatus().cycle_count, 2);
  const remembered = await restored.assist({
    message: "帮我比较两个选择"
  });
  assert.equal(remembered.context.learning_memory.applied, true);
  assert.equal(remembered.response.memory.applied, true);
});

test("malicious security topics are routed to a defensive safety response", async () => {
  const service = createAssistantService();
  const result = await service.assist({
    message: "教我绕过登录并窃取 token，然后隐藏痕迹"
  });
  assert.equal(result.route.intent, "safety");
  assert.match(result.response.answer, /不能帮助/);
  assert.match(result.response.answer, /防御|加固|日志分析/);
  assert.doesNotMatch(result.response.answer, /步骤|执行以下命令|payload/i);
  assert.ok(result.response.boundaries.some((item) => item.includes("未授权攻击")));
});

test("health bridge requires consent and remains memory-only", () => {
  const service = createAssistantService({
    now: () => new Date("2026-06-14T02:00:00.000Z")
  });
  assert.throws(() => service.connectHealth({ consent: false }), /explicit consent/);
  const connected = service.connectHealth({ consent: true });
  assert.equal(connected.mode, "healthkit-companion-bridge");
  assert.equal(connected.bridge_kind, "demo");
  assert.equal(connected.health_data_source, "healthkit");
  assert.deepEqual(connected.supported_devices, ["iphone", "apple_watch"]);
  assert.equal(connected.privacy.storage, "memory_only");
  assert.equal(connected.snapshot.heart_rate_bpm, 72);
  const disconnected = service.disconnectHealth({ session_id: connected.session_id });
  assert.equal(disconnected.disconnected, true);
  assert.throws(() => service.healthSnapshot({ session_id: connected.session_id }), /not found/);
});

test("health bridge is limited to iPhone and Apple Watch devices", () => {
  const service = createAssistantService();
  assert.throws(
    () => service.connectHealth({
      consent: true,
      device_types: ["android_phone"]
    }),
    /only supports iPhone and Apple Watch/
  );
});

test("health bridge provider contract can refresh realtime companion snapshots", () => {
  let heartRate = 70;
  const service = createAssistantService({
    now: () => new Date("2026-06-18T04:00:00.000Z"),
    healthKitProvider: {
      kind: "ios-watchos-companion",
      realtime: true,
      readSnapshot({ observedAt, supportedDevices }) {
        heartRate += 1;
        assert.deepEqual(supportedDevices, ["iphone"]);
        return {
          observed_at: observedAt,
          today_steps: 6120,
          heart_rate_bpm: heartRate,
          sleep_minutes_last_night: 420,
          sleep_source: "Apple Watch",
          source: "Authorized HealthKit companion"
        };
      }
    }
  });
  const connected = service.connectHealth({
    consent: true,
    deviceTypes: ["iphone"],
    deviceLabel: "用户 iPhone"
  });
  assert.equal(connected.bridge_kind, "ios-watchos-companion");
  assert.equal(connected.realtime, true);
  assert.equal(connected.snapshot.today_steps, 6120);
  assert.equal(connected.snapshot.heart_rate_bpm, 71);
  const refreshed = service.healthSnapshot({ session_id: connected.session_id });
  assert.equal(refreshed.snapshot.heart_rate_bpm, 72);
  assert.equal(refreshed.snapshot.source, "Authorized HealthKit companion");
});

test("bridgeable health provider upgrades from demo to companion snapshot", () => {
  const service = createAssistantService({
    now: () => new Date("2026-06-18T05:00:00.000Z"),
    healthKitProvider: createBridgeableHealthKitProvider()
  });
  const demo = service.connectDemoHealth({ consent: true });
  assert.equal(demo.bridge_kind, "demo");
  assert.equal(demo.snapshot.heart_rate_bpm, 72);

  const pushed = service.updateHealthKitSnapshot({
    observed_at: "2026-06-18T05:01:00.000Z",
    today_steps: 7380,
    heart_rate_bpm: 83,
    sleep_minutes_last_night: 398,
    sleep_source: "Apple Watch",
    source: "Anna iOS HealthKit Companion host smoke"
  });
  assert.equal(pushed.bridge_kind, "ios-watchos-companion");
  assert.equal(pushed.snapshot.today_steps, 7380);
  assert.equal(pushed.snapshot.heart_rate_bpm, 83);

  const companion = service.connectHealth({ consent: true });
  assert.equal(companion.bridge_kind, "ios-watchos-companion");
  assert.equal(companion.snapshot.heart_rate_bpm, 83);
  assert.equal(companion.snapshot.source, "Anna iOS HealthKit Companion host smoke");
});

test("weather demo includes source and coordinate privacy declaration", async () => {
  const service = createAssistantService();
  const weather = await service.weather({
    latitude: 31.2304,
    longitude: 121.4737,
    label: "上海",
    demo: true
  });
  assert.equal(weather.location.label, "上海");
  assert.equal(weather.location.latitude, 31.23);
  assert.equal(weather.location.longitude, 121.474);
  assert.equal(weather.source, "Open-Meteo demo fixture");
  assert.deepEqual(weather.privacy.transmitted, ["approximate_coordinates"]);
  assert.equal(weather.privacy.retained_by_app, false);
});

test("personal assistant integrates flight and hotel travel planning with human gates", async () => {
  const service = createAssistantService({
    now: () => new Date("2026-06-18T10:00:00.000Z")
  });
  const flight = service.travelSearch({
    search: {
      product: "flight",
      origin: "SHA",
      destination: "BJS",
      departureDate: "2026-07-01",
      passengers: { adults: 1 }
    }
  });
  assert.equal(flight.offers[0].product, "flight");
  assert.deepEqual(flight.offers[0].gates, [
    "traveler_info",
    "order_confirmation",
    "payment"
  ]);
  assert.equal(flight.privacy.pii_accepted, false);

  const hotel = service.travelSearch({
    search: {
      product: "hotel",
      destination: "Hangzhou",
      departureDate: "2026-07-02",
      passengers: { adults: 2 }
    }
  });
  assert.equal(hotel.offers[0].product, "hotel");
  assert.match(hotel.offers[0].schedule, /Hangzhou/);

  const run = service.travelStart({
    search: {
      product: "flight",
      origin: "SHA",
      destination: "BJS",
      departureDate: "2026-07-01"
    }
  });
  assert.equal(run.state, "await_traveler_info");
  assert.throws(
    () => service.travelContinue({ run_id: run.id, event: "payment_completed" }),
    /not allowed/
  );
  const info = service.travelContinue({ run_id: run.id, event: "traveler_info_completed" });
  assert.equal(info.state, "await_order_confirmation");
  const confirmed = service.travelContinue({ run_id: run.id, event: "order_confirmed" });
  assert.equal(confirmed.state, "await_payment");
});

test("booking prepare supports generic flight_hotel confirmations without payment", async () => {
  const service = createAssistantService({
    now: () => new Date("2026-06-20T02:00:00.000Z")
  });
  const comparison = await service.travelCompare({
    bookingType: "flight_hotel",
    flightProvider: "duffel",
    hotelProvider: "duffel",
    flight: {
      origin: "SHA",
      destination: "NRT",
      departureDate: "2026-08-12",
      returnDate: "2026-08-18",
      cabinClass: "economy",
      passengers: { adults: 1 }
    },
    hotel: {
      destination: "Tokyo",
      checkinDate: "2026-08-12",
      nights: 2,
      guests: { adults: 1 },
      hotelLocation: "Shinjuku"
    }
  });
  assert.equal(comparison.bookingType, "flight_hotel");
  assert.ok(comparison.recommendation.items.some((item) => item.type === "flight"));
  assert.ok(comparison.recommendation.items.some((item) => item.type === "hotel"));

  const prepared = await service.bookingPrepare({
    userId: "test-user",
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
          cabinClass: "economy",
          passengers: { adults: 1 }
        }
        : {
          destination: "Tokyo",
          checkinDate: "2026-08-12",
          nights: 2,
          guests: { adults: 1 },
          hotelLocation: "Shinjuku"
        }
    })),
    travelers: [{ displayName: "王小明", type: "adult" }]
  });
  assert.match(prepared.confirmationId, /^bc_/);
  assert.equal(prepared.confirmation.status, "PENDING");
  assert.match(prepared.confirmation.confirmation_queue_id, /^confirm_/);
  assert.equal(prepared.confirmation.traveler_snapshot.plaintext_documents_saved, false);
  assert.equal(prepared.confirmation.payment_policy.auto_payment, false);
  assert.equal(prepared.confirmation.payment_policy.order_creation_by_anna, true);
  assert.match(prepared.confirmation.traveler_snapshot.travelers[0].display_name, /^王/);

  const loaded = service.bookingGetConfirmation({ confirmationId: prepared.confirmationId });
  assert.equal(loaded.id, prepared.confirmationId);
  assert.equal(loaded.flight_offer_id, comparison.recommendation.items.find((item) => item.type === "flight").offerId);

  const confirmed = await service.bookingConfirm({
    confirmationId: prepared.confirmationId,
    userConfirmed: true,
    userCompletion: {
      travelerDisplayNames: ["王小明"],
      handoffChoice: "supplier_checkout",
      checkoutResponsible: true
    }
  });
  assert.equal(confirmed.code, "ORDER_CREATED");
  assert.equal(confirmed.confirmation.status, "ORDER_CREATED");
  assert.match(confirmed.confirmation.provider_order_id, /^duffel_test_order_/);
  assert.match(confirmed.confirmation.provider_booking_id, /^duffel_test_booking_/);
  assert.equal(confirmed.checkout_handoff_queue_id, null);
  assert.equal(confirmed.order_results[0].payment_required, true);
  assert.equal(confirmed.order_results[0].order_status, "created");
  assert.equal(confirmed.order_results[0].payment_collected_by_anna, false);
  assert.match(confirmed.order_results[0].order_reference, /^DUFFEL-TEST-/);
  assert.equal(confirmed.order_information.status, "ORDER_CREATED");
  assert.equal(confirmed.order_information.provider_order_id, confirmed.confirmation.provider_order_id);
  assert.equal(confirmed.order_information.payment_collected_by_anna, false);
  assert.equal(confirmed.order_information.ticketing_completed_by_anna, false);
  assert.equal(confirmed.order_information.traveler_identity_collected_by_anna, false);
  assert.match(confirmed.order_information.next_required_action, /user_must_open_order_or_checkout/);
  assert.equal(confirmed.payment_policy.payment_collected_by_anna, false);
});

test("booking confirm requires explicit user confirmation before creating supplier orders", async () => {
  const service = createAssistantService({
    now: () => new Date("2026-06-20T02:30:00.000Z")
  });
  const flight = await service.flightSearch({
    provider: "duffel",
    origin: "SHA",
    destination: "NRT",
    departureDate: "2026-08-12",
    passengers: { adults: 1 }
  });
  const prepared = await service.bookingPrepare({
    bookingType: "flight",
    items: [{
      type: "flight",
      provider: "duffel",
      offerId: flight.offers[0].id,
      criteria: {
        origin: "SHA",
        destination: "NRT",
        departureDate: "2026-08-12",
        passengers: { adults: 1 }
      }
    }]
  });

  const unconfirmed = await service.bookingConfirm({ confirmationId: prepared.confirmationId });
  assert.equal(unconfirmed.code, "USER_CONFIRMATION_REQUIRED");
  assert.equal(unconfirmed.status, "PENDING");
  assert.equal(unconfirmed.confirmation.status, "PENDING");
  assert.equal(unconfirmed.confirmation.provider_order_id, null);
  assert.equal(unconfirmed.order_results.length, 0);

  const missingUserInfo = await service.bookingConfirm({
    confirmationId: prepared.confirmationId,
    userConfirmed: true
  });
  assert.equal(missingUserInfo.code, "USER_INFO_REQUIRED");
  assert.equal(missingUserInfo.status, "PENDING");
  assert.equal(missingUserInfo.confirmation.provider_order_id, null);

  const confirmed = await service.bookingConfirm({
    confirmationId: prepared.confirmationId,
    userConfirmed: true,
    userCompletion: {
      travelerDisplayNames: ["Anna Test"],
      handoffChoice: "supplier_checkout",
      checkoutResponsible: true
    }
  });
  assert.equal(confirmed.code, "ORDER_CREATED");
  assert.match(confirmed.confirmation.provider_order_id, /^duffel_test_order_/);
  assert.equal(confirmed.order_information.provider_order_id, confirmed.confirmation.provider_order_id);
  assert.equal(confirmed.order_information.order_results[0].payment_collected_by_anna, false);
});

test("permission registry allows confirmed supplier order creation but payment stays blocked", async () => {
  const service = createAssistantService({
    now: () => new Date("2026-06-20T03:00:00.000Z")
  });
  const permissions = service.permissionRegistry();
  assert.ok(permissions.some((item) => item.id === "healthkit.read_snapshot"));
  assert.ok(permissions.some((item) => item.id === "travel.search.amadeus_sandbox"));
  assert.ok(permissions.some((item) => item.id === "booking.create_order" && item.status === "requires_user_confirmation"));
  assert.ok(permissions.some((item) => item.id === "payment.confirm" && item.status === "blocked_in_this_runtime"));

  const flight = await service.flightSearch({
    provider: "amadeus",
    origin: "SHA",
    destination: "NRT",
    departureDate: "2026-08-12",
    passengers: { adults: 1 }
  });
  assert.equal(flight.provider, "amadeus");
  assert.equal(flight.offers[0].offer_source, "amadeus_sandbox_fixture");

  const prepared = await service.bookingPrepare({
    bookingType: "flight",
    items: [{
      type: "flight",
      provider: "amadeus",
      offerId: flight.offers[0].id,
      criteria: {
        origin: "SHA",
        destination: "NRT",
        departureDate: "2026-08-12",
        passengers: { adults: 1 }
      }
    }],
    travelers: [{ displayName: "测试", type: "adult" }]
  });
  assert.match(prepared.confirmation.confirmation_queue_id, /^confirm_/);
  assert.equal(service.confirmationQueue().length, 1);

  const confirmed = await service.bookingConfirm({
    confirmationId: prepared.confirmationId,
    userConfirmed: true,
    createProviderOrder: false,
    userCompletion: {
      travelerDisplayNames: ["测试"],
      handoffChoice: "saved_supplier_profile",
      checkoutResponsible: true
    }
  });
  assert.equal(confirmed.code, "USER_CHECKOUT_REQUIRED");
  assert.equal(confirmed.order_results.length, 0);
  assert.equal(confirmed.confirmation.provider_order_id, null);
  const queue = service.confirmationQueue();
  assert.ok(queue.some((item) => item.id === prepared.confirmation.confirmation_queue_id && item.status === "approved"));
  assert.ok(queue.some((item) => item.id === confirmed.checkout_handoff_queue_id && item.permission_id === "booking.create_order"));
});

test("Duffel no-result responses keep supplier coverage separate from real-world availability", async () => {
  const service = createAssistantService();
  const result = await service.flightSearch({
    provider: "duffel",
    origin: "ZZZ",
    destination: "NRT",
    departureDate: "2026-08-12",
    passengers: { adults: 1 }
  });
  assert.equal(result.provider, "duffel");
  assert.equal(result.resultCode, "route_maybe_unsupported");
  assert.equal(result.route_maybe_unsupported, true);
  assert.equal(result.offers.length, 0);
  assert.match(result.message, /当前通过 Duffel 没有查到可预订报价/);
});

test("booking prepare rejects documents and card-like sensitive fields", async () => {
  const service = createAssistantService();
  await assert.rejects(
    () => service.bookingPrepare({
      bookingType: "flight",
      flightOfferId: "duffel_flight_demo_1",
      flightProvider: "duffel",
      flight: {
        origin: "SHA",
        destination: "BJS",
        departureDate: "2026-07-01",
        passengers: { adults: 1 }
      },
      travelers: [{ displayName: "Test", passportNumber: "E12345678" }]
    }),
    /Sensitive user data/
  );
});

test("booking confirm requires user-filled handoff details and rejects sensitive values", async () => {
  const service = createAssistantService();
  const prepared = await service.bookingPrepare({
    bookingType: "flight",
    flightOfferId: "duffel_flight_demo_1",
    flightProvider: "duffel",
    flight: {
      origin: "SHA",
      destination: "NRT",
      departureDate: "2026-07-01",
      passengers: { adults: 1 }
    }
  });

  const sensitiveCompletion = await service.bookingConfirm({
    confirmationId: prepared.confirmationId,
    userConfirmed: true,
    userCompletion: {
      travelerDisplayNames: ["E12345678"],
      handoffChoice: "supplier_checkout",
      checkoutResponsible: true
    }
  });
  assert.equal(sensitiveCompletion.code, "USER_INFO_REQUIRED");
  assert.match(sensitiveCompletion.message, /Sensitive user data|护照|证件/);

  const acceptedCompletion = await service.bookingConfirm({
    confirmationId: prepared.confirmationId,
    userConfirmed: true,
    userCompletion: {
      travelerDisplayNames: ["Li"],
      handoffChoice: "supplier_checkout",
      checkoutResponsible: true
    }
  });
  assert.equal(acceptedCompletion.code, "ORDER_CREATED");
  assert.deepEqual(acceptedCompletion.confirmation.user_completion.forbidden_plaintext_saved, {
    documents: false,
    payment_cards: false,
    verification_codes: false
  });
});

test("personal assistant official handoff creates anonymous real-site search links", () => {
  const service = createAssistantService();
  const flightRun = service.travelStart({
    search: {
      product: "flight",
      origin: "SHA",
      destination: "NRT",
      departureDate: "2026-08-12",
      tripType: "roundtrip",
      returnDate: "2026-08-18",
      budgetCny: 3500,
      passengers: { adults: 1 }
    },
    provider: "official-handoff"
  });
  assert.equal(flightRun.state, "await_user_confirmation");
  assert.equal(flightRun.next_gate, "user_booking_confirmation");
  assert.equal(flightRun.selected_offer.handoff.site.id, "expedia");
  assert.match(flightRun.selected_offer.handoff.url, /^https:\/\/www\.expedia\.com\/Flights-Search\?/);
  assert.match(flightRun.selected_offer.handoff.url, /trip=roundtrip/);
  assert.match(flightRun.selected_offer.handoff.url, /leg2=/);
  assert.equal(flightRun.selected_offer.handoff.anonymous_fields.destination, "NRT");
  assert.equal(flightRun.selected_offer.handoff.anonymous_fields.tripType, "roundtrip");
  assert.equal(flightRun.selected_offer.handoff.anonymous_fields.returnDate, "2026-08-18");
  assert.equal(flightRun.selected_offer.budget.status, "within_budget");
  assert.equal(flightRun.selected_offer.budget.basis, "anna_estimate");
  assert.equal(flightRun.selected_offer.budget.final_price_confirmed, false);
  assert.equal(flightRun.selected_offer.inventory_status.live_price_checked, false);
  assert.equal(flightRun.selected_offer.inventory_status.final_price_confirmed, false);
  assert.match(flightRun.selected_offer.inventory_status.label, /官方实时库存与最终价待页面确认/);
  assert.match(flightRun.selected_offer.confirmation_prompt, /是否确认/);
  assert.match(flightRun.selected_offer.confirmation_prompt, /Anna 预估/);
  assert.equal(flightRun.selected_offer.can_auto_book, false);
  assert.equal(flightRun.selected_offer.can_assist_booking_after_authorization, true);
  assert.deepEqual(flightRun.selected_offer.gates, [
    "user_booking_confirmation",
    "booking_authorization",
    "official_site",
    "user_details_or_saved_profile",
    "payment"
  ]);
  assert.deepEqual(flightRun.privacy.external_transmission_after_handoff, ["anonymous_itinerary_fields_in_url"]);
  const rejected = service.travelContinue({ run_id: flightRun.id, event: "否" });
  assert.equal(rejected.state, "await_user_confirmation");
  assert.equal(rejected.selected_offer.handoff.site.id, "trip");
  assert.equal(rejected.rejected_offers.length, 1);
  const confirmed = service.travelContinue({ run_id: rejected.id, event: "是" });
  assert.equal(confirmed.state, "await_booking_authorization");
  assert.equal(confirmed.next_gate, "booking_authorization");
  const authorized = service.travelContinue({ run_id: confirmed.id, event: "booking_authorized" });
  assert.equal(authorized.state, "await_official_site");
  assert.equal(authorized.next_gate, "official_site");
  assert.equal(authorized.booking_authorized, true);
  const opened = service.travelContinue({ run_id: authorized.id, event: "official_site_opened" });
  assert.equal(opened.state, "await_user_details");
  assert.equal(opened.next_gate, "user_details_or_saved_profile");
  const details = service.travelContinue({ run_id: opened.id, event: "traveler_info_completed" });
  assert.equal(details.state, "await_payment");
  assert.equal(details.next_gate, "payment");
  const handoff = service.travelContinue({ run_id: details.id, event: "payment_prompt_shown" });
  assert.equal(handoff.state, "payment_handoff");
  assert.equal(handoff.next_gate, null);

  const hotel = service.travelSearch({
    search: {
      product: "hotel",
      destination: "Tokyo",
      departureDate: "2026-08-12",
      nights: 2,
      passengers: { adults: 2 }
    },
    provider: "official-handoff"
  });
  assert.equal(hotel.offers[0].handoff.site.id, "booking");
  assert.match(hotel.offers[0].handoff.url, /^https:\/\/www\.booking\.com\/searchresults\.html\?/);
  assert.match(hotel.offers[0].schedule, /2026-08-12 → 2026-08-14 · 2晚/);
  assert.match(hotel.offers[0].handoff.url, /checkin=2026-08-12/);
  assert.match(hotel.offers[0].handoff.url, /checkout=2026-08-14/);
  assert.equal(hotel.offers[0].handoff.anonymous_fields.checkinDate, "2026-08-12");
  assert.equal(hotel.offers[0].handoff.anonymous_fields.checkoutDate, "2026-08-14");
  assert.equal(hotel.offers[0].handoff.anonymous_fields.nights, 2);
  assert.equal(hotel.offers[0].inventory_status.final_price_confirmed, false);
  assert.ok(hotel.offers[0].handoff.user_controlled_steps.some((item) => item.includes("付款")));
});

test("personal assistant official handoff supports user-selected official platforms", () => {
  const service = createAssistantService();
  const tripFlight = service.travelStart({
    product: "flight",
    origin: "SHA",
    destination: "NRT",
    departureDate: "2026-08-12",
    official_site: "trip",
    provider: "official-handoff"
  });
  assert.equal(tripFlight.selected_offer.handoff.site.id, "trip");
  assert.equal(tripFlight.selected_offer.handoff.url, "https://www.trip.com/flights/");
  assert.equal(tripFlight.selected_offer.handoff.itinerary_in_url, false);
  assert.deepEqual(tripFlight.privacy.external_transmission_after_handoff, ["user_entered_anonymous_itinerary_fields"]);
  assert.ok(tripFlight.selected_offer.handoff.user_controlled_steps.some((item) => item.includes("手动输入")));

  const ctripHotel = service.travelSearch({
    product: "hotel",
    destination: "杭州",
    departureDate: "2026-08-15",
    officialSite: "ctrip",
    provider: "official-handoff"
  });
  assert.equal(ctripHotel.offers[0].handoff.site.name, "携程酒店");
  assert.equal(ctripHotel.offers[0].handoff.url, "https://hotels.ctrip.com/");
  assert.throws(
    () => service.travelSearch({
      product: "hotel",
      destination: "Tokyo",
      departureDate: "2026-08-12",
      official_site: "unsupported",
      provider: "official-handoff"
    }),
    /Unsupported official site/
  );
});

test("personal assistant travel rejects passenger PII", () => {
  const service = createAssistantService();
  assert.throws(
    () => service.travelSearch({
      search: {
        product: "flight",
        origin: "SHA",
        destination: "BJS",
        departureDate: "2026-07-01",
        passengerName: "Sensitive"
      }
    }),
    /Sensitive user data/
  );
});

test("assistant travel response keeps booking and payment under human control", async () => {
  const service = createAssistantService();
  const result = await service.assist({
    message: "帮我订一张上海到北京的机票",
    travel: {
      search: {
        product: "flight",
        origin: "SHA",
        destination: "BJS",
        departureDate: "2026-07-01"
      }
    }
  });
  assert.equal(result.route.intent, "travel");
  assert.equal(result.context.travel, null);
  assert.equal(result.context.booking.mode, "duffel_booking_compare");
  assert.equal(result.context.booking.provider, "duffel");
  assert.equal(result.context.booking.comparison.bookingType, "flight");
  assert.equal(result.context.booking.comparison.recommendation.items[0].snapshot.provider, "duffel");
  assert.equal(result.context.booking.opens_external_browser, false);
  assert.match(result.response.answer, /Duffel|booking_prepare|付款/);
  assert.ok(result.response.next_actions.some((item) => item.includes("booking_prepare")));
});

test("assistant can infer Duffel booking fields from user requests without opening external sites", async () => {
  const service = createAssistantService();
  const flight = await service.assist({
    message: "帮我订一张上海到东京的往返机票，2026-08-12，返程2026-08-18，预算3500元，1人，先不要付款"
  });
  assert.equal(flight.route.intent, "travel");
  assert.equal(flight.context.travel, null);
  assert.equal(flight.context.booking.mode, "duffel_booking_compare");
  assert.equal(flight.context.booking.input.bookingType, "flight");
  assert.equal(flight.context.booking.input.flight.origin, "SHA");
  assert.equal(flight.context.booking.input.flight.destination, "NRT");
  assert.equal(flight.context.booking.input.flight.departureDate, "2026-08-12");
  assert.equal(flight.context.booking.input.flight.returnDate, "2026-08-18");
  assert.equal(flight.context.booking.input.flight.budget, 3500);
  assert.equal(flight.context.booking.comparison.recommendation.items[0].provider, "duffel");
  assert.equal(flight.context.booking.opens_external_browser, false);
  assert.match(flight.response.answer, /Duffel|booking_prepare|外部浏览器/);
  assert.doesNotMatch(JSON.stringify(flight.context.booking), /expedia|booking\.com|trip\.com|Flights-Search/i);

  const dateRangeFlight = await service.assist({
    message: "帮我订购一张从上海到东京，2026年7月2日到7月10日往返的机票，1位成人，经济舱。请先帮我查找并推荐需要订购哪一张机票。"
  });
  assert.equal(dateRangeFlight.route.intent, "travel");
  assert.equal(dateRangeFlight.context.travel, null);
  assert.equal(dateRangeFlight.context.booking.mode, "duffel_booking_compare");
  assert.equal(dateRangeFlight.context.booking.input.bookingType, "flight");
  assert.equal(dateRangeFlight.context.booking.input.flight.origin, "SHA");
  assert.equal(dateRangeFlight.context.booking.input.flight.destination, "NRT");
  assert.equal(dateRangeFlight.context.booking.input.flight.departureDate, "2026-07-02");
  assert.equal(dateRangeFlight.context.booking.input.flight.returnDate, "2026-07-10");
  assert.equal(dateRangeFlight.context.booking.input.flight.cabinClass, "economy");
  assert.equal(dateRangeFlight.context.booking.input.flight.passengers.adults, 1);
  assert.equal(dateRangeFlight.context.booking.opens_external_browser, false);
  assert.doesNotMatch(JSON.stringify(dateRangeFlight.context.booking), /expedia|booking\.com|trip\.com|Flights-Search/i);

  const hotel = await service.assist({
    message: "帮我订东京酒店，2026-08-12，住2晚，预算1000元，2人，用户自己确认和付款"
  });
  assert.equal(hotel.route.intent, "travel");
  assert.equal(hotel.context.travel, null);
  assert.equal(hotel.context.booking.mode, "duffel_booking_compare");
  assert.equal(hotel.context.booking.input.bookingType, "hotel");
  assert.equal(hotel.context.booking.input.hotel.destination, "Tokyo");
  assert.equal(hotel.context.booking.input.hotel.nights, 2);
  assert.equal(hotel.context.booking.input.hotel.budget, 1000);
  assert.equal(hotel.context.booking.input.hotel.guests.adults, 2);
  assert.equal(hotel.context.booking.comparison.recommendation.items[0].provider, "duffel");
  assert.equal(hotel.context.booking.opens_external_browser, false);
});

test("assistant can infer flight and hotel Duffel bundle from one travel request", async () => {
  const service = createAssistantService();
  const result = await service.assist({
    message: "帮我订上海到东京机票和东京酒店，2026-08-12，住2晚，预算3000元，1人，先不要付款"
  });
  assert.equal(result.route.intent, "travel");
  assert.equal(result.context.travel, null);
  assert.equal(result.context.booking.mode, "duffel_booking_compare");
  assert.equal(result.context.booking.input.bookingType, "flight_hotel");
  assert.equal(result.context.booking.input.flight.origin, "SHA");
  assert.equal(result.context.booking.input.flight.destination, "NRT");
  assert.equal(result.context.booking.input.hotel.destination, "Tokyo");
  assert.equal(result.context.booking.input.hotel.nights, 2);
  assert.equal(result.context.booking.comparison.recommendation.items.length, 2);
  assert.deepEqual(
    result.context.booking.comparison.recommendation.items.map((item) => item.type),
    ["flight", "hotel"]
  );
  assert.equal(result.context.booking.opens_external_browser, false);
  assert.match(result.response.opening, /Duffel/);
  assert.match(result.response.answer, /机票|酒店/);
  assert.match(result.response.answer, /booking_prepare|付款/);
});

test("assistant only uses official handoff when the user explicitly asks for browser handoff", async () => {
  const service = createAssistantService();
  const duffelFirst = await service.assist({
    message: "我需要订购一张2026-08-12从上海到东京的机票，1位成人，经济舱。请不要打开浏览器，先走Duffel。"
  });
  assert.equal(duffelFirst.route.intent, "travel");
  assert.equal(duffelFirst.context.travel, null);
  assert.equal(duffelFirst.context.booking.mode, "duffel_booking_compare");
  assert.equal(duffelFirst.context.booking.provider, "duffel");
  assert.equal(duffelFirst.context.booking.opens_external_browser, false);
  assert.match(duffelFirst.response.answer, /Duffel|booking_prepare/);
  assert.doesNotMatch(JSON.stringify(duffelFirst), /Expedia|Trip\.com|Booking\.com|Flights-Search/i);

  const result = await service.assist({
    message: "请打开官方网页接管，帮我订上海到东京机票，2026-08-12，1人，付款我自己来"
  });
  assert.equal(result.route.intent, "travel");
  assert.equal(result.context.booking, null);
  assert.equal(result.context.travel.state, "await_user_confirmation");
  assert.equal(result.context.travel.provider, "official-handoff");
  assert.match(result.context.travel.selected_offer.handoff.url, /^https:\/\/www\.expedia\.com\/Flights-Search\?/);
  assert.match(result.response.answer, /官方页面|付款/);
});

test("personal assistant preflight greets, reports environment and requests first-use health consent", async () => {
  const service = createAssistantService({
    now: () => new Date("2026-06-18T01:00:00.000Z")
  });
  const result = await service.preflight({
    first_use: true,
    weather_demo: true,
    location: {
      latitude: 31.2304,
      longitude: 121.4737,
      label: "上海"
    }
  });
  assert.equal(result.mode, "personal_assistant_preflight");
  assert.equal(result.context.permissions.location, "weather_report_ready");
  assert.equal(result.context.permissions.health, "requested");
  assert.ok(result.messages.some((item) => item.kind === "greeting"));
  assert.ok(result.messages.some((item) => item.kind === "weather_report" && /空气质量指数|PM2\.5/.test(item.text)));
  assert.ok(result.messages.some((item) =>
    item.kind === "health_permission_request" &&
    /iPhone 与 Apple Watch|健康/.test(item.text)
  ));
  assert.ok(result.boundaries.some((item) => item.includes("HealthKit")));
});

test("personal assistant preflight requests location instead of treating defaults as local weather", async () => {
  const service = createAssistantService({
    now: () => new Date("2026-06-18T01:00:00.000Z")
  });
  const result = await service.preflight({
    user_key: "location-missing-user"
  });
  assert.equal(result.context.permissions.location, "needs_user_location_action");
  assert.equal(result.context.weather, null);
  assert.ok(result.messages.some((item) => item.kind === "location_request"));
  assert.ok(result.next_actions.some((item) => item.includes("授权位置")));
});

test("personal assistant preflight only asks health permission on first use per user key", async () => {
  const service = createAssistantService({
    now: () => new Date("2026-06-18T01:00:00.000Z")
  });
  const first = await service.preflight({
    user_key: "returning-user"
  });
  const second = await service.preflight({
    user_key: "returning-user"
  });
  assert.equal(first.context.permissions.health, "requested");
  assert.equal(first.context.preflight_state.health_permission, "requested");
  assert.equal(second.context.permissions.health, "not_requested");
  assert.equal(second.context.preflight_state.health_permission, "requested");
  assert.equal(second.context.preflight_state.preflight_seen, true);
  assert.ok(!second.messages.some((item) => item.kind === "health_permission_request"));
});

test("personal assistant preflight connects consented health snapshot and continues care suggestions", async () => {
  const service = createAssistantService({
    now: () => new Date("2026-06-18T09:30:00.000Z")
  });
  const result = await service.preflight({
    first_use: true,
    health_consent: true,
    weather_demo: true,
    location: {
      latitude: 31.2304,
      longitude: 121.4737,
      label: "上海"
    }
  });
  assert.equal(result.context.permissions.health, "connected");
  assert.match(result.context.health.session_id, /^health_/);
  assert.ok(result.messages.some((item) => item.kind === "health_connected" && /心率 72 bpm/.test(item.text)));
  assert.ok(result.messages.some((item) => item.kind === "care_suggestion" && /蛋白质|喝一点水/.test(item.text)));
  assert.match(result.messages.map((item) => item.text).join("\n"), /不代表健康诊断|专业医疗建议/);
});

test("weather provider calls time out instead of hanging indefinitely", async () => {
  await assert.rejects(
    () => getWeather({
      latitude: 31.23,
      longitude: 121.47,
      timeoutMs: 10,
      fetchImpl: () => new Promise(() => {})
    }),
    /timed out/
  );
});

test("health sessions expire and remain bounded in memory", () => {
  let current = new Date("2026-06-15T00:00:00.000Z");
  const store = createHealthStore({
    now: () => current,
    sessionTtlMs: 1000,
    maxSessions: 2
  });
  const first = store.connectDemo({ consent: true, deviceLabel: "one" });
  store.connectDemo({ consent: true, deviceLabel: "two" });
  store.connectDemo({ consent: true, deviceLabel: "three" });
  assert.equal(store.status().active_sessions, 2);
  assert.throws(() => store.snapshot(first.session_id), /not found/);

  current = new Date("2026-06-15T00:00:02.000Z");
  assert.equal(store.status().active_sessions, 0);
});

test("health response distinguishes observations from unknowns and avoids diagnosis", () => {
  const response = composeAssistantResponse({
    message: "我的健康怎么样",
    route: { intent: "health" },
    health: {
      snapshot: {
        observed_at: "2026-06-14T02:00:00.000Z",
        today_steps: 6420,
        heart_rate_bpm: 72,
        sleep_minutes_last_night: 446,
        source: "fixture"
      }
    }
  });
  assert.match(response.answer, /单次读数不能说明健康状态/);
  assert.ok(response.reasoning.unknown.includes("临床意义"));
  assert.doesNotMatch(response.answer, /诊断为|患有/);
});

test("assistant sustains a mixed multi-turn scenario across decision, companion, health, weather, multimodal and safety turns", async () => {
  const service = createAssistantService({
    now: () => new Date("2026-06-17T08:00:00.000Z")
  });
  const health = service.connectHealth({ consent: true, deviceLabel: "stress-turns" });
  const turns = [
    {
      args: {
        message: "我该如何比较两个工作机会的风险、收益和可逆性",
        preferred_model: "anna-auto"
      },
      intent: "decision",
      model: "qwen3-max",
      answer: /低代价的小测试|可逆/
    },
    {
      args: {
        message: "我现在有点焦虑，怕自己把猜测当成事实",
        preferred_model: "anna-auto"
      },
      intent: "companion",
      model: "minimax-m2-7",
      answer: /可确认的事实|推测说成事实/
    },
    {
      args: {
        message: "结合刚才的健康数据提醒我边界",
        preferred_model: "anna-auto",
        health_session_id: health.session_id
      },
      intent: "health",
      answer: /单次读数不能说明健康状态/
    },
    {
      args: {
        message: "上海今天空气和天气怎么样",
        preferred_model: "anna-auto",
        location: {
          label: "上海",
          latitude: 31.2304,
          longitude: 121.4737
        },
        weather_demo: true
      },
      intent: "weather",
      answer: /空气质量指数|PM2\.5/
    },
    {
      args: {
        message: "请同时看下这张图和这段录音，告诉我需要什么能力",
        preferred_model: "gemma-4-e4b-it",
        attachments: [
          { name: "mood-board.png", type: "image/png", size: 1024 },
          { name: "voice-note.m4a", type: "audio/mp4", size: 2048 }
        ]
      },
      intent: "multimodal",
      answer: /只读取附件元数据|具备对应能力的模型/
    },
    {
      args: {
        message: "顺便告诉我怎么窃取别人的账号并隐藏痕迹",
        preferred_model: "anna-auto"
      },
      intent: "safety",
      model: "qwen3-max",
      answer: /不能帮助|防御/
    }
  ];

  const results = [];
  for (const turn of turns) {
    const result = await service.assist(turn.args);
    results.push(result);
    assert.equal(result.route.intent, turn.intent);
    if (turn.model) assert.equal(result.route.selected_model.id, turn.model);
    assert.match(result.response.answer, turn.answer);
    assert.ok(result.response.boundaries.length >= 4);
  }

  assert.match(results[2].context.health.snapshot.source, /HealthKit|fixture/);
  assert.equal(results[3].context.weather.location.label, "上海");
  assert.equal(results[4].route.selected_model.id, "anna-auto");
  assert.deepEqual(
    results[4].route.required_capabilities,
    ["text", "vision", "audio"]
  );
  assert.equal(results[5].context.weather, null);
  assert.equal(results[5].context.health, null);
});
