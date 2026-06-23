import { randomUUID } from "node:crypto";
import { createProviderRegistry } from "./providers/index.js";

const BOOKING_TYPES = new Set(["flight", "hotel", "flight_hotel"]);
const ITEM_TYPES = new Set(["flight", "hotel"]);
const CONFIRMATION_TTL_MS = 15 * 60 * 1000;
const SENSITIVE_KEY_PATTERN = /passport|document|identity|id.?card|national.?id|bank|card|cvv|cvc|payment|password|secret|token|证件|身份证|护照|银行卡|卡号|验证码|支付密码/i;
const SENSITIVE_VALUE_PATTERN = /\b(?:\d[ -]*?){13,19}\b|\b[A-Z]\d{7,9}\b|\b1[3-9]\d{9}\b/i;
const USER_HANDOFF_CHOICES = new Set(["supplier_checkout", "saved_supplier_profile"]);

export function createBookingStore({
  now = () => new Date(),
  maxConfirmations = 128,
  providers = createProviderRegistry({ now }),
  safetyState = null
} = {}) {
  const confirmations = new Map();
  const limit = Math.max(1, Number(maxConfirmations) || 128);

  function prune() {
    while (confirmations.size >= limit) {
      confirmations.delete(confirmations.keys().next().value);
    }
  }

  return {
    status() {
      return {
        booking_types: [...BOOKING_TYPES],
        status_values: ["PENDING", "ORDER_CREATED", "USER_CHECKOUT_REQUIRED", "EXPIRED", "CANCELLED"],
        confirmation_ttl_minutes: Math.round(CONFIRMATION_TTL_MS / 60000),
        active_confirmations: confirmations.size,
        providers: providers.list(),
        storage: "memory_only_for_local_preview",
        database_table: "booking_confirmations",
        auto_payment: false,
        requires_human_confirmation: true,
        order_creation: "explicit_user_confirmation_required",
        confirmation_queue: safetyState?.status?.().confirmation_queue || null,
        sensitive_plaintext_storage: false
      };
    },

    async searchFlights(args = {}) {
      const providerId = args.provider || "duffel";
      const provider = providers.get(providerId, "flight");
      const result = normalizeOfferResult(await provider.searchFlightOffers(args.criteria || args.search || args));
      return {
        type: "flight",
        provider: providerId,
        offers: result.offers,
        resultCode: result.resultCode,
        message: result.message,
        supplier_no_result: result.supplier_no_result,
        invalid_search_params: result.invalid_search_params,
        route_maybe_unsupported: result.route_maybe_unsupported,
        supplier_error: result.supplier_error,
        rate_limited: result.rate_limited,
        privacy: bookingPrivacy()
      };
    },

    async searchHotels(args = {}) {
      const providerId = args.provider || "duffel";
      const provider = providers.get(providerId, "hotel");
      const result = normalizeOfferResult(await provider.searchHotelOffers(args.criteria || args.search || args));
      return {
        type: "hotel",
        provider: providerId,
        offers: result.offers,
        resultCode: result.resultCode,
        message: result.message,
        supplier_no_result: result.supplier_no_result,
        invalid_search_params: result.invalid_search_params,
        route_maybe_unsupported: result.route_maybe_unsupported,
        supplier_error: result.supplier_error,
        rate_limited: result.rate_limited,
        privacy: bookingPrivacy()
      };
    },

    async compare(args = {}) {
      const bookingType = normalizeBookingType(args.bookingType || args.booking_type || "flight_hotel");
      const flightProvider = args.flightProvider || args.flight_provider || args.provider || "duffel";
      const hotelProvider = args.hotelProvider || args.hotel_provider || args.provider || "duffel";
      const flightCriteria = args.flight || args.flightCriteria || args.flight_criteria;
      const hotelCriteria = args.hotel || args.hotelCriteria || args.hotel_criteria;
      const [flights, hotels] = await Promise.all([
        bookingType !== "hotel" ? this.searchFlights({ provider: flightProvider, ...(flightCriteria || {}) }) : null,
        bookingType !== "flight" ? this.searchHotels({ provider: hotelProvider, ...(hotelCriteria || {}) }) : null
      ]);
      const bundles = buildComparisonBundles({ bookingType, flights, hotels });
      return {
        bookingType,
        flights,
        hotels,
        bundles,
        recommendation: bundles[0] || null,
        privacy: bookingPrivacy()
      };
    },

    async prepare(args = {}) {
      assertNoSensitiveData(args, "prepare");
      prune();
      const bookingType = normalizeBookingType(args.bookingType || args.booking_type);
      const items = normalizePrepareItems(args, bookingType);
      const travelers = sanitizeTravelers(args.travelers || args.travelerInfo || args.traveler_info, args);
      const snapshots = await Promise.all(items.map((item) => fetchLatestSnapshot(item, providers)));
      validateSnapshots({ bookingType, items, snapshots, travelers });
      const totals = totalForSnapshots(snapshots);
      const createdAt = now();
      const confirmation = {
        id: `bc_${randomUUID().replace(/-/g, "")}`,
        user_id: normalizeUserId(args.userId || args.user_id),
        booking_type: bookingType,
        flight_offer_id: firstItem(items, "flight")?.offerId || null,
        hotel_offer_id: firstItem(items, "hotel")?.offerId || null,
        items: snapshots.map((snapshot, index) => ({
          type: items[index].type,
          provider: items[index].provider,
          offer_id: items[index].offerId,
          snapshot
        })),
        flight_snapshot: snapshots.find((snapshot) => snapshot.type === "flight") || null,
        hotel_snapshot: snapshots.find((snapshot) => snapshot.type === "hotel") || null,
        traveler_snapshot: travelers,
        total_currency: totals.currency,
        total_amount: totals.amount.toFixed(2),
        status: "PENDING",
        expires_at: new Date(createdAt.getTime() + CONFIRMATION_TTL_MS).toISOString(),
        created_at: createdAt.toISOString(),
        provider_order_id: null,
        provider_booking_id: null,
        order_information: null,
        user_completion: null,
        confirmation_queue_id: null,
        payment_policy: paymentPolicy(),
        safety_checks: [
          "offer_revalidated",
          "price_and_inventory_checked",
          "human_confirmation_required",
          "confirmation_queue_recorded",
          "provider_order_creation_requires_explicit_confirmation",
          "no_payment_collected",
          "sensitive_documents_rejected"
        ]
      };
      if (safetyState) {
        const queueItem = safetyState.requestConfirmation({
          kind: "booking_review",
          permissionId: "booking.prepare_confirmation",
          riskLevel: "high",
          summary: `${bookingType} booking review ${confirmation.id}: ${confirmation.total_amount} ${confirmation.total_currency}`,
          requiredHumanAction: "Review price, inventory, baggage/room policy, cancellation/change terms, and confirm only inside the Anna confirmation page.",
          payloadRef: confirmation
        });
        confirmation.confirmation_queue_id = queueItem.id;
      }
      confirmations.set(confirmation.id, confirmation);
      return {
        confirmationId: confirmation.id,
        confirmation: publicConfirmation(confirmation),
        order_snapshot: publicConfirmation(confirmation)
      };
    },

    getConfirmation(args = {}) {
      const confirmation = requiredConfirmation(confirmations, args.confirmationId || args.confirmation_id || args.id);
      return publicConfirmation(refreshExpiry(confirmation, now));
    },

    async confirm(args = {}) {
      const confirmation = requiredConfirmation(confirmations, args.confirmationId || args.confirmation_id || args.id);
      refreshExpiry(confirmation, now);
      if (confirmation.status === "EXPIRED") {
        return {
          status: "EXPIRED",
          code: "EXPIRED",
          message: "booking confirmation has expired"
        };
      }
      if (confirmation.status !== "PENDING") {
        return {
          status: confirmation.status,
          code: "INVALID_STATUS",
          message: `booking confirmation is ${confirmation.status}`,
          confirmation: publicConfirmation(confirmation)
        };
      }
      const latestSnapshots = await Promise.all(confirmation.items.map((item) =>
        fetchLatestSnapshot({
          type: item.type,
          provider: item.provider,
          offerId: item.offer_id,
          criteria: snapshotCriteria(item.snapshot)
        }, providers)
      ));
      const availabilityProblem = latestSnapshots.find((snapshot) => !snapshot.available);
      if (availabilityProblem) {
        return {
          status: "UNAVAILABLE",
          code: "UNAVAILABLE",
          latest_snapshot: latestSnapshots,
          message: "one or more offers are no longer available"
        };
      }
      const latestTotal = totalForSnapshots(latestSnapshots);
      if (latestTotal.currency !== confirmation.total_currency ||
          latestTotal.amount.toFixed(2) !== confirmation.total_amount) {
        return {
          status: "PRICE_CHANGED",
          code: "PRICE_CHANGED",
          latest_snapshot: latestSnapshots,
          previous_total: {
            currency: confirmation.total_currency,
            amount: confirmation.total_amount
          },
          latest_total: {
            currency: latestTotal.currency,
            amount: latestTotal.amount.toFixed(2)
          },
          message: "price changed; user must review a new confirmation"
        };
      }
      if (args.userConfirmed !== true) {
        if (args.userConfirmed === false && safetyState && confirmation.confirmation_queue_id) {
          safetyState.resolveConfirmation({
            id: confirmation.confirmation_queue_id,
            decision: "rejected",
            actor: "anna_confirmation_page"
          });
        }
        return {
          status: "PENDING",
          code: "USER_CONFIRMATION_REQUIRED",
          confirmation: publicConfirmation(confirmation),
          order_results: [],
          checkout_handoff_queue_id: null,
          message: "必须先在 Anna 确认页完成显式用户确认，才可以创建供应商订单记录或进入 checkout handoff。",
          payment_policy: paymentPolicy()
        };
      }
      const userCompletion = sanitizeUserCompletion(args.userCompletion || args.user_completion, confirmation, now);
      if (userCompletion.error) {
        return {
          status: "PENDING",
          code: "USER_INFO_REQUIRED",
          confirmation: publicConfirmation(confirmation),
          order_results: [],
          checkout_handoff_queue_id: null,
          message: userCompletion.error,
          payment_policy: paymentPolicy()
        };
      }
      confirmation.user_completion = userCompletion;
      if (safetyState && confirmation.confirmation_queue_id) {
        safetyState.resolveConfirmation({
          id: confirmation.confirmation_queue_id,
          decision: "approved",
          actor: "anna_confirmation_page"
        });
      }
      const wantsProviderOrder = args.createProviderOrder !== false && args.create_provider_order !== false;
      if (!wantsProviderOrder) {
        const handoffQueueItem = safetyState?.requestConfirmation?.({
          kind: "external_checkout_handoff",
          permissionId: "booking.create_order",
          riskLevel: "critical",
          summary: `Supplier order creation was deferred for ${confirmation.id}; user must complete checkout under user control.`,
          requiredHumanAction: "Open the supplier or official checkout under user control. Anna must not handle payment.",
          payloadRef: confirmation
        }) || null;
        confirmation.status = "USER_CHECKOUT_REQUIRED";
        confirmation.provider_order_id = null;
        confirmation.provider_booking_id = null;
        confirmation.order_results = [];
        confirmation.order_information = null;
        confirmation.checkout_handoff_queue_id = handoffQueueItem?.id || null;
        confirmation.updated_at = now().toISOString();
        confirmations.set(confirmation.id, confirmation);
        return {
          status: "USER_CHECKOUT_REQUIRED",
          code: "USER_CHECKOUT_REQUIRED",
          confirmation: publicConfirmation(confirmation),
          order_results: [],
          checkout_handoff_queue_id: confirmation.checkout_handoff_queue_id,
          message: "Anna 已完成价格/库存复核并记录人工确认；本次调用显式选择不创建供应商订单，后续 checkout 由用户本人控制。",
          payment_policy: paymentPolicy()
        };
      }

      safetyState?.assertAllowed?.("booking.create_order");
      const orderResults = await createProviderOrders({ confirmation, providers });
      confirmation.status = "ORDER_CREATED";
      confirmation.provider_order_id = orderResults.map((item) => item.provider_order_id).filter(Boolean).join(",") || null;
      confirmation.provider_booking_id = orderResults.map((item) => item.provider_booking_id).filter(Boolean).join(",") || null;
      confirmation.order_results = orderResults;
      confirmation.order_information = buildOrderInformation({ confirmation, orderResults });
      confirmation.checkout_handoff_queue_id = null;
      confirmation.updated_at = now().toISOString();
      confirmations.set(confirmation.id, confirmation);
      return {
        status: "ORDER_CREATED",
        code: "ORDER_CREATED",
        confirmation: publicConfirmation(confirmation),
        order_results: orderResults,
        order_information: confirmation.order_information,
        checkout_handoff_queue_id: null,
        message: "Anna 已完成价格/库存复核并在供应商侧创建订单记录；付款、证件、登录、验证码和最终出票仍必须由用户本人完成。",
        payment_policy: paymentPolicy()
      };
    }
  };
}

