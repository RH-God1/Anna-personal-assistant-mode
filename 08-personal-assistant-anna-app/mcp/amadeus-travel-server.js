#!/usr/bin/env node
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const DEFAULT_PORT = 8765;
const DEFAULT_HOST = "127.0.0.1";
const PROTOCOL_VERSION = "2025-11-25";
const AMADEUS_TEST_BASE_URL = "https://test.api.amadeus.com";
const OPEN_LOG = path.resolve(
  process.env.AMADEUS_MCP_OPEN_LOG
    || path.join(process.cwd(), ".data", "amadeus-mcp-opened.jsonl")
);

export function createAmadeusTravelMcpServer(options = {}) {
  const state = {
    token: null,
    tokenExpiresAt: 0,
    offers: new Map(),
    openedUrls: []
  };
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const now = options.now || (() => new Date());
  const env = options.env || process.env;
  const baseUrl = env.AMADEUS_BASE_URL || AMADEUS_TEST_BASE_URL;
  const logger = options.logger || (() => {});

  async function dispatch(method, params = {}) {
    if (method === "initialize") {
      return {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "anna-amadeus-travel-mcp", version: "1.0.0" },
        instructions: [
          "Anna schedules the workflow; this MCP server only calls Amadeus sandbox APIs and opens a user-controlled booking URL.",
          "Always search before presenting flight or hotel options; search flights and hotels in parallel when both are requested.",
          "Always summarize flight and hotel options and ask exactly: Shall I open the [airline/hotel] checkout page for you?",
          "Only call open_booking_url after explicit same-turn yes; one yes permits at most one URL.",
          "Never collect passenger identity, payment card data, login credentials, or payment confirmation."
        ].join(" ")
      };
    }
    if (method === "ping") return {};
    if (method === "tools/list") return { tools: toolDefinitions() };
    if (method === "tools/call") {
      if (!params || typeof params.name !== "string") {
        throw rpcError(-32602, "tools/call requires a tool name");
      }
      return callTool(params.name, params.arguments || {});
    }
    throw rpcError(-32601, `Method not found: ${method}`);
  }

  async function callTool(name, args = {}) {
    const startedAt = Date.now();
    let outcome = "ok";
    try {
      let structuredContent;
      switch (name) {
        case "search_flights":
          structuredContent = await searchFlights(args);
          break;
        case "search_hotels":
          structuredContent = await searchHotels(args);
          break;
        case "get_offer_details":
          structuredContent = getOfferDetails(args);
          break;
        case "open_booking_url":
          structuredContent = await openBookingUrl(args);
          break;
        default:
          throw rpcError(-32601, `Unknown MCP tool: ${name}`);
      }
      return {
        content: [{ type: "text", text: JSON.stringify(structuredContent, null, 2) }],
        structuredContent,
        isError: false
      };
    } catch (error) {
      outcome = "error";
      return {
        content: [{ type: "text", text: error.message || "Amadeus MCP request failed." }],
        structuredContent: {
          code: error.code || "amadeus_mcp_error",
          message: error.message || "Amadeus MCP request failed."
        },
        isError: true
      };
    } finally {
      logger({
        at: now().toISOString(),
        tool: name,
        outcome,
        duration_ms: Date.now() - startedAt
      });
    }
  }

  async function searchFlights(args) {
    const criteria = normalizeFlightArgs(args);
    const useApi = hasAmadeusCredentials(env) && env.AMADEUS_MCP_USE_FIXTURES !== "1";
    const offers = useApi
      ? await fetchFlightOffers(criteria)
      : fixtureFlightOffers(criteria, now());
    offers.forEach((offer) => rememberOffer(state, offer));
    return {
      source: useApi ? "amadeus_sandbox_api" : "amadeus_sandbox_fixture",
      provider: "amadeus",
      product: "flight",
      query: criteria,
      options: offers,
      payment_policy: paymentPolicy(),
      next_required_step: "Anna must summarize options, ask the fixed checkout confirmation question, and wait for explicit same-turn yes before open_booking_url."
    };
  }

  async function searchHotels(args) {
    const criteria = normalizeHotelArgs(args);
    const useApi = hasAmadeusCredentials(env) && env.AMADEUS_MCP_USE_FIXTURES !== "1";
    const offers = useApi
      ? await fetchHotelOffers(criteria)
      : fixtureHotelOffers(criteria, now());
    offers.forEach((offer) => rememberOffer(state, offer));
    return {
      source: useApi ? "amadeus_sandbox_api" : "amadeus_sandbox_fixture",
      provider: "amadeus",
      product: "hotel",
      query: criteria,
      options: offers,
      payment_policy: paymentPolicy(),
      next_required_step: "Anna must summarize options, ask the fixed checkout confirmation question, and wait for explicit same-turn yes before open_booking_url."
    };
  }

  function getOfferDetails(args) {
    const offerId = requireString(args.offer_id || args.offerId, "offer_id");
    const cached = state.offers.get(offerId);
    if (!cached) {
      throw toolError("offer_not_found", `Offer not found in this MCP server cache: ${offerId}`);
    }
    return {
      offer_id: offerId,
      provider: "amadeus",
      product: cached.product,
      details: {
        ...cached,
        cancellation_policy: cached.cancellation_policy || "Review the supplier checkout page before payment.",
        baggage_allowance: cached.baggage_allowance || (cached.product === "flight"
          ? "Review baggage allowance before opening checkout."
          : null),
        room_policy: cached.room_policy || (cached.product === "hotel"
          ? "Review room, tax, and cancellation details before payment."
          : null)
      },
      payment_policy: paymentPolicy(),
      next_required_step: "Anna must show these details to the user, ask the fixed checkout confirmation question, and receive explicit same-turn yes before open_booking_url."
    };
  }

  async function openBookingUrl(args) {
    const url = new URL(requireString(args.url, "url"));
    if (!["https:", "http:"].includes(url.protocol)) {
      throw toolError("invalid_booking_url", "open_booking_url only accepts http or https URLs.");
    }
    const dryRun = args.dry_run === true || args.dryRun === true || env.AMADEUS_MCP_OPEN_DRY_RUN === "1";
    appendOpenLog({
      at: now().toISOString(),
      url: url.toString(),
      dry_run: dryRun,
      host: url.host
    });
    state.openedUrls.push({ url: url.toString(), dry_run: dryRun, opened_at: now().toISOString() });
    if (!dryRun) await openUrlInSystemBrowser(url.toString(), env);
    return {
      opened: !dryRun,
      dry_run: dryRun,
      url: url.toString(),
      message: dryRun
        ? "Dry run recorded; browser was not opened."
        : "Booking URL opened in the system browser. Anna stops before payment.",
      payment_policy: paymentPolicy()
    };
  }

  async function fetchFlightOffers(criteria) {
    const token = await getAccessToken();
    const body = {
      currencyCode: criteria.currency,
      originDestinations: [
        {
          id: "1",
          originLocationCode: criteria.origin,
          destinationLocationCode: criteria.destination,
          departureDateTimeRange: { date: criteria.departure_date }
        },
        ...(criteria.return_date ? [{
          id: "2",
          originLocationCode: criteria.destination,
          destinationLocationCode: criteria.origin,
          departureDateTimeRange: { date: criteria.return_date }
        }] : [])
      ],
      travelers: Array.from({ length: criteria.passengers }, (_, index) => ({
        id: String(index + 1),
        travelerType: "ADULT"
      })),
      sources: ["GDS"],
      searchCriteria: { maxFlightOffers: criteria.max }
    };
    const response = await fetchImpl(`${baseUrl}/v2/shopping/flight-offers`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    });
    const payload = await response.json().catch(() => ({}));
    assertAmadeusOk(response, payload, "flight_offers_search_failed");
    const dictionaries = payload.dictionaries || {};
    return (Array.isArray(payload.data) ? payload.data : [])
      .slice(0, criteria.max)
      .map((offer, index) => normalizeFlightOffer(offer, dictionaries, criteria, index));
  }

  async function fetchHotelOffers(criteria) {
    const token = await getAccessToken();
    const hotelsUrl = new URL(`${baseUrl}/v1/reference-data/locations/hotels/by-city`);
    hotelsUrl.searchParams.set("cityCode", criteria.city);
    hotelsUrl.searchParams.set("radius", String(criteria.radius_km));
    hotelsUrl.searchParams.set("radiusUnit", "KM");
    const hotelResponse = await fetchImpl(hotelsUrl, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" }
    });
    const hotelPayload = await hotelResponse.json().catch(() => ({}));
    assertAmadeusOk(hotelResponse, hotelPayload, "hotel_list_failed");
    const hotelIds = (Array.isArray(hotelPayload.data) ? hotelPayload.data : [])
      .map((hotel) => hotel.hotelId)
      .filter(Boolean)
      .slice(0, Math.max(1, Math.min(criteria.max_hotels, 20)));
    if (hotelIds.length === 0) return [];

    const offersUrl = new URL(`${baseUrl}/v3/shopping/hotel-offers`);
    offersUrl.searchParams.set("hotelIds", hotelIds.join(","));
    offersUrl.searchParams.set("adults", String(criteria.guests));
    offersUrl.searchParams.set("checkInDate", criteria.checkin_date);
    offersUrl.searchParams.set("checkOutDate", criteria.checkout_date);
    offersUrl.searchParams.set("roomQuantity", String(criteria.rooms));
    offersUrl.searchParams.set("currency", criteria.currency);
    offersUrl.searchParams.set("bestRateOnly", "true");
    const offersResponse = await fetchImpl(offersUrl, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" }
    });
    const offersPayload = await offersResponse.json().catch(() => ({}));
    assertAmadeusOk(offersResponse, offersPayload, "hotel_offers_failed");
    return (Array.isArray(offersPayload.data) ? offersPayload.data : [])
      .flatMap((hotel, hotelIndex) => normalizeHotelOfferGroup(hotel, criteria, hotelIndex))
      .slice(0, criteria.max);
  }

  async function getAccessToken() {
    if (state.token && Date.now() < state.tokenExpiresAt - 30000) return state.token;
    const response = await fetchImpl(`${baseUrl}/v1/security/oauth2/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: env.AMADEUS_CLIENT_ID || "",
        client_secret: env.AMADEUS_CLIENT_SECRET || ""
      })
    });
    const payload = await response.json().catch(() => ({}));
    assertAmadeusOk(response, payload, "amadeus_auth_failed");
    if (!payload.access_token) throw toolError("amadeus_auth_failed", "Amadeus did not return an access token.");
    state.token = payload.access_token;
    state.tokenExpiresAt = Date.now() + Math.max(60, Number(payload.expires_in) || 1800) * 1000;
    return state.token;
  }

  return { dispatch, state };
}

export function createHttpServer(mcp, options = {}) {
  const requiredToken = options.authToken || process.env.ANNA_MCP_AUTH_TOKEN || "";
  return http.createServer(async (request, response) => {
    try {
      if (requiredToken && !isAuthorized(request, requiredToken)) {
        writeJson(response, 401, { error: "unauthorized" });
        return;
      }
      if (request.method === "GET" && request.url === "/health") {
        writeJson(response, 200, { ok: true, server: "anna-amadeus-travel-mcp" });
        return;
      }
      if (request.method === "GET" && request.url === "/tools") {
        writeJson(response, 200, { tools: toolDefinitions() });
        return;
      }
      if (request.method === "POST" && request.url === "/mcp") {
        const body = await readJsonBody(request);
        const result = await mcp.dispatch(body.method, body.params || {});
        writeJson(response, 200, { jsonrpc: "2.0", id: body.id ?? null, result });
        return;
      }
      writeJson(response, 404, { error: "not_found" });
    } catch (error) {
      writeJson(response, 200, {
        jsonrpc: "2.0",
        id: null,
        error: {
          code: error.rpcCode || -32603,
          message: error.message || "Internal error"
        }
      });
    }
  });
}

export function toolDefinitions() {
  return [
    {
      name: "search_flights",
      title: "Search Amadeus sandbox flight offers",
      description: "Searches Amadeus sandbox flight offers and returns normalized options with price, airline, times, baggage hints, and booking URL.",
      inputSchema: {
        type: "object",
        properties: {
          origin: { type: "string", description: "IATA origin, e.g. SHA." },
          destination: { type: "string", description: "IATA destination, e.g. NRT." },
          departure_date: { type: "string", description: "Departure date as YYYY-MM-DD." },
          return_date: { type: "string", description: "Optional return date as YYYY-MM-DD." },
          passengers: { type: "integer", minimum: 1, maximum: 9, description: "Adult passenger count." },
          currency: { type: "string", description: "Currency code, default CNY." },
          max: { type: "integer", minimum: 1, maximum: 20, description: "Maximum offers to return." }
        },
        required: ["origin", "destination", "departure_date", "passengers"],
        additionalProperties: false
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
    },
    {
      name: "search_hotels",
      title: "Search Amadeus sandbox hotel offers",
      description: "Searches Amadeus sandbox hotel offers by city after resolving hotel IDs, then returns normalized hotel options with rating, nightly price, policies, and booking URL.",
      inputSchema: {
        type: "object",
        properties: {
          city: { type: "string", description: "IATA city code such as TYO, PAR, NYC, or a supported city name." },
          checkin_date: { type: "string", description: "Check-in date as YYYY-MM-DD." },
          checkout_date: { type: "string", description: "Check-out date as YYYY-MM-DD." },
          guests: { type: "integer", minimum: 1, maximum: 9, description: "Adult guest count." },
          rooms: { type: "integer", minimum: 1, maximum: 5, description: "Room count." },
          currency: { type: "string", description: "Currency code, default CNY." },
          max: { type: "integer", minimum: 1, maximum: 20, description: "Maximum offers to return." }
        },
        required: ["city", "checkin_date", "checkout_date", "guests"],
        additionalProperties: false
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
    },
    {
      name: "get_offer_details",
      title: "Get cached Amadeus offer details",
      description: "Returns full normalized details for a previously returned offer, including cancellation policy and baggage or room policy.",
      inputSchema: {
        type: "object",
        properties: {
          offer_id: { type: "string", description: "Offer ID returned by search_flights or search_hotels." }
        },
        required: ["offer_id"],
        additionalProperties: false
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
    },
    {
      name: "open_booking_url",
      title: "Open booking URL in system browser",
      description: "Opens one selected booking URL in the system browser after Anna has summarized the option and received explicit same-turn user confirmation. It does not handle payment.",
      inputSchema: {
        type: "object",
        properties: {
          url: { type: "string", description: "The http(s) booking URL selected by the user." },
          dry_run: { type: "boolean", description: "When true, only record the URL without opening a browser." }
        },
        required: ["url"],
        additionalProperties: false
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true }
    }
  ];
}

function normalizeFlightArgs(args = {}) {
  const origin = iata(args.origin, "origin");
  const destination = iata(args.destination, "destination");
  if (origin === destination) throw toolError("invalid_search_params", "origin and destination must differ.");
  const departureDate = dateString(args.departure_date || args.departureDate, "departure_date");
  const returnDate = args.return_date || args.returnDate
    ? dateString(args.return_date || args.returnDate, "return_date")
    : null;
  return {
    origin,
    destination,
    departure_date: departureDate,
    return_date: returnDate,
    passengers: boundedInt(args.passengers ?? args.adults ?? 1, "passengers", 1, 9),
    currency: currency(args.currency || "CNY"),
    max: boundedInt(args.max || 5, "max", 1, 20)
  };
}

function normalizeHotelArgs(args = {}) {
  return {
    city: cityCode(args.city || args.destination || args.location),
    checkin_date: dateString(args.checkin_date || args.checkinDate, "checkin_date"),
    checkout_date: dateString(args.checkout_date || args.checkoutDate, "checkout_date"),
    guests: boundedInt(args.guests ?? args.adults ?? 1, "guests", 1, 9),
    rooms: boundedInt(args.rooms ?? 1, "rooms", 1, 5),
    currency: currency(args.currency || "CNY"),
    radius_km: boundedInt(args.radius_km || args.radiusKm || 5, "radius_km", 1, 50),
    max_hotels: boundedInt(args.max_hotels || args.maxHotels || 10, "max_hotels", 1, 50),
    max: boundedInt(args.max || 5, "max", 1, 20)
  };
}

function normalizeFlightOffer(offer, dictionaries, criteria, index) {
  const itinerary = offer.itineraries?.[0] || {};
  const segments = Array.isArray(itinerary.segments) ? itinerary.segments : [];
  const first = segments[0] || {};
  const last = segments[segments.length - 1] || first;
  const price = offer.price || {};
  const validatingCarrier = offer.validatingAirlineCodes?.[0] || first.carrierCode || "Unknown";
  const airline = dictionaries.carriers?.[validatingCarrier] || validatingCarrier;
  const bookingUrl = amadeusBookingUrl("flight", offer.id || `${criteria.origin}-${criteria.destination}-${index + 1}`);
  return {
    offer_id: offer.id || `amadeus_flight_${index + 1}`,
    provider: "amadeus",
    product: "flight",
    price: {
      currency: price.currency || criteria.currency,
      total: String(price.grandTotal || price.total || "0")
    },
    airline,
    carrier_code: validatingCarrier,
    departure_time: first.departure?.at || null,
    arrival_time: last.arrival?.at || null,
    origin: first.departure?.iataCode || criteria.origin,
    destination: last.arrival?.iataCode || criteria.destination,
    stops: Math.max(0, segments.length - 1),
    booking_url: bookingUrl,
    baggage_allowance: "Review baggage allowance before checkout.",
    cancellation_policy: "Review fare rules and refund/change policy before checkout.",
    raw_offer_reference: offer.id || null
  };
}

function normalizeHotelOfferGroup(hotelGroup, criteria, hotelIndex) {
  const hotel = hotelGroup.hotel || {};
  const offers = Array.isArray(hotelGroup.offers) ? hotelGroup.offers : [];
  return offers.map((offer, offerIndex) => {
    const price = offer.price || {};
    const bookingUrl = amadeusBookingUrl("hotel", offer.id || hotel.hotelId || `${hotelIndex + 1}-${offerIndex + 1}`);
    return {
      offer_id: offer.id || `amadeus_hotel_${hotelIndex + 1}_${offerIndex + 1}`,
      provider: "amadeus",
      product: "hotel",
      hotel_id: hotel.hotelId || null,
      hotel_name: hotel.name || `Amadeus Hotel ${hotelIndex + 1}`,
      rating: Number(hotel.rating || 0) || null,
      city: criteria.city,
      checkin_date: criteria.checkin_date,
      checkout_date: criteria.checkout_date,
      nightly_price: {
        currency: price.currency || criteria.currency,
        total: String(price.base || price.total || "0")
      },
      total_price: {
        currency: price.currency || criteria.currency,
        total: String(price.total || price.base || "0")
      },
      booking_url: bookingUrl,
      cancellation_policy: offer.policies?.cancellations?.[0]?.description?.text
        || "Review cancellation policy before checkout.",
      room_policy: offer.room?.description?.text || "Review room details before checkout."
    };
  });
}

function fixtureFlightOffers(criteria, now) {
  return [0, 1].map((index) => {
    const id = stableOfferId("flight", criteria, index);
    const base = index === 0 ? 1530 : 1780;
    const total = String(base * criteria.passengers);
    return {
      offer_id: id,
      provider: "amadeus",
      product: "flight",
      price: { currency: criteria.currency, total },
      airline: index === 0 ? "Amadeus Sandbox Air" : "Amadeus Connect Sandbox",
      carrier_code: index === 0 ? "AM" : "AX",
      departure_time: `${criteria.departure_date}T${index === 0 ? "08:35:00" : "16:20:00"}`,
      arrival_time: `${criteria.departure_date}T${index === 0 ? "12:05:00" : "21:35:00"}`,
      origin: criteria.origin,
      destination: criteria.destination,
      stops: index,
      booking_url: amadeusBookingUrl("flight", id),
      baggage_allowance: index === 0 ? "1 carry-on included; checked baggage must be reviewed." : "1 carry-on, possible checked baggage; review before checkout.",
      cancellation_policy: "Amadeus sandbox fixture: fare rules must be reviewed before checkout.",
      fixture_generated_at: now.toISOString()
    };
  });
}

function fixtureHotelOffers(criteria, now) {
  return [0, 1].map((index) => {
    const id = stableOfferId("hotel", criteria, index);
    const nightly = index === 0 ? 720 : 910;
    return {
      offer_id: id,
      provider: "amadeus",
      product: "hotel",
      hotel_id: `AMADEUS${index + 1}`,
      hotel_name: index === 0 ? "Amadeus Sandbox Central" : "Amadeus Sandbox Riverside",
      rating: index === 0 ? 4.4 : 4.1,
      city: criteria.city,
      checkin_date: criteria.checkin_date,
      checkout_date: criteria.checkout_date,
      nightly_price: { currency: criteria.currency, total: String(nightly) },
      total_price: { currency: criteria.currency, total: String(nightly * criteria.rooms) },
      booking_url: amadeusBookingUrl("hotel", id),
      cancellation_policy: index === 0 ? "Free cancellation until 48 hours before check-in; review final page." : "Low prepaid rate; cancellation must be reviewed.",
      room_policy: "Amadeus sandbox fixture: room, breakfast, tax, and fee details must be reviewed.",
      fixture_generated_at: now.toISOString()
    };
  });
}

function paymentPolicy() {
  return {
    anna_handles_payment: false,
    mcp_handles_payment: false,
    user_completes_payment_in_browser: true,
    requires_summary_before_open: true,
    requires_user_confirmation_before_open: true,
    requires_same_turn_confirmation: true,
    max_urls_per_confirmation: 1,
    open_failure_fallback: "Return the raw URL for manual opening; do not complete booking another way."
  };
}

function rememberOffer(state, offer) {
  state.offers.set(offer.offer_id, offer);
}

function appendOpenLog(entry) {
  fs.mkdirSync(path.dirname(OPEN_LOG), { recursive: true, mode: 0o700 });
  fs.appendFileSync(OPEN_LOG, `${JSON.stringify(entry)}\n`, { mode: 0o600 });
  fs.chmodSync(OPEN_LOG, 0o600);
}

function openUrlInSystemBrowser(url, env) {
  return new Promise((resolve, reject) => {
    let command;
    let args;
    if (process.platform === "darwin") {
      command = "open";
      args = [url];
    } else if (process.platform === "win32") {
      command = "cmd";
      args = ["/c", "start", "", url];
    } else {
      command = "xdg-open";
      args = [url];
    }
    const child = spawn(command, args, {
      detached: true,
      stdio: "ignore",
      env
    });
    child.on("error", reject);
    child.on("spawn", () => {
      child.unref();
      resolve();
    });
  });
}

function assertAmadeusOk(response, payload, code) {
  if (response.ok) return;
  const error = payload?.errors?.[0];
  throw toolError(code, error?.detail || error?.title || response.statusText || "Amadeus sandbox request failed.");
}

function hasAmadeusCredentials(env) {
  return Boolean(env.AMADEUS_CLIENT_ID && env.AMADEUS_CLIENT_SECRET);
}

function amadeusBookingUrl(product, offerId) {
  const url = new URL("https://developers.amadeus.com/self-service/apis-docs");
  url.searchParams.set("anna_product", product);
  url.searchParams.set("offer_id", offerId);
  return url.toString();
}

function stableOfferId(kind, criteria, index) {
  const raw = JSON.stringify({ kind, criteria, index });
  let hash = 0;
  for (let i = 0; i < raw.length; i += 1) {
    hash = (hash * 31 + raw.charCodeAt(i)) >>> 0;
  }
  return `amadeus_${kind}_${hash.toString(16)}_${index + 1}`;
}

function cityCode(value) {
  const raw = requireString(value, "city").trim().toUpperCase();
  const aliases = {
    TOKYO: "TYO",
    "东京": "TYO",
    PARIS: "PAR",
    "巴黎": "PAR",
    SHANGHAI: "SHA",
    "上海": "SHA",
    BEIJING: "BJS",
    "北京": "BJS",
    "NEW YORK": "NYC"
  };
  const mapped = aliases[raw] || raw;
  if (!/^[A-Z]{3}$/.test(mapped)) {
    throw toolError("invalid_search_params", `city must be a 3-letter IATA city code or supported city name: ${value}`);
  }
  return mapped;
}

function iata(value, name) {
  const raw = requireString(value, name).trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(raw)) {
    throw toolError("invalid_search_params", `${name} must be a 3-letter IATA code.`);
  }
  return raw;
}

function dateString(value, name) {
  const raw = requireString(value, name).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw) || Number.isNaN(new Date(`${raw}T00:00:00Z`).getTime())) {
    throw toolError("invalid_search_params", `${name} must be YYYY-MM-DD.`);
  }
  return raw;
}

function currency(value) {
  const raw = String(value || "CNY").trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(raw)) throw toolError("invalid_search_params", "currency must be a 3-letter code.");
  return raw;
}

function boundedInt(value, name, min, max) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) {
    throw toolError("invalid_search_params", `${name} must be an integer between ${min} and ${max}.`);
  }
  return number;
}

function requireString(value, name) {
  if (typeof value !== "string" || !value.trim()) {
    throw toolError("invalid_search_params", `${name} is required.`);
  }
  return value;
}

function toolError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function rpcError(code, message) {
  const error = new Error(message);
  error.rpcCode = code;
  return error;
}

function isAuthorized(request, token) {
  const auth = request.headers.authorization || "";
  return auth === `Bearer ${token}` || request.headers["x-anna-mcp-token"] === token;
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1024 * 1024) {
        reject(rpcError(-32600, "Request body too large."));
        request.destroy();
      }
    });
    request.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(rpcError(-32700, "Invalid JSON."));
      }
    });
    request.on("error", reject);
  });
}

function writeJson(response, status, payload) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  response.end(JSON.stringify(payload));
}

function startFromCli() {
  const mcp = createAmadeusTravelMcpServer({
    logger(entry) {
      if (process.env.AMADEUS_MCP_AUDIT_LOG) {
        fs.mkdirSync(path.dirname(process.env.AMADEUS_MCP_AUDIT_LOG), { recursive: true, mode: 0o700 });
        fs.appendFileSync(process.env.AMADEUS_MCP_AUDIT_LOG, `${JSON.stringify(entry)}\n`, { mode: 0o600 });
      }
    }
  });
  const server = createHttpServer(mcp);
  const host = process.env.AMADEUS_MCP_HOST || DEFAULT_HOST;
  const port = Number(process.env.AMADEUS_MCP_PORT || DEFAULT_PORT);
  server.listen(port, host, () => {
    process.stderr.write(`anna-amadeus-travel-mcp listening on http://${host}:${port}/mcp${os.EOL}`);
  });
  process.on("SIGTERM", () => server.close(() => process.exit(0)));
  process.on("SIGINT", () => server.close(() => process.exit(0)));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  startFromCli();
}
