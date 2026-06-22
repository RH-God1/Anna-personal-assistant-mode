import { randomUUID } from "node:crypto";

const PRODUCTS = new Set(["flight", "hotel"]);
const HUMAN_GATES = {
  sandbox: ["traveler_info", "order_confirmation", "payment"],
  "official-handoff": [
    "user_booking_confirmation",
    "booking_authorization",
    "official_site",
    "user_details_or_saved_profile",
    "payment"
  ]
};
const OFFICIAL_SITES = {
  flight: [
    {
      id: "expedia",
      name: "Expedia Flights",
      origin: "https://www.expedia.com",
      home: "https://www.expedia.com/Flights",
      deep_link: "expedia-flight-search"
    },
    {
      id: "trip",
      name: "Trip.com Flights",
      origin: "https://www.trip.com",
      home: "https://www.trip.com/flights/"
    },
    {
      id: "ctrip",
      name: "携程机票",
      origin: "https://flights.ctrip.com",
      home: "https://flights.ctrip.com/"
    }
  ],
  hotel: [
    {
      id: "booking",
      name: "Booking.com",
      origin: "https://www.booking.com",
      home: "https://www.booking.com/",
      deep_link: "booking-hotel-search"
    },
    {
      id: "trip",
      name: "Trip.com Hotels",
      origin: "https://www.trip.com",
      home: "https://www.trip.com/hotels/"
    },
    {
      id: "ctrip",
      name: "携程酒店",
      origin: "https://hotels.ctrip.com",
      home: "https://hotels.ctrip.com/"
    },
    {
      id: "expedia",
      name: "Expedia Hotels",
      origin: "https://www.expedia.com",
      home: "https://www.expedia.com/Hotels"
    }
  ]
};

export function createTravelStore({ now = () => new Date(), maxRuns = 32 } = {}) {
  const runs = new Map();
  const limit = Math.max(1, Number(maxRuns) || 32);

  function pruneForLimit() {
    while (runs.size >= limit) {
      runs.delete(runs.keys().next().value);
    }
  }

  return {
    search(args = {}) {
      assertNoPii(args);
      return searchTravel(args);
    },

    start(args = {}) {
      assertNoPii(args);
      pruneForLimit();
      const result = searchTravel(args);
      const offer = result.offers[0];
      const official = result.provider === "official-handoff";
      const timestamp = now().toISOString();
      const run = {
        id: `travel_${randomUUID().replace(/-/g, "")}`,
        created_at: timestamp,
        updated_at: timestamp,
        product: result.query.product,
        provider: result.provider,
        query: result.query,
        selected_offer: offer,
        state: official ? "await_user_confirmation" : "await_traveler_info",
        next_gate: official ? "user_booking_confirmation" : "traveler_info",
        booking_authorized: false,
        attempt_index: 0,
        rejected_offers: [],
        events: [{
          type: "human_gate",
          gate: official ? "user_booking_confirmation" : "traveler_info",
          at: timestamp
        }],
        privacy: result.privacy
      };
      runs.set(run.id, run);
      return clone(run);
    },

    continue(runId, event) {
      const run = requiredRun(runs, runId);
      const normalizedEvent = normalizeEvent(event);
      if (run.state === "await_user_confirmation" && normalizedEvent === "candidate_rejected") {
        return rotateOfficialCandidate(run, now);
      }
      const transitions = {
        "await_traveler_info:traveler_info_completed": {
          state: "await_order_confirmation",
          next_gate: "order_confirmation"
        },
        "await_order_confirmation:order_confirmed": {
          state: "await_payment",
          next_gate: "payment"
        },
        "await_payment:payment_completed": {
          state: "post_payment",
          next_gate: null
        },
        "await_user_confirmation:booking_confirmed": {
          state: "await_booking_authorization",
          next_gate: "booking_authorization"
        },
        "await_booking_authorization:booking_authorized": {
          state: "await_official_site",
          next_gate: "official_site"
        },
        "await_official_site:official_site_opened": {
          state: "await_user_details",
          next_gate: "user_details_or_saved_profile"
        },
        "await_user_details:traveler_info_completed": {
          state: "await_payment",
          next_gate: "payment"
        },
        "await_user_details:saved_traveler_selected": {
          state: "await_payment",
          next_gate: "payment"
        },
        "await_payment:payment_prompt_shown": {
          state: "payment_handoff",
          next_gate: null
        }
      };
      const transition = transitions[`${run.state}:${normalizedEvent}`];
      if (!transition) {
        const error = new Error(`Event ${event} is not allowed while run is in state ${run.state}.`);
        error.code = "invalid_transition";
        throw error;
      }
      run.state = transition.state;
      run.next_gate = transition.next_gate;
      if (normalizedEvent === "booking_authorized") run.booking_authorized = true;
      run.updated_at = now().toISOString();
      run.events.push({ type: "user_confirmed", event: normalizedEvent, at: run.updated_at });
      return clone(run);
    },

    get(runId) {
      return clone(requiredRun(runs, runId));
    },

    status() {
      return {
        products: [...PRODUCTS],
        active_runs: runs.size,
        max_runs: limit,
        providers: ["sandbox", "official-handoff"],
        official_sites: clone(OFFICIAL_SITES),
        human_gates: HUMAN_GATES,
        pii_accepted: false,
        auto_book: false,
        auto_pay: false,
        storage: "memory_only"
      };
    }
  };
}