async function createProviderOrders({ confirmation, providers }) {
  const groups = new Map();
  for (const item of confirmation.items) {
    const key = item.provider;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  const results = [];
  for (const [providerId, items] of groups.entries()) {
    const provider = providers.get(providerId, items[0].type);
    if (typeof provider.createOrder !== "function") {
      throw new Error(`provider ${providerId} does not support order creation`);
    }
    const result = await provider.createOrder({
      confirmationId: confirmation.id,
      items,
      confirmation: publicConfirmation(confirmation)
    });
    results.push({
      provider: providerId,
      provider_order_id: result.provider_order_id || null,
      provider_booking_id: result.provider_booking_id || null,
      order_reference: result.order_reference || result.provider_order_id || null,
      order_url: result.order_url || result.provider_order_url || null,
      order_type: result.order_type || "order",
      order_status: result.order_status || result.status || "created",
      next_required_action: result.next_required_action || "user_controlled_checkout_for_identity_payment_and_ticketing",
      payment_required: result.payment_required !== false,
      payment_collected_by_anna: false,
      test_mode: result.test_mode === true,
      raw_status: result.status || result.payment_status || null
    });
  }
  return results;
}

function buildOrderInformation({ confirmation, orderResults }) {
  const primary = orderResults[0] || {};
  return {
    confirmation_id: confirmation.id,
    status: "ORDER_CREATED",
    booking_type: confirmation.booking_type,
    provider_order_id: confirmation.provider_order_id,
    provider_booking_id: confirmation.provider_booking_id,
    provider_order_url: primary.order_url || null,
    provider_order_reference: primary.order_reference || primary.provider_order_id || null,
    user_completion: confirmation.user_completion || null,
    total_currency: confirmation.total_currency,
    total_amount: confirmation.total_amount,
    payment_required: orderResults.some((item) => item.payment_required !== false),
    payment_collected_by_anna: false,
    ticketing_completed_by_anna: false,
    traveler_identity_collected_by_anna: false,
    next_required_action: "user_must_open_order_or_checkout_to_enter_traveler_identity_payment_and_final_ticketing",
    order_results: orderResults
  };
}

function normalizeBookingType(value) {
  const type = String(value || "").trim().toLowerCase();
  if (!BOOKING_TYPES.has(type)) throw new Error(`Unsupported bookingType: ${value}`);
  return type;
}

function normalizePrepareItems(args, bookingType) {
  const explicitItems = Array.isArray(args.items) ? args.items : [];
  const items = explicitItems.map(normalizeItem);
  if (args.flightOfferId || args.flight_offer_id) {
    items.push(normalizeItem({
      type: "flight",
      provider: args.flightProvider || args.flight_provider || args.provider || "duffel",
      offerId: args.flightOfferId || args.flight_offer_id,
      criteria: args.flight || args.flightCriteria || args.flight_criteria
    }));
  }
      if (args.hotelOfferId || args.hotel_offer_id) {
    items.push(normalizeItem({
      type: "hotel",
      provider: args.hotelProvider || args.hotel_provider || args.provider || "duffel",
      offerId: args.hotelOfferId || args.hotel_offer_id,
      criteria: args.hotel || args.hotelCriteria || args.hotel_criteria
    }));
  }
  const requiredTypes = bookingType === "flight_hotel" ? ["flight", "hotel"] : [bookingType];
  for (const type of requiredTypes) {
    if (!items.some((item) => item.type === type)) {
      throw new Error(`${type} offer is required for ${bookingType}`);
    }
  }
  return items.filter((item) => requiredTypes.includes(item.type));
}

function normalizeItem(item = {}) {
  const type = String(item.type || item.itemType || item.item_type || "").toLowerCase();
  if (!ITEM_TYPES.has(type)) throw new Error(`Unsupported booking item type: ${type}`);
  const provider = String(item.provider || "").toLowerCase();
  if (!provider) throw new Error(`provider is required for ${type}`);
  const offerId = String(item.offerId || item.offer_id || item.id || "").trim();
  if (!offerId) throw new Error(`offerId is required for ${type}`);
  return {
    type,
    provider,
    offerId,
    criteria: item.criteria || item.search || {}
  };
}

async function fetchLatestSnapshot(item, providers) {
  const provider = providers.get(item.provider, item.type);
  if (item.type === "flight") {
    return provider.getFlightOffer(item.offerId, item.criteria || {});
  }
  return provider.getHotelOffer(item.offerId, item.criteria || {});
}

function validateSnapshots({ bookingType, snapshots, travelers }) {
  const types = new Set(snapshots.map((snapshot) => snapshot.type));
  if (bookingType === "flight_hotel" && (!types.has("flight") || !types.has("hotel"))) {
    throw new Error("flight_hotel requires both flight and hotel snapshots");
  }
  if (bookingType !== "flight_hotel" && !types.has(bookingType)) {
    throw new Error(`${bookingType} snapshot is missing`);
  }
  if (snapshots.some((snapshot) => !snapshot.available)) {
    throw new Error("offer is no longer available");
  }
  const maxCapacity = Math.min(...snapshots.map((snapshot) =>
    snapshot.available_seats || snapshot.available_rooms || Number.POSITIVE_INFINITY
  ));
  if (Number.isFinite(maxCapacity) && travelers.count > maxCapacity) {
    throw new Error("traveler count exceeds current inventory");
  }
}

function totalForSnapshots(snapshots) {
  const currency = snapshots[0]?.price?.currency || "CNY";
  let amount = 0;
  for (const snapshot of snapshots) {
    if (snapshot.price?.currency !== currency) {
      throw new Error("mixed currencies are not supported in this phase");
    }
    amount += Number(snapshot.price.total_amount || 0);
  }
  return { currency, amount };
}

function sanitizeTravelers(input, args) {
  const list = Array.isArray(input) ? input : [];
  const fallbackCount = Number(args.adults || args.passengers?.adults || args.guests?.adults || 1);
  const count = Math.max(1, Math.min(9, list.length || fallbackCount || 1));
  const travelers = Array.from({ length: count }, (_, index) => {
    const traveler = list[index] || {};
    return {
      label: `旅客/住客 ${index + 1}`,
      type: String(traveler.type || "adult").slice(0, 24),
      display_name: maskName(traveler.displayName || traveler.display_name || traveler.name),
      document_status: "not_collected_by_anna",
      payment_status: "not_collected_by_anna"
    };
  });
  return {
    count,
    travelers,
    sensitive_fields_saved: false,
    plaintext_documents_saved: false,
    plaintext_payment_saved: false
  };
}

function sanitizeUserCompletion(input, confirmation, now) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { error: "请先在 Anna App 确认页由你本人填写旅客/住客展示名，并选择后续资料填写方式。" };
  }
  try {
    assertNoSensitiveData(input, "userCompletion");
  } catch (error) {
    return { error: error.message };
  }
  const count = Math.max(1, Number(confirmation.traveler_snapshot?.count || 1));
  const names = input.travelerDisplayNames || input.traveler_display_names || [];
  if (!Array.isArray(names) || names.length < count) {
    return { error: "请为每位乘客/住客填写展示名或称呼；不要在 Anna App 中填写证件号、手机号、银行卡或验证码。" };
  }
  const displayNames = names.slice(0, count).map((name) => String(name || "").trim());
  if (displayNames.some((name) => !name)) {
    return { error: "请为每位乘客/住客填写展示名或称呼；真实证件信息仍需在供应商/官方 checkout 页面由你本人填写。" };
  }
  const handoffChoice = String(input.handoffChoice || input.handoff_choice || "").trim();
  if (!USER_HANDOFF_CHOICES.has(handoffChoice)) {
    return { error: "请选择后续资料填写方式：供应商 checkout 本人填写，或使用供应商账户已保存资料。" };
  }
  if (input.checkoutResponsible !== true && input.checkout_responsible !== true) {
    return { error: "请确认真实姓名、证件、联系方式、付款信息和验证码都由你本人在供应商/官方页面完成。" };
  }
  return {
    traveler_count: count,
    traveler_display_names: displayNames.map(maskName),
    handoff_choice: handoffChoice,
    checkout_responsible: true,
    forbidden_plaintext_saved: {
      documents: false,
      payment_cards: false,
      verification_codes: false
    },
    completed_at: now().toISOString()
  };
}

