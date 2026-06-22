import {
  addDays,
  amountNumber,
  DUFFEL_NO_RESULT_MESSAGE,
  envFlag,
  itineraryTimes,
  money,
  normalizeFlightCriteria,
  normalizeHotelCriteria,
  providerResult,
  ProviderResultError,
  stableId
} from "./common.js";

const PROVIDER = "duffel";

export function createDuffelProvider({ now = () => new Date() } = {}) {
  const config = {
    provider: PROVIDER,
    test_mode: envFlag("DUFFEL_TEST_MODE", true),
    access_token_configured: Boolean(accessToken()),
    base_url: process.env.DUFFEL_BASE_URL || "https://api.duffel.com",
    stays_enabled: envFlag("DUFFEL_STAYS_ENABLED", true)
  };

  return {
    id: PROVIDER,
    status() {
      return {
        ...config,
        supports: config.stays_enabled ? ["flight", "hotel"] : ["flight"],
        only_travel_supplier: true
      };
    },

    async searchFlightOffers(criteriaInput = {}) {
      if (criteriaInput.forceNoOffers || criteriaInput.noOffers) {
        return providerResult(PROVIDER, []);
      }
      const criteria = normalizeFlightCriteria(criteriaInput);
      if (criteria.origin === criteria.destination) {
        throw new ProviderResultError("invalid_search_params", "origin and destination must be different");
      }
      if (maybeUnsupportedFlight(criteria)) {
        return providerResult(PROVIDER, [], {
          resultCode: "route_maybe_unsupported",
          message: DUFFEL_NO_RESULT_MESSAGE,
          routeMaybeUnsupported: true
        });
      }
      if (accessToken() && !envFlag("DUFFEL_FORCE_FIXTURE", false)) {
        return searchLiveFlightOffers(criteria, config);
      }
      return providerResult(PROVIDER, [buildDuffelFlight(criteria, 0), buildDuffelFlight(criteria, 1)]);
    },

    async getFlightOffer(offerId, criteriaInput = {}) {
      const criteria = normalizeFlightCriteria({
        origin: "SHA",
        destination: "NRT",
        departureDate: now().toISOString().slice(0, 10),
        ...criteriaInput
      });
      const index = String(offerId).endsWith("_2") ? 1 : 0;
      return buildDuffelFlight(criteria, index, offerId);
    },

    async searchHotelOffers(criteriaInput = {}) {
      if (!config.stays_enabled) {
        return providerResult(PROVIDER, [], {
          resultCode: "route_maybe_unsupported",
          message: DUFFEL_NO_RESULT_MESSAGE,
          routeMaybeUnsupported: true
        });
      }
      if (criteriaInput.forceNoOffers || criteriaInput.noOffers) {
        return providerResult(PROVIDER, []);
      }
      const criteria = normalizeHotelCriteria(criteriaInput);
      return providerResult(PROVIDER, [buildDuffelHotel(criteria, 0), buildDuffelHotel(criteria, 1)]);
    },

    async getHotelOffer(offerId, criteriaInput = {}) {
      if (!config.stays_enabled) {
        throw new ProviderResultError("route_maybe_unsupported", DUFFEL_NO_RESULT_MESSAGE);
      }
      const today = now().toISOString().slice(0, 10);
      const criteria = normalizeHotelCriteria({
        destination: "Tokyo",
        checkinDate: today,
        ...criteriaInput,
        checkoutDate: criteriaInput.checkoutDate || criteriaInput.checkout_date
          || (criteriaInput.checkinDate || criteriaInput.checkin_date
            ? null
            : addDays(today, 1))
      });
      const index = String(offerId).endsWith("_2") ? 1 : 0;
      return buildDuffelHotel(criteria, index, offerId);
    },

    async createOrder({ confirmationId, items }) {
      return {
        provider: PROVIDER,
        provider_order_id: `duffel_test_order_${confirmationId.slice(-10)}`,
        provider_booking_id: `duffel_test_booking_${items.length}`,
        test_mode: config.test_mode,
        order_type: "hold",
        payment_required: true,
        payment_collected_by_anna: false
      };
    },

    async payHoldOrder({ orderId }) {
      return {
        provider: PROVIDER,
        provider_order_id: orderId,
        payment_status: "test_paid",
        test_mode: config.test_mode,
        payment_collected_by_anna: false
      };
    }
  };
}

function accessToken() {
  return process.env.DUFFEL_ACCESS_TOKEN || "";
}