function searchTravel(args) {
  const input = args.search && typeof args.search === "object" ? args.search : args;
  const query = normalizeQuery(input);
  const provider = args.provider || input.provider || "sandbox";
  if (!["sandbox", "official-handoff"].includes(provider)) {
    throw new Error(`Unsupported provider: ${provider}`);
  }
  const official = provider === "official-handoff";
  const siteId = args.official_site || args.officialSite || input.official_site || input.officialSite;
  const handoff = official ? officialHandoffFor(query, siteId) : null;
  const offer = buildOffer({ query, provider, official, handoff });
  return {
    query,
    provider,
    offers: [offer],
    privacy: {
      pii_accepted: false,
      external_transmission: false,
      external_transmission_after_handoff: official
        ? [handoff.itinerary_in_url ? "anonymous_itinerary_fields_in_url" : "user_entered_anonymous_itinerary_fields"]
        : [],
      requires_human_confirmation: true,
      booking_authorization_required: official,
      payment_handoff_only: true
    }
  };
}

function buildOffer({ query, provider, official, handoff }) {
  const estimate = official
    ? estimatePriceFor(query, handoff.site.id)
    : priceFor(query.product);
  const budget = budgetReview(query.budgetCny, estimate);
  const priceSource = official ? "anna_estimate_pending_official_inventory" : "sandbox_fixture";
  const inventory = inventoryStatus(priceSource);
  const title = official
    ? `${handoff.site.name} ${productLabel(query.product)}候选`
    : `Sandbox ${productLabel(query.product)}推荐方案`;
  return {
    id: official ? `${query.product}-${handoff.site.id}-official-handoff` : `${query.product}-sandbox-1`,
    product: query.product,
    title,
    schedule: scheduleFor(query),
    price: estimate,
    currency: "CNY",
    price_source: priceSource,
    inventory_status: inventory,
    budget,
    confirmation_prompt: `${title}：${scheduleFor(query)}，Anna 预估 ${estimate} CNY（${inventory.label}）${budget.label ? `，${budget.label}` : ""}。是否确认候选？确认后 Anna 会再次请求订购接管授权。`,
    can_auto_book: false,
    can_assist_booking_after_authorization: official,
    can_auto_pay: false,
    handoff,
    gates: official ? HUMAN_GATES["official-handoff"] : HUMAN_GATES.sandbox
  };
}

