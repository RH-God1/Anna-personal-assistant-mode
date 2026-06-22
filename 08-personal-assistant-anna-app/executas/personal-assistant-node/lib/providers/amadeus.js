import {
  addDays,
  amountNumber,
  itineraryTimes,
  money,
  normalizeFlightCriteria,
  normalizeHotelCriteria,
  providerResult,
  ProviderResultError,
  stableId
} from "./common.js";

const PROVIDER = "amadeus";

export function createAmadeusProvider({ now = () => new Date() } = {}) {
  const config = {
    provider: PROVIDER,
    sandbox: true,
    client_id_configured: Boolean(process.env.AMADEUS_CLIENT_ID),
    client_secret_configured: Boolean(process.env.AMADEUS_CLIENT_SECRET),
    base_url: process.env.AMADEUS_BASE_URL || "https://test.api.amadeus.com",
    force_live: envFlag("AMADEUS_FORCE_LIVE", false)
  };

  return {
    id: PROVIDER,
    status() {
      return {
        ...config,
        supports: ["flight", "hotel"],
        order_creation: "blocked_in_this_runtime",
        payment: "blocked_in_this_runtime"
      };
    },

    async searchFlightOffers(criteriaInput = {}) {
      const criteria = normalizeFlightCriteria(criteriaInput);
      if (criteria.origin === criteria.destination) {
        throw new ProviderResultError("invalid_search_params", "origin and destination must be different");
      }
      if (config.force_live && config.client_id_configured && config.client_secret_configured) {
        return searchLiveFlightOffers(criteria, config);
      }
      return providerResult(PROVIDER, [
        buildAmadeusFlight(criteria, 0),
        buildAmadeusFlight(criteria, 1)
      ]);
    },

    async getFlightOffer(offerId, criteriaInput = {}) {
      const criteria = normalizeFlightCriteria({
        origin: "SHA",
        destination: "NRT",
        departureDate: now().toISOString().slice(0, 10),
        ...criteriaInput
      });
      const index = String(offerId).endsWith("_2") ? 1 : 0;
      return buildAmadeusFlight(criteria, index, offerId);
    },

    async searchHotelOffers(criteriaInput = {}) {
      const criteria = normalizeHotelCriteria(criteriaInput);
      return providerResult(PROVIDER, [
        buildAmadeusHotel(criteria, 0),
        buildAmadeusHotel(criteria, 1)
      ]);
    },

    async getHotelOffer(offerId, criteriaInput = {}) {
      const today = now().toISOString().slice(0, 10);
      const criteria = normalizeHotelCriteria({
        destination: "Tokyo",
        checkinDate: today,
        ...criteriaInput,
        checkoutDate: criteriaInput.checkoutDate || criteriaInput.checkout_date
          || (criteriaInput.checkinDate || criteriaInput.checkin_date ? null : addDays(today, 1))
      });
      const index = String(offerId).endsWith("_2") ? 1 : 0;
      return buildAmadeusHotel(criteria, index, offerId);
    },

    async createOrder() {
      throw blockedOrderError();
    }
  };
}

async function searchLiveFlightOffers(criteria, config) {
  const token = await amadeusAccessToken(config);
  const params = new URLSearchParams({
    originLocationCode: criteria.origin,
    destinationLocationCode: criteria.destination,
    departureDate: criteria.departureDate,
    adults: String(criteria.passengers.adults),
    travelClass: amadeusCabin(criteria.cabinClass),
    currencyCode: "CNY",
    max: "5"
  });
  if (criteria.returnDate) params.set("returnDate", criteria.returnDate);
  const response = await fetch(`${config.base_url}/v2/shopping/flight-offers?${params.toString()}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" }
  });
  const payload = await response.json().catch(() => ({}));
  if (response.status === 429) {
    throw new ProviderResultError("rate_limited", "Amadeus sandbox rate limited this request.");
  }
  if (!response.ok) {
    const detail = payload?.errors?.[0]?.detail || payload?.errors?.[0]?.title || response.statusText;
    throw new ProviderResultError("supplier_error", `Amadeus sandbox request failed: ${detail}`);
  }
  const offers = Array.isArray(payload.data) ? payload.data : [];
  return providerResult(PROVIDER, offers.map((offer, index) => mapLiveFlightOffer(offer, criteria, index)));
}

async function amadeusAccessToken(config) {
  const response = await fetch(`${config.base_url}/v1/security/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: process.env.AMADEUS_CLIENT_ID || "",
      client_secret: process.env.AMADEUS_CLIENT_SECRET || ""
    })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.access_token) {
    throw new ProviderResultError("supplier_error", "Amadeus sandbox authentication failed.");
  }
  return payload.access_token;
}