function maskName(value) {
  if (!value) return "未填写";
  const text = String(value).trim();
  if (text.length <= 1) return "*";
  return `${text.slice(0, 1)}${"*".repeat(Math.min(4, text.length - 1))}`;
}

function assertNoSensitiveData(value, path) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoSensitiveData(item, `${path}[${index}]`));
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, nested] of Object.entries(value)) {
      if (SENSITIVE_KEY_PATTERN.test(key)) {
        throw new Error(`Sensitive user data is not accepted before provider checkout: ${path}.${key}`);
      }
      assertNoSensitiveData(nested, `${path}.${key}`);
    }
    return;
  }
  if (typeof value === "string" && SENSITIVE_VALUE_PATTERN.test(value)) {
    throw new Error(`Sensitive user data is not accepted before provider checkout: ${path}`);
  }
}

function publicConfirmation(confirmation) {
  return clone({
    id: confirmation.id,
    user_id: confirmation.user_id,
    booking_type: confirmation.booking_type,
    flight_offer_id: confirmation.flight_offer_id,
    hotel_offer_id: confirmation.hotel_offer_id,
    flight_snapshot: confirmation.flight_snapshot,
    hotel_snapshot: confirmation.hotel_snapshot,
    traveler_snapshot: confirmation.traveler_snapshot,
    user_completion: confirmation.user_completion || null,
    total_currency: confirmation.total_currency,
    total_amount: confirmation.total_amount,
    status: confirmation.status,
    expires_at: confirmation.expires_at,
    created_at: confirmation.created_at,
    provider_order_id: confirmation.provider_order_id,
    provider_booking_id: confirmation.provider_booking_id,
    order_information: confirmation.order_information || null,
    confirmation_queue_id: confirmation.confirmation_queue_id,
    checkout_handoff_queue_id: confirmation.checkout_handoff_queue_id || null,
    order_results: confirmation.order_results || [],
    payment_policy: confirmation.payment_policy,
    safety_checks: confirmation.safety_checks
  });
}