function officialHandoffFor(query, siteId) {
  const site = officialSiteFor(query.product, siteId);
  const url = officialUrl(query, site);
  const itineraryInUrl = Boolean(site.deep_link);
  const anonymousFields = {
    product: query.product,
    origin: query.origin,
    destination: query.destination,
    departureDate: query.departureDate,
    tripType: query.tripType,
    returnDate: query.returnDate,
    budgetCny: query.budgetCny,
    passengers: query.passengers
  };
  if (query.product === "hotel") {
    anonymousFields.checkinDate = query.checkinDate;
    anonymousFields.checkoutDate = query.checkoutDate;
    anonymousFields.nights = query.nights;
  }
  return {
    mode: "official-web",
    site,
    url,
    itinerary_in_url: itineraryInUrl,
    anonymous_fields: anonymousFields,
    user_controlled_steps: [
      itineraryInUrl
        ? "打开官方网页并核对匿名行程字段"
        : "打开官方平台入口并由用户手动输入 Anna 展示的匿名行程字段",
      "Anna 弹出订购接管授权提示，用户授权后才继续",
      "用户自行处理登录、验证码、姓名、证件、手机号，或选择旅行 App 中已保存的乘客/住客资料",
      "Anna 只监测订购流程是否已到付款前，不读取、不保存、不传输身份字段或订单详情",
      "到达付款界面后停在 payment_handoff，由用户本人付款"
    ]
  };
}

function officialUrl(query, site) {
  if (site.deep_link === "expedia-flight-search") return flightUrl(query, site);
  if (site.deep_link === "booking-hotel-search") return hotelUrl(query, site);
  return site.home;
}

function officialSiteFor(product, requestedId) {
  const sites = OFFICIAL_SITES[product] || [];
  const fallback = sites[0];
  if (!requestedId) return fallback;
  const site = sites.find((item) => item.id === requestedId);
  if (!site) {
    throw new Error(`Unsupported official site for ${product}: ${requestedId}`);
  }
  return site;
}

function flightUrl(query, site) {
  const params = new URLSearchParams({
    trip: query.tripType,
    leg1: `from:${query.origin},to:${query.destination},departure:${query.departureDate}TANYT`,
    passengers: `adults:${query.passengers.adults},children:${query.passengers.children},seniors:0,infantinlap:Y`,
    mode: "search"
  });
  if (query.tripType === "roundtrip" && query.returnDate) {
    params.set("leg2", `from:${query.destination},to:${query.origin},departure:${query.returnDate}TANYT`);
  }
  return `${site.origin}/Flights-Search?${params.toString()}`;
}

function hotelUrl(query, site) {
  const params = new URLSearchParams({
    ss: query.destination || query.origin,
    checkin: query.checkinDate,
    checkout: query.checkoutDate,
    group_adults: String(query.passengers.adults),
    group_children: String(query.passengers.children),
    no_rooms: "1"
  });
  return `${site.origin}/searchresults.html?${params.toString()}`;
}