async function searchLiveFlightOffers(criteria, config) {
  const response = await duffelRequest("/air/offer_requests?return_offers=true", {
    method: "POST",
    body: {
      data: {
        slices: liveFlightSlices(criteria),
        passengers: liveFlightPassengers(criteria.passengers),
        cabin_class: criteria.cabinClass
      }
    },
    config
  });
  const offers = response?.data?.offers || [];
  return providerResult(PROVIDER, offers.slice(0, 5).map((offer, index) => mapLiveFlightOffer(offer, criteria, index)));
}

async function duffelRequest(path, { method = "GET", body, config }) {
  const url = new URL(path, config.base_url).toString();
  const response = await fetch(url, {
    method,
    headers: {
      "Authorization": `Bearer ${accessToken()}`,
      "Content-Type": "application/json",
      "Accept": "application/json",
      "Duffel-Version": process.env.DUFFEL_VERSION || "v2"
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const payload = await response.json().catch(() => ({}));
  if (response.status === 429) {
    throw new ProviderResultError("rate_limited", "Duffel API rate limited this request.");
  }
  if (!response.ok) {
    const apiMessage = payload?.errors?.[0]?.message || payload?.meta?.message || response.statusText;
    throw new ProviderResultError("supplier_error", `Duffel API request failed: ${apiMessage}`);
  }
  return payload;
}

function liveFlightSlices(criteria) {
  const slices = [{
    origin: criteria.origin,
    destination: criteria.destination,
    departure_date: criteria.departureDate
  }];
  if (criteria.tripType === "roundtrip" && criteria.returnDate) {
    slices.push({
      origin: criteria.destination,
      destination: criteria.origin,
      departure_date: criteria.returnDate
    });
  }
  return slices;
}

function liveFlightPassengers(passengers) {
  const adults = Array.from({ length: passengers.adults }, () => ({ type: "adult" }));
  const children = Array.from({ length: passengers.children }, () => ({ type: "child" }));
  return adults.concat(children);
}

function mapLiveFlightOffer(offer, criteria, index) {
  const slices = Array.isArray(offer.slices) ? offer.slices : [];
  const firstSlice = slices[0] || {};
  const lastSlice = slices[slices.length - 1] || firstSlice;
  const firstSegment = firstSlice.segments?.[0] || {};
  const lastSegment = firstSlice.segments?.[firstSlice.segments.length - 1] || firstSegment;
  const stops = Math.max(0, (firstSlice.segments?.length || 1) - 1);
  const totalAmount = Number(offer.total_amount || offer.base_amount || 0);
  const currency = offer.total_currency || offer.base_currency || "USD";
  return {
    id: offer.id,
    provider: PROVIDER,
    type: "flight",
    offer_source: "duffel_api",
    live_offer_checked_at: new Date().toISOString(),
    available: true,
    available_seats: offer.available_services?.length || null,
    price: money(currency, totalAmount),
    origin: criteria.origin,
    destination: criteria.destination,
    departure_date: criteria.departureDate,
    return_date: criteria.returnDate,
    cabin_class: criteria.cabinClass,
    passenger_count: criteria.passengers.adults + criteria.passengers.children,
    departure_time: firstSegment.departing_at || firstSlice.departing_at || null,
    arrival_time: lastSegment.arriving_at || lastSlice.arriving_at || null,
    stops,
    baggage: summarizeBaggage(offer),
    refund_change_hint: "Duffel live offer: final refund/change terms must be reviewed on the confirmation page before any order action.",
    fare_rules: "Duffel live offer: price, inventory, baggage, refund, change, and cancellation terms must be refreshed before confirmation.",
    segments: (firstSlice.segments || []).map((segment) => ({
      carrier: segment.marketing_carrier?.name || segment.operating_carrier?.name || "Duffel carrier",
      flight_number: segment.marketing_carrier_flight_number || segment.operating_carrier_flight_number || null,
      origin: segment.origin?.iata_code || segment.origin?.id || criteria.origin,
      destination: segment.destination?.iata_code || segment.destination?.id || criteria.destination,
      departing_at: segment.departing_at,
      arriving_at: segment.arriving_at,
      stops: 0
    })),
    comparison_score: Math.round(1000 - totalAmount / 10 - stops * 50 - index)
  };
}

function summarizeBaggage(offer) {
  const baggage = offer.slices
    ?.flatMap((slice) => slice.segments || [])
    .flatMap((segment) => segment.passengers || [])
    .flatMap((passenger) => passenger.baggages || [])
    .map((item) => `${item.quantity || 1} ${item.type || "baggage"}`);
  return baggage?.length
    ? [...new Set(baggage)].join("; ")
    : "Duffel live offer: baggage details must be reviewed before confirmation.";
}

function maybeUnsupportedFlight(criteria) {
  return /^(ZZZ|XXX|TST)$/i.test(criteria.origin) || /^(ZZZ|XXX|TST)$/i.test(criteria.destination);
}

function buildDuffelFlight(criteria, index, offerId = null) {
  const cabinMultiplier = {
    economy: 1,
    premium_economy: 1.45,
    business: 2.8,
    first: 4.5
  }[criteria.cabinClass] || 1;
  const tripMultiplier = criteria.tripType === "roundtrip" ? 1.86 : 1;
  const base = index === 0 ? 1460 : 1715;
  const total = Math.round(base * cabinMultiplier * tripMultiplier * criteria.passengers.adults);
  const outbound = itineraryTimes(criteria.departureDate, index === 0 ? 9 : 14, index === 0 ? 3.1 : 5.4);
  const id = offerId || `${stableId("duffel_flight", { criteria, index })}_${index + 1}`;
  const stops = index === 0 ? 0 : 1;
  return {
    id,
    provider: PROVIDER,
    type: "flight",
    offer_source: "sandbox_fixture",
    live_offer_checked_at: new Date().toISOString(),
    available: true,
    available_seats: index === 0 ? 4 : 7,
    price: money("CNY", total),
    origin: criteria.origin,
    destination: criteria.destination,
    departure_date: criteria.departureDate,
    return_date: criteria.returnDate,
    cabin_class: criteria.cabinClass,
    passenger_count: criteria.passengers.adults + criteria.passengers.children,
    departure_time: outbound.departing_at,
    arrival_time: outbound.arriving_at,
    stops,
    baggage: index === 0
      ? "含 1 件随身行李；托运行李以最终 fare rules 为准"
      : "含 1 件随身行李 + 1 件 20kg 托运行李",
    refund_change_hint: index === 0
      ? "低价舱位，通常改签/退票费用较高；确认页需再次展示"
      : "标准舱位，通常允许付费改签；退票以航司规则为准",
    fare_rules: "Sandbox fare rules: 创建订单前必须重新确认价格、库存、行李和退改签规则。",
    segments: [{
      carrier: index === 0 ? "Anna Air Sandbox" : "Anna Connect Sandbox",
      flight_number: index === 0 ? "AN218" : "AN426",
      origin: criteria.origin,
      destination: criteria.destination,
      departing_at: outbound.departing_at,
      arriving_at: outbound.arriving_at,
      stops
    }],
    comparison_score: Math.round(1000 - amountNumber(money("CNY", total)) / 10 - stops * 50)
  };
}

function buildDuffelHotel(criteria, index, offerId = null) {
  const nightly = index === 0 ? 660 : 820;
  const total = Math.round(nightly * criteria.nights * criteria.rooms);
  const id = offerId || `${stableId("duffel_stay", { criteria, index })}_${index + 1}`;
  return {
    id,
    provider: PROVIDER,
    type: "hotel",
    offer_source: "duffel_stays_sandbox_fixture",
    live_offer_checked_at: new Date().toISOString(),
    available: true,
    available_rooms: index === 0 ? 2 : 4,
    hotel_name: index === 0 ? "Duffel Test Stay Central" : "Duffel Test Stay Riverside",
    location: {
      city: criteria.destination,
      area: criteria.hotelLocation || (index === 0 ? "Central" : "Riverside"),
      address: `${criteria.destination} Duffel sandbox district ${index + 1}`
    },
    checkin_date: criteria.checkinDate,
    checkout_date: criteria.checkoutDate,
    nights: criteria.nights,
    guests: criteria.guests,
    rooms: criteria.rooms,
    price: money("CNY", total),
    cancellation_policy: index === 0
      ? "Duffel Stays sandbox: 入住前 48 小时可取消；最终政策需在 quote 前再次确认"
      : "Duffel Stays sandbox: 特价房通常不可免费取消；必须由用户确认",
    board: index === 0 ? "含早餐" : "不含早餐",
    comparison_score: Math.round(920 - amountNumber(money("CNY", total)) / 10 + (index === 0 ? 45 : 0))
  };
}