function refreshExpiry(confirmation, now) {
  if (confirmation.status === "PENDING" && Date.parse(confirmation.expires_at) <= now().getTime()) {
    confirmation.status = "EXPIRED";
  }
  return confirmation;
}

function requiredConfirmation(confirmations, id) {
  const confirmation = confirmations.get(String(id || ""));
  if (!confirmation) throw new Error(`Booking confirmation not found: ${id}`);
  return confirmation;
}

function buildComparisonBundles({ bookingType, flights, hotels }) {
  if (bookingType === "flight") return (flights?.offers || []).map((flight) => bundleFor([flight]));
  if (bookingType === "hotel") return (hotels?.offers || []).map((hotel) => bundleFor([hotel]));
  const bundles = [];
  for (const flight of flights?.offers || []) {
    for (const hotel of hotels?.offers || []) {
      bundles.push(bundleFor([flight, hotel]));
    }
  }
  return bundles.sort((a, b) => b.score - a.score);
}

function bundleFor(items) {
  const total = totalForSnapshots(items);
  return {
    id: stableBundleId(items),
    items: items.map((snapshot) => ({
      type: snapshot.type,
      provider: snapshot.provider,
      offerId: snapshot.id,
      snapshot
    })),
    total_currency: total.currency,
    total_amount: total.amount.toFixed(2),
    score: items.reduce((sum, item) => sum + (item.comparison_score || 0), 0),
    summary: items.map(summaryForSnapshot).join(" + ")
  };
}