function addDays(isoDate, days) {
  const date = new Date(`${isoDate}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function normalizeQuery(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("search must be an object");
  }
  const product = clean(input.product, "product", 24);
  if (!PRODUCTS.has(product)) throw new Error(`Unsupported product: ${product}`);
  const origin = optional(input.origin, "origin", 80);
  const destination = optional(input.destination, "destination", 80);
  const departureDate = clean(input.departureDate, "departureDate", 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(departureDate)) {
    throw new Error("departureDate must use YYYY-MM-DD");
  }
  const nights = product === "hotel"
    ? boundedInteger(input.nights, 1, 30, 1, "nights")
    : null;
  const checkoutDate = product === "hotel"
    ? optionalDate(input.checkoutDate, "checkoutDate") || addDays(departureDate, nights)
    : null;
  if (product === "flight" && (!origin || !destination)) {
    throw new Error("origin and destination are required for flight");
  }
  if (product === "hotel" && !destination && !origin) {
    throw new Error("hotel destination is required");
  }
  const query = {
    product,
    origin,
    destination,
    departureDate,
    tripType: normalizeTripType(input),
    returnDate: optionalDate(input.returnDate || input.return_date, "returnDate"),
    budgetCny: optionalMoney(input.budgetCny ?? input.budget_cny ?? input.budget, "budgetCny"),
    passengers: {
      adults: boundedInteger(input.passengers?.adults, 1, 9, 1, "passengers.adults"),
      children: boundedInteger(input.passengers?.children, 0, 9, 0, "passengers.children")
    }
  };
  if (product !== "flight") {
    query.tripType = null;
    query.returnDate = null;
  } else if (query.tripType === "roundtrip" && !query.returnDate) {
    throw new Error("returnDate is required for roundtrip flights");
  }
  if (query.returnDate && daysBetween(departureDate, query.returnDate) < 1) {
    throw new Error("returnDate must be after departureDate");
  }
  if (product === "hotel") {
    query.checkinDate = departureDate;
    query.checkoutDate = checkoutDate;
    query.nights = daysBetween(departureDate, checkoutDate);
    if (query.nights < 1 || query.nights > 30) {
      throw new Error("checkoutDate must be 1-30 nights after departureDate");
    }
  }
  return query;
}

function assertNoPii(value, path = "args") {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoPii(item, `${path}[${index}]`));
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, nested] of Object.entries(value)) {
      if (/(?:^|[_-])(?:full)?name$|passenger(?!s$)|traveler|contact|identity|id.?card|passport|phone|mobile|email|bank|card|cvv|cvc|password|姓名|身份证|护照|手机号|验证码|支付密码/i.test(key)) {
        throw new Error(`Sensitive user data is not accepted: ${path}.${key}`);
      }
      assertNoPii(nested, `${path}.${key}`);
    }
    return;
  }
  if (typeof value === "string" &&
      (/\b1[3-9]\d{9}\b/.test(value) || /\b(?:\d[ -]*?){13,19}\b/.test(value))) {
    throw new Error(`Sensitive user data is not accepted: ${path}`);
  }
}

function clean(value, field, max) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${field} is required`);
  if (value.trim().length > max) throw new Error(`${field} is too long`);
  return value.trim();
}

function optional(value, field, max) {
  if (value == null || value === "") return null;
  return clean(value, field, max);
}

function optionalDate(value, field) {
  if (value == null || value === "") return null;
  const date = clean(value, field, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error(`${field} must use YYYY-MM-DD`);
  }
  return date;
}

function optionalMoney(value, field) {
  if (value == null || value === "") return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 1 || number > 1000000) {
    throw new Error(`${field} must be between 1 and 1000000`);
  }
  return Math.round(number);
}

function boundedInteger(value, min, max, fallback, field) {
  if (value == null || value === "") return fallback;
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) {
    throw new Error(`${field} must be between ${min} and ${max}`);
  }
  return number;
}

function productLabel(product) {
  return { flight: "机票", hotel: "酒店" }[product];
}

function priceFor(product) {
  return { flight: 680, hotel: 438 }[product];
}

function estimatePriceFor(query, siteId) {
  const flightBase = { expedia: 1680, trip: 1520, ctrip: 1580 };
  const hotelBase = { booking: 720, trip: 650, ctrip: 610, expedia: 760 };
  if (query.product === "flight") {
    const base = flightBase[siteId] || 1700;
    const multiplier = query.tripType === "roundtrip" ? 1.82 : 1;
    return Math.round(base * multiplier * query.passengers.adults);
  }
  const perNight = hotelBase[siteId] || 700;
  return Math.round(perNight * query.nights);
}

function budgetReview(budgetCny, estimate) {
  if (!budgetCny) {
    return {
      provided: false,
      budget_cny: null,
      estimate_cny: estimate,
      basis: "anna_estimate",
      final_price_confirmed: false,
      status: "not_provided",
      difference_cny: null,
      label: "未提供预算，官方最终价待用户接管页面确认"
    };
  }
  const difference = budgetCny - estimate;
  return {
    provided: true,
    budget_cny: budgetCny,
    estimate_cny: estimate,
    basis: "anna_estimate",
    final_price_confirmed: false,
    status: difference >= 0 ? "within_budget" : "over_budget",
    difference_cny: difference,
    label: difference >= 0
      ? `按 Anna 预估未超预算，剩余约 ${difference} CNY；官方最终价待页面确认`
      : `按 Anna 预估超出预算约 ${Math.abs(difference)} CNY；官方最终价待页面确认`
  };
}