function mapLiveFlightOffer(offer, criteria, index) {
  const itinerary = offer.itineraries?.[0] || {};
  const segments = itinerary.segments || [];
  const first = segments[0] || {};
  const last = segments[segments.length - 1] || first;
  const price = offer.price || {};
  return {
    id: offer.id || stableId("amadeus_flight", { criteria, index }),
    provider: PROVIDER,
    type: "flight",
    offer_source: "amadeus_sandbox_api",
    live_offer_checked_at: new Date().toISOString(),
    available: true,
    available_seats: Number(offer.numberOfBookableSeats || 0) || null,
    price: money(price.currency || "CNY", Number(price.grandTotal || price.total || 0)),
    origin: criteria.origin,
    destination: criteria.destination,
    departure_date: criteria.departureDate,
    return_date: criteria.returnDate,
    cabin_class: criteria.cabinClass,
    passenger_count: criteria.passengers.adults + criteria.passengers.children,
    departure_time: first.departure?.at || null,
    arrival_time: last.arrival?.at || null,
    stops: Math.max(0, segments.length - 1),
    baggage: "Amadeus sandbox: baggage must be reviewed before checkout.",
    refund_change_hint: "Amadeus sandbox: refund/change terms must be reviewed before any user-controlled checkout.",
    fare_rules: "Amadeus sandbox fare rules require user review; Anna will not create orders or payments.",
    segments: segments.map((segment) => ({
      carrier: segment.carrierCode || "Amadeus carrier",
      flight_number: segment.number || null,
      origin: segment.departure?.iataCode || criteria.origin,
      destination: segment.arrival?.iataCode || criteria.destination,
      departing_at: segment.departure?.at || null,
      arriving_at: segment.arrival?.at || null,
      stops: 0
    })),
    comparison_score: Math.round(940 - amountNumber(money(price.currency || "CNY", Number(price.grandTotal || 0))) / 10 - index)
  };
}

function buildAmadeusFlight(criteria, index, offerId = null) {
  const cabinMultiplier = {
    economy: 1,
    premium_economy: 1.38,
    business: 2.65,
    first: 4.2
  }[criteria.cabinClass] || 1;
  const tripMultiplier = criteria.tripType === "roundtrip" ? 1.82 : 1;
  const base = index === 0 ? 1530 : 1680;
  const total = Math.round(base * cabinMultiplier * tripMultiplier * criteria.passengers.adults);
  const times = itineraryTimes(criteria.departureDate, index === 0 ? 8 : 16, index === 0 ? 3.2 : 5.1);
  const id = offerId || `${stableId("amadeus_flight", { criteria, index })}_${index + 1}`;
  return {
    id,
    provider: PROVIDER,
    type: "flight",
    offer_source: "amadeus_sandbox_fixture",
    live_offer_checked_at: new Date().toISOString(),
    available: true,
    available_seats: index === 0 ? 5 : 3,
    price: money("CNY", total),
    origin: criteria.origin,
    destination: criteria.destination,
    departure_date: criteria.departureDate,
    return_date: criteria.returnDate,
    cabin_class: criteria.cabinClass,
    passenger_count: criteria.passengers.adults + criteria.passengers.children,
    departure_time: times.departing_at,
    arrival_time: times.arriving_at,
    stops: index,
    baggage: index === 0 ? "含随身行李；托运行李需在确认页复核" : "含随身行李，可能含 1 件托运额度",
    refund_change_hint: "Amadeus sandbox fixture: 退改签规则必须在用户确认页复核。",
    fare_rules: "Amadeus sandbox fixture: Anna 不创建订单，不出票，不付款。",
    segments: [{
      carrier: index === 0 ? "Amadeus Sandbox Air" : "Amadeus Connect Sandbox",
      flight_number: index === 0 ? "AM218" : "AM426",
      origin: criteria.origin,
      destination: criteria.destination,
      departing_at: times.departing_at,
      arriving_at: times.arriving_at,
      stops: index
    }],
    comparison_score: Math.round(960 - total / 10 - index * 40)
  };
}

function buildAmadeusHotel(criteria, index, offerId = null) {
  const nightly = index === 0 ? 720 : 910;
  const total = nightly * criteria.nights * criteria.rooms;
  return {
    id: offerId || `${stableId("amadeus_hotel", { criteria, index })}_${index + 1}`,
    provider: PROVIDER,
    type: "hotel",
    offer_source: "amadeus_sandbox_fixture",
    live_offer_checked_at: new Date().toISOString(),
    available: true,
    available_rooms: index === 0 ? 2 : 4,
    price: money("CNY", total),
    hotel_name: index === 0 ? "Amadeus Sandbox Central" : "Amadeus Sandbox Riverside",
    location: {
      city: criteria.destination,
      area: criteria.hotelLocation || (index === 0 ? "Central" : "Riverside")
    },
    checkin_date: criteria.checkinDate,
    checkout_date: criteria.checkoutDate,
    nights: criteria.nights,
    guests: criteria.guests,
    rooms: criteria.rooms,
    cancellation_policy: index === 0 ? "入住前 48 小时可取消；以最终确认页为准" : "低价预付价；取消政策需复核",
    room_policy: "Amadeus sandbox fixture: 房型、早餐和税费必须在确认页复核。",
    comparison_score: Math.round(920 - total / 10 - index * 35)
  };
}

function amadeusCabin(value) {
  return {
    economy: "ECONOMY",
    premium_economy: "PREMIUM_ECONOMY",
    business: "BUSINESS",
    first: "FIRST"
  }[value] || "ECONOMY";
}

function blockedOrderError() {
  const error = new Error("Amadeus order creation is blocked in this runtime; use the human confirmation queue and user-controlled checkout.");
  error.code = "ORDER_CREATION_BLOCKED";
  return error;
}

function envFlag(name, fallback = false) {
  const raw = process.env[name];
  if (raw == null || raw === "") return fallback;
  return !["0", "false", "no", "off"].includes(String(raw).toLowerCase());
}