function summaryForSnapshot(snapshot) {
  if (snapshot.type === "flight") {
    return `${snapshot.provider} ${snapshot.origin}-${snapshot.destination} ${snapshot.price.total_amount} ${snapshot.price.currency}`;
  }
  return `${snapshot.provider} ${snapshot.hotel_name} ${snapshot.price.total_amount} ${snapshot.price.currency}`;
}

function stableBundleId(items) {
  return `bundle_${items.map((item) => item.id).join("_").replace(/[^\w]+/g, "_").slice(0, 90)}`;
}

function firstItem(items, type) {
  return items.find((item) => item.type === type);
}

function snapshotCriteria(snapshot) {
  if (snapshot.type === "flight") {
    return {
      origin: snapshot.origin,
      destination: snapshot.destination,
      departureDate: snapshot.departure_date,
      returnDate: snapshot.return_date,
      cabinClass: snapshot.cabin_class,
      passengers: { adults: snapshot.passenger_count || 1 }
    };
  }
  return {
    destination: snapshot.location?.city,
    hotelLocation: snapshot.location?.area,
    checkinDate: snapshot.checkin_date,
    checkoutDate: snapshot.checkout_date,
    nights: snapshot.nights,
    guests: snapshot.guests,
    rooms: snapshot.rooms
  };
}