function inventoryStatus(priceSource) {
  if (priceSource === "sandbox_fixture") {
    return {
      live_price_checked: false,
      final_price_confirmed: false,
      source: "sandbox_fixture",
      label: "Sandbox 固定演示价，非真实库存"
    };
  }
  return {
    live_price_checked: false,
    final_price_confirmed: false,
    source: "official_site_after_user_handoff",
    label: "Anna 预估，官方实时库存与最终价待页面确认"
  };
}

function scheduleFor(query) {
  if (query.product === "hotel") {
    return `${query.destination || query.origin} · ${query.checkinDate} → ${query.checkoutDate} · ${query.nights}晚`;
  }
  if (query.tripType === "roundtrip") {
    return `${query.origin} ↔ ${query.destination} · ${query.departureDate} → ${query.returnDate}`;
  }
  return `${query.origin} → ${query.destination} · ${query.departureDate}`;
}

function daysBetween(startIso, endIso) {
  const start = Date.parse(`${startIso}T00:00:00.000Z`);
  const end = Date.parse(`${endIso}T00:00:00.000Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0;
  return Math.round((end - start) / 86400000);
}

function normalizeTripType(input) {
  const raw = String(input.tripType || input.trip_type || "").trim().toLowerCase();
  if (raw === "roundtrip" || raw === "round_trip" || raw === "return") return "roundtrip";
  if (raw === "oneway" || raw === "one_way" || raw === "single") return "oneway";
  if (input.returnDate || input.return_date || input.roundTrip === true || input.round_trip === true) return "roundtrip";
  return "oneway";
}

function normalizeEvent(event) {
  const raw = String(event || "").trim().toLowerCase();
  if (["yes", "y", "confirm", "confirmed", "booking_confirmed", "是", "确认", "订购", "购买"].includes(raw)) {
    return "booking_confirmed";
  }
  if (["authorize", "authorized", "booking_authorized", "授权", "同意授权", "允许接管"].includes(raw)) {
    return "booking_authorized";
  }
  if (["traveler_info_completed", "details_completed", "信息已填完", "资料已填完", "身份信息已完成"].includes(raw)) {
    return "traveler_info_completed";
  }
  if (["saved_traveler_selected", "saved_profile_selected", "已选择保存资料", "使用已保存资料"].includes(raw)) {
    return "saved_traveler_selected";
  }
  if (["payment_prompt_shown", "payment_ready", "到付款页", "付款界面已显示"].includes(raw)) {
    return "payment_prompt_shown";
  }
  if (["no", "n", "reject", "rejected", "candidate_rejected", "否", "不要", "换一个", "重新搜索", "再搜"].includes(raw)) {
    return "candidate_rejected";
  }
  return raw;
}

function rotateOfficialCandidate(run, now) {
  if (run.provider !== "official-handoff") {
    const error = new Error(`Event candidate_rejected is not allowed while provider is ${run.provider}.`);
    error.code = "invalid_transition";
    throw error;
  }
  const sites = OFFICIAL_SITES[run.product] || [];
  const currentSiteId = run.selected_offer?.handoff?.site?.id;
  const currentIndex = Math.max(0, sites.findIndex((site) => site.id === currentSiteId));
  const nextSite = sites[(currentIndex + 1) % sites.length];
  run.rejected_offers.push({
    offer_id: run.selected_offer.id,
    site: run.selected_offer.handoff.site.name,
    at: now().toISOString()
  });
  run.attempt_index = (run.attempt_index || 0) + 1;
  const handoff = officialHandoffFor(run.query, nextSite.id);
  run.selected_offer = buildOffer({
    query: run.query,
    provider: run.provider,
    official: true,
    handoff
  });
  run.state = "await_user_confirmation";
  run.next_gate = "user_booking_confirmation";
  run.updated_at = now().toISOString();
  run.events.push({
    type: "candidate_rejected",
    event: "candidate_rejected",
    next_site: nextSite.id,
    at: run.updated_at
  });
  return clone(run);
}

function requiredRun(runs, id) {
  const run = runs.get(String(id || ""));
  if (!run) throw new Error(`Run not found: ${id}`);
  return run;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}