function normalizeOfferResult(value) {
  if (Array.isArray(value)) {
    return {
      offers: value,
      resultCode: value.length ? "ok" : "supplier_no_result",
      message: value.length ? null : "当前通过 Duffel 没有查到可预订报价。",
      supplier_no_result: value.length === 0,
      invalid_search_params: false,
      route_maybe_unsupported: false,
      supplier_error: false,
      rate_limited: false
    };
  }
  const offers = Array.isArray(value?.offers) ? value.offers : [];
  const resultCode = value?.resultCode || (offers.length ? "ok" : "supplier_no_result");
  return {
    offers,
    resultCode,
    message: value?.message || (offers.length ? null : "当前通过 Duffel 没有查到可预订报价。"),
    supplier_no_result: Boolean(value?.supplier_no_result || resultCode === "supplier_no_result"),
    invalid_search_params: Boolean(value?.invalid_search_params || resultCode === "invalid_search_params"),
    route_maybe_unsupported: Boolean(value?.route_maybe_unsupported || resultCode === "route_maybe_unsupported"),
    supplier_error: Boolean(value?.supplier_error || resultCode === "supplier_error"),
    rate_limited: Boolean(value?.rate_limited || resultCode === "rate_limited")
  };
}

function normalizeUserId(value) {
  return String(value || "local-user")
    .trim()
    .replace(/[^\w:.-]/g, "_")
    .slice(0, 120) || "local-user";
}

function paymentPolicy() {
  return {
    auto_payment: false,
    payment_collected_by_anna: false,
    card_storage: "forbidden",
    order_creation_by_anna: true,
    requires_explicit_user_confirmation: true,
    message: "Anna 可在用户逐项确认后创建供应商订单记录；不会自动付款，不保存银行卡、CVV、证件号或验证码。"
  };
}

function bookingPrivacy() {
  return {
    requires_human_confirmation: true,
    auto_payment: false,
    pii_documents_accepted: false,
    payment_cards_accepted: false,
    provider_mode: "sandbox/test"
  };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}
